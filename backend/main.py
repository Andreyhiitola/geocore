# backend/main.py
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
import pandas as pd
import io
import os
import json
import base64
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import httpx
import aiomysql
from typing import Optional

# Импортируем наши модули
from processing.validator import validate_csv
from processing.compositor import composite_intervals
from processing.decluster import apply_declustering, calculate_declustered_statistics
from processing.wireframe_gen import (
    generate_wireframe_convex_hull,
    generate_wireframe_alpha_shape,
    generate_wireframe_by_sections,
    generate_wireframe_auto,
    validate_wireframe
)
from processing.mac_generator import (
    generate_mac,
    generate_mac_simple,
    generate_mac_with_variogram,
    generate_mac_for_coal,
    generate_mac_for_porphyry
)

app = FastAPI(
    title="GeoCore Lab API",
    description="API для подготовки данных к импорту в Datamine Studio RM",
    version="1.0.0"
)

# ── База данных ───────────────────────────────────────────────────────────────

DB_HOST     = os.getenv("DB_HOST", "mariadb")
DB_NAME     = os.getenv("DB_NAME", "moodle")
DB_USER     = os.getenv("DB_USER", "moodle")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

db_pool = None

async def get_pool():
    global db_pool
    if db_pool is None:
        db_pool = await aiomysql.create_pool(
            host=DB_HOST, port=3306,
            user=DB_USER, password=DB_PASSWORD,
            db=DB_NAME, autocommit=True, minsize=1, maxsize=5
        )
    return db_pool

@app.on_event("startup")
async def startup():
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS requests (
                        id             INT AUTO_INCREMENT PRIMARY KEY,
                        course_name    VARCHAR(255) NOT NULL,
                        company_name   VARCHAR(255) NOT NULL,
                        inn            VARCHAR(12)  NOT NULL,
                        contact_email  VARCHAR(255) NOT NULL,
                        headcount      INT          DEFAULT 1,
                        employee_name  VARCHAR(255) NOT NULL,
                        employee_email VARCHAR(255) NOT NULL,
                        comment        TEXT,
                        status         VARCHAR(50)  DEFAULT 'new',
                        created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """)
                # Добавляем поле если таблица уже существовала без него
                await cur.execute("""
                    ALTER TABLE requests
                    ADD COLUMN IF NOT EXISTS headcount INT DEFAULT 1
                """)
        print("[DB] Таблица requests готова")
    except Exception as e:
        print(f"[DB] Ошибка подключения: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "GeoCore Lab API",
        "version": "1.0.0",
        "endpoints": [
            "/api/health",
            "/api/validate",
            "/api/process",
            "/api/wireframe",
            "/api/mac"
        ]
    }


MOODLE_URL   = os.getenv("MOODLE_URL",   "https://courses.geocore-academy.ru")
MOODLE_TOKEN = os.getenv("MOODLE_TOKEN", "")

ADMIN_TOKEN  = os.getenv("ADMIN_TOKEN", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO  = os.getenv("GITHUB_REPO", "Andreyhiitola/geocore")

SMTP_HOST    = os.getenv("SMTP_HOST", "smtp.yandex.ru")
SMTP_PORT    = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER    = os.getenv("SMTP_USER", "")   # noreply@geocore-academy.ru
SMTP_PASS    = os.getenv("SMTP_PASS", "")   # пароль приложения Яндекс 360
NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "9624294@gmail.com")


@app.get("/api/courses")
async def get_courses():
    """Список курсов из Moodle"""
    if not MOODLE_TOKEN:
        raise HTTPException(503, "MOODLE_TOKEN не задан")

    params = {
        "wstoken":           MOODLE_TOKEN,
        "wsfunction":        "core_course_get_courses",
        "moodlewsrestformat": "json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{MOODLE_URL}/webservice/rest/server.php", params=params)
        resp.raise_for_status()
        raw = resp.json()

    if isinstance(raw, dict) and raw.get("exception"):
        raise HTTPException(502, f"Moodle error: {raw.get('message')}")

    # Фильтруем системный курс (id=1) и форматируем
    courses = [
        {
            "id":       c["id"],
            "title":    c["fullname"],
            "summary":  c.get("summary", ""),
            "href":     f"{MOODLE_URL}/course/view.php?id={c['id']}",
            "img":      c.get("courseimage", ""),
        }
        for c in raw
        if c["id"] != 1
    ]
    return {"courses": courses}


class CourseRequest(BaseModel):
    course_name: str
    company_name: str
    inn: str
    contact_email: str
    headcount: int = 1
    employee_name: str
    employee_email: str
    comment: str = ""


def _smtp_send(msg: MIMEMultipart) -> None:
    """Отправить письмо через SMTP. Бросает исключение при ошибке."""
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)


def _send_request_emails(req: CourseRequest) -> None:
    """Отправляет два письма: уведомление администратору + авто-ответ клиенту."""
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
        print("[email] SMTP не настроен (SMTP_HOST/USER/PASS) — письма не отправлены")
        return

    SENDER = f"GeoCore Academy <info@geocore-academy.ru>"

    # ── 1. Уведомление администратору ──────────────────────────────────────
    if NOTIFY_EMAIL:
        admin_body = (
            f"Новая заявка на корпоративное обучение\n"
            f"{'─' * 44}\n"
            f"Курс:                {req.course_name}\n"
            f"Компания:            {req.company_name}\n"
            f"ИНН:                 {req.inn}\n"
            f"Email для договора:  {req.contact_email}\n"
            f"Кол-во сотрудников:  {req.headcount}\n"
            f"Сотрудник:           {req.employee_name}\n"
            f"Email сотрудника:    {req.employee_email}\n"
            f"Комментарий:         {req.comment or '—'}\n"
        )
        msg_admin = MIMEMultipart()
        msg_admin["From"]     = SENDER
        msg_admin["To"]       = NOTIFY_EMAIL
        msg_admin["Reply-To"] = "info@geocore-academy.ru"
        msg_admin["Subject"]  = f"[GeoCore] Заявка: {req.course_name} — {req.company_name}"
        msg_admin.attach(MIMEText(admin_body, "plain", "utf-8"))
        try:
            _smtp_send(msg_admin)
            print(f"[email] Уведомление → {NOTIFY_EMAIL}")
        except Exception as e:
            print(f"[email] Ошибка уведомления: {e}")

    # ── 2. Авто-ответ клиенту ──────────────────────────────────────────────
    client_body = (
        f"Здравствуйте!\n\n"
        f"Мы получили вашу заявку на корпоративное обучение.\n\n"
        f"{'─' * 44}\n"
        f"Курс:               {req.course_name}\n"
        f"Компания:           {req.company_name}\n"
        f"Кол-во сотрудников: {req.headcount}\n"
        f"{'─' * 44}\n\n"
        f"Наш менеджер свяжется с вами в течение 1 рабочего дня.\n\n"
        f"С уважением,\n"
        f"GeoCore Academy\n"
        f"info@geocore-academy.ru\n"
        f"geocore-academy.ru\n"
    )
    msg_client = MIMEMultipart()
    msg_client["From"]     = SENDER
    msg_client["To"]       = req.contact_email
    msg_client["Reply-To"] = "info@geocore-academy.ru"
    msg_client["Subject"]  = f"Заявка на обучение принята — {req.course_name}"
    msg_client.attach(MIMEText(client_body, "plain", "utf-8"))
    try:
        _smtp_send(msg_client)
        print(f"[email] Авто-ответ → {req.contact_email}")
    except Exception as e:
        print(f"[email] Ошибка авто-ответа: {e}")


@app.post("/api/requests")
async def create_request(request: CourseRequest, background_tasks: BackgroundTasks):
    """Приём заявки на корпоративное обучение"""
    print(f"[REQUEST] {request.model_dump()}")

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    INSERT INTO requests
                        (course_name, company_name, inn, contact_email,
                         headcount, employee_name, employee_email, comment)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    request.course_name, request.company_name, request.inn,
                    request.contact_email, request.headcount,
                    request.employee_name, request.employee_email, request.comment
                ))
        print("[DB] Заявка сохранена")
    except Exception as e:
        print(f"[DB] Ошибка сохранения: {e}")

    background_tasks.add_task(_send_request_emails, request)
    return {"success": True, "message": "Request received"}


# ── Admin auth ───────────────────────────────────────────────────────────────

async def require_admin(authorization: Optional[str] = Header(None)):
    if not ADMIN_TOKEN:
        raise HTTPException(500, "ADMIN_TOKEN не задан на сервере")
    if authorization != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(401, "Неверный токен")


# ── Admin: заявки ────────────────────────────────────────────────────────────

@app.get("/api/admin/requests")
async def admin_get_requests(_=Depends(require_admin)):
    """Список всех заявок"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests ORDER BY created_at DESC")
            rows = await cur.fetchall()
    for row in rows:
        if row.get("created_at"):
            row["created_at"] = str(row["created_at"])
    return {"requests": rows}


class StatusUpdate(BaseModel):
    status: str


@app.patch("/api/admin/requests/{request_id}")
async def admin_update_request(request_id: int, body: StatusUpdate, _=Depends(require_admin)):
    """Изменить статус заявки"""
    if body.status not in ("new", "confirmed", "paid", "cancelled"):
        raise HTTPException(400, "Допустимые статусы: new, confirmed, paid, cancelled")
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE requests SET status=%s WHERE id=%s",
                (body.status, request_id)
            )
    return {"success": True}


# ── Admin: site.json через GitHub API ────────────────────────────────────────

@app.get("/api/admin/site-json")
async def admin_get_site_json(_=Depends(require_admin)):
    """Получить содержимое site.json из GitHub"""
    if not GITHUB_TOKEN:
        raise HTTPException(500, "GITHUB_TOKEN не задан на сервере")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/contents/frontend/js/data/site.json",
            headers={"Authorization": f"Bearer {GITHUB_TOKEN}",
                     "Accept": "application/vnd.github.v3+json"}
        )
        resp.raise_for_status()
        data = resp.json()
    content = base64.b64decode(data["content"]).decode("utf-8")
    return {"content": content, "sha": data["sha"]}


class SiteJsonUpdate(BaseModel):
    content: str
    sha: str


@app.put("/api/admin/site-json")
async def admin_put_site_json(body: SiteJsonUpdate, _=Depends(require_admin)):
    """Сохранить site.json через GitHub API (запускает CI/CD деплой)"""
    if not GITHUB_TOKEN:
        raise HTTPException(500, "GITHUB_TOKEN не задан на сервере")
    try:
        json.loads(body.content)
    except ValueError:
        raise HTTPException(400, "Невалидный JSON")
    encoded = base64.b64encode(body.content.encode("utf-8")).decode("utf-8")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.put(
            f"https://api.github.com/repos/{GITHUB_REPO}/contents/frontend/js/data/site.json",
            headers={"Authorization": f"Bearer {GITHUB_TOKEN}",
                     "Accept": "application/vnd.github.v3+json"},
            json={"message": "admin: update site.json",
                  "content": encoded, "sha": body.sha}
        )
        resp.raise_for_status()
    return {"success": True}


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "GeoCore Lab API"}


@app.post("/api/validate")
async def validate(
    file: UploadFile = File(..., description="CSV файл с данными опробования")
):
    """Только валидация CSV файла"""
    if not file.filename.endswith('.csv'):
        raise HTTPException(400, "Требуется CSV файл")
    
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    result = validate_csv(df)
    return result


@app.post("/api/process")
async def process(
    file: UploadFile = File(..., description="CSV файл с данными опробования"),
    composite_length: float = Form(2.0, description="Длина композита (м)"),
    cutoff: float = Form(1.0, description="Пороговое значение содержания"),
    decluster_method: str = Form("cell", description="Метод декластеризации (cell/polygon/distance)"),
    wireframe_method: str = Form("convex_hull", description="Метод построения каркаса"),
    mac_style: str = Form("standard", description="Стиль .mac скрипта"),
    block_size: float = Form(5.0, description="Размер блока модели (м)")
):
    """Полная обработка данных"""
    if not file.filename.endswith('.csv'):
        raise HTTPException(400, "Требуется CSV файл")
    
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    # 1. Валидация
    validation = validate_csv(df)
    if not validation["valid"]:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "validation": validation}
        )
    
    value_field = validation["value_field"]
    
    # 2. Композитирование
    composites_df = composite_intervals(df, composite_length, value_field)
    
    # 3. Декластеризация
    if decluster_method != "none":
        composites_df = apply_declustering(
            composites_df, 
            value_field, 
            method=decluster_method
        )
        decluster_stats = calculate_declustered_statistics(composites_df, value_field)
    else:
        decluster_stats = None
    
    # 4. Построение каркаса
    if wireframe_method == "alpha_shape":
        wireframe_obj = generate_wireframe_alpha_shape(composites_df, value_field, cutoff)
    elif wireframe_method == "sections":
        wireframe_obj = generate_wireframe_by_sections(composites_df, value_field, cutoff)
    else:
        wireframe_obj = generate_wireframe_convex_hull(composites_df, value_field, cutoff)
    
    # 5. Генерация .mac скрипта
    if mac_style == "simple":
        mac_script = generate_mac_simple(composites_df, composite_length, cutoff, value_field)
    elif mac_style == "variogram":
        mac_script = generate_mac_with_variogram(composites_df, composite_length, cutoff, value_field)
    elif mac_style == "coal":
        mac_script = generate_mac_for_coal(composites_df, composite_length, cutoff)
    elif mac_style == "porphyry":
        mac_script = generate_mac_for_porphyry(composites_df, composite_length, cutoff, cutoff)
    else:
        mac_script = generate_mac(composites_df, composite_length, cutoff, value_field, block_size)
    
    return {
        "status": "success",
        "validation": validation,
        "composite": {
            "n_intervals": len(composites_df),
            "length": composite_length,
            "data_preview": composites_df.head(10).to_dict(orient='records')
        },
        "decluster": decluster_stats,
        "wireframe": {
            "content": wireframe_obj[:1000] + "..." if len(wireframe_obj) > 1000 else wireframe_obj,
            "full_length": len(wireframe_obj)
        },
        "mac_script": mac_script,
        "stats": validation["stats"]
    }


@app.post("/api/wireframe")
async def generate_wireframe_only(
    file: UploadFile = File(...),
    cutoff: float = Form(1.0),
    method: str = Form("convex_hull")
):
    """Только построение каркаса OBJ"""
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    validation = validate_csv(df)
    if not validation["valid"]:
        return JSONResponse(status_code=400, content=validation)
    
    value_field = validation["value_field"]
    
    if method == "alpha_shape":
        obj = generate_wireframe_alpha_shape(df, value_field, cutoff)
    elif method == "sections":
        obj = generate_wireframe_by_sections(df, value_field, cutoff)
    else:
        obj = generate_wireframe_convex_hull(df, value_field, cutoff)
    
    return PlainTextResponse(obj, media_type="text/plain")


@app.post("/api/mac")
async def generate_mac_only(
    file: UploadFile = File(...),
    composite_length: float = Form(2.0),
    cutoff: float = Form(1.0),
    style: str = Form("standard")
):
    """Только генерация .mac скрипта"""
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode('utf-8')))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")
    
    validation = validate_csv(df)
    if not validation["valid"]:
        return JSONResponse(status_code=400, content=validation)
    
    value_field = validation["value_field"]
    
    if style == "simple":
        mac = generate_mac_simple(df, composite_length, cutoff, value_field)
    elif style == "variogram":
        mac = generate_mac_with_variogram(df, composite_length, cutoff, value_field)
    elif style == "coal":
        mac = generate_mac_for_coal(df, composite_length, cutoff)
    elif style == "porphyry":
        mac = generate_mac_for_porphyry(df, composite_length, cutoff, cutoff)
    else:
        mac = generate_mac(df, composite_length, cutoff, value_field)
    
    return PlainTextResponse(mac, media_type="text/plain")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
