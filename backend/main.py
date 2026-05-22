# backend/main.py
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks, Depends, Header, Response, Cookie
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
from fastapi.staticfiles import StaticFiles
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import qrcode as qrcode_lib
import secrets
import string
import time
from datetime import date as date_type, timedelta

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

# ── Static files (счета, QR) ──────────────────────────────────────────────────
_BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR   = os.path.join(_BASE_DIR, "static")
INVOICES_DIR   = os.path.join(STATIC_DIR, "invoices")
QR_DIR         = os.path.join(STATIC_DIR, "qr")
CONTRACTS_DIR  = os.path.join(STATIC_DIR, "contracts")
os.makedirs(INVOICES_DIR,  exist_ok=True)
os.makedirs(QR_DIR,        exist_ok=True)
os.makedirs(CONTRACTS_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ── PDF-шрифты (Кириллица через DejaVu если установлено fonts-dejavu-core) ────
_FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
try:
    if os.path.exists(_FONT_REG):
        pdfmetrics.registerFont(TTFont("DjvSans",   _FONT_REG))
        pdfmetrics.registerFont(TTFont("DjvSans-B", _FONT_BOLD))
except Exception:
    pass

def _pdf_font(bold: bool = False) -> str:
    if os.path.exists(_FONT_REG):
        return "DjvSans-B" if bold else "DjvSans"
    return "Helvetica-Bold" if bold else "Helvetica"

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
                await cur.execute("""
                    ALTER TABLE requests
                    ADD COLUMN IF NOT EXISTS headcount INT DEFAULT 1
                """)
                await cur.execute("""
                    ALTER TABLE requests
                    ADD COLUMN IF NOT EXISTS archived TINYINT(1) DEFAULT 0
                """)
                for _col in [
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2) NULL",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(20) DEFAULT 'not_created'",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS invoice_link VARCHAR(512) NULL",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid'",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS access_expiry_date DATE NULL",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS moodle_accounts_generated TINYINT(1) DEFAULT 0",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS contract_status VARCHAR(20) DEFAULT 'not_created'",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS contract_link VARCHAR(512) NULL",
                    "ALTER TABLE requests ADD COLUMN IF NOT EXISTS contract_number VARCHAR(50) NULL",
                ]:
                    await cur.execute(_col)
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS moodle_accounts (
                        id             INT AUTO_INCREMENT PRIMARY KEY,
                        request_id     INT NOT NULL,
                        username       VARCHAR(100) NOT NULL,
                        password       VARCHAR(255) NOT NULL,
                        moodle_user_id INT DEFAULT 0,
                        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """)
        print("[DB] Таблица requests готова")
    except Exception as e:
        print(f"[DB] Ошибка подключения: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://geocore-academy.ru"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


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

# Реквизиты выставителя счёта (настраиваются через .env)
INV_SELLER_NAME    = os.getenv("INVOICE_COMPANY_NAME",   "")
INV_SELLER_INN     = os.getenv("INVOICE_INN",            "")
INV_SELLER_KPP     = os.getenv("INVOICE_KPP",            "")
INV_SELLER_ACCOUNT = os.getenv("INVOICE_ACCOUNT",        "")
INV_SELLER_BANK    = os.getenv("INVOICE_BANK",           "")
INV_SELLER_BIK     = os.getenv("INVOICE_BIK",            "")
INV_SELLER_CORR    = os.getenv("INVOICE_CORR_ACCOUNT",   "")
INV_SELLER_ADDR    = os.getenv("INVOICE_ADDRESS",        "")

ADMIN_TOKEN    = os.getenv("ADMIN_TOKEN", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO  = os.getenv("GITHUB_REPO", "Andreyhiitola/geocore")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

USN_API_URL = os.getenv("USN_API_URL", "http://geocore_usn_api:5000")
USN_API_KEY = os.getenv("USN_API_KEY", "")

MAX_CSV_BYTES = int(os.getenv("MAX_CSV_BYTES", str(5 * 1024 * 1024)))
MAX_CSV_ROWS = int(os.getenv("MAX_CSV_ROWS", "20000"))

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

    SENDER = f"GeoCore Academy <{SMTP_USER}>"

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


# ── PDF / QR helpers ─────────────────────────────────────────────────────────

def _generate_secure_password() -> str:
    specials = "!@#$*-"
    pwd = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice(specials),
    ]
    rest = [secrets.choice(string.ascii_letters + string.digits + specials) for _ in range(8)]
    combined = pwd + rest
    secrets.SystemRandom().shuffle(combined)
    return ''.join(combined)


def _make_invoice_pdf(request_id: int, company_name: str, course_name: str,
                      total_price, inn: str) -> str:
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    path = os.path.join(INVOICES_DIR, f"invoice_{request_id}.pdf")
    buf = io.BytesIO()
    W, H = A4
    c = canvas.Canvas(buf, pagesize=A4)
    fn_b, fn = _pdf_font(True), _pdf_font(False)
    price = total_price or 0
    nds = "Без НДС"
    margin = 20 * mm

    def line(y_pos):
        c.setLineWidth(0.5)
        c.line(margin, y_pos, W - margin, y_pos)

    # ── Заголовок ──────────────────────────────────────────────────────────────
    c.setFont(fn_b, 14)
    c.drawString(margin, H - 20*mm, f"Счёт на оплату № {request_id}")
    from datetime import date as _date
    c.setFont(fn, 10)
    c.drawString(margin, H - 28*mm, f"от {_date.today().strftime('%d.%m.%Y')}")

    # ── Банковские реквизиты продавца ──────────────────────────────────────────
    y = H - 38*mm
    line(y + 3*mm)
    c.setFont(fn_b, 9)
    c.drawString(margin, y, "Банк получателя:")
    c.setFont(fn, 9)
    c.drawString(60*mm, y, INV_SELLER_BANK or "—")
    y -= 6*mm
    c.setFont(fn_b, 9); c.drawString(margin, y, "БИК:")
    c.setFont(fn, 9);   c.drawString(60*mm, y, INV_SELLER_BIK or "—")
    y -= 6*mm
    c.setFont(fn_b, 9); c.drawString(margin, y, "К/С:")
    c.setFont(fn, 9);   c.drawString(60*mm, y, INV_SELLER_CORR or "—")
    y -= 6*mm
    c.setFont(fn_b, 9); c.drawString(margin, y, "Р/С:")
    c.setFont(fn, 9);   c.drawString(60*mm, y, INV_SELLER_ACCOUNT or "—")
    line(y - 3*mm)

    # ── Продавец ───────────────────────────────────────────────────────────────
    y -= 12*mm
    c.setFont(fn_b, 9); c.drawString(margin, y, "Поставщик (Исполнитель):")
    c.setFont(fn, 9)
    seller_info = INV_SELLER_NAME or "—"
    if INV_SELLER_INN:
        seller_info += f", ИНН {INV_SELLER_INN}"
    if INV_SELLER_KPP:
        seller_info += f", КПП {INV_SELLER_KPP}"
    if INV_SELLER_ADDR:
        seller_info += f", {INV_SELLER_ADDR}"
    c.drawString(60*mm, y, seller_info[:90])

    y -= 7*mm
    c.setFont(fn_b, 9); c.drawString(margin, y, "Покупатель (Заказчик):")
    c.setFont(fn, 9)
    buyer_info = company_name or "—"
    if inn:
        buyer_info += f", ИНН {inn}"
    c.drawString(60*mm, y, buyer_info[:90])
    line(y - 4*mm)

    # ── Таблица услуг ──────────────────────────────────────────────────────────
    y -= 14*mm
    c.setFont(fn_b, 11)
    c.drawString(margin, y, f"Счёт на оплату № {request_id}")

    y -= 10*mm
    col_w = [85*mm, 20*mm, 25*mm, 25*mm, 25*mm]
    data = [
        ["Наименование", "Кол.", "Ед.", "Цена", "Сумма"],
        [course_name, "1", "усл.", f"{price:,.0f}", f"{price:,.0f}"],
    ]
    tbl = Table(data, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ("FONTNAME",       (0, 0), (-1, 0),  fn_b),
        ("FONTNAME",       (0, 1), (-1, -1), fn),
        ("FONTSIZE",       (0, 0), (-1, -1), 9),
        ("BACKGROUND",     (0, 0), (-1, 0),  colors.HexColor("#DDDDDD")),
        ("GRID",           (0, 0), (-1, -1), 0.5, colors.black),
        ("ALIGN",          (1, 0), (-1, -1), "CENTER"),
        ("ALIGN",          (3, 1), (-1, -1), "RIGHT"),
        ("TOPPADDING",     (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 4),
    ]))
    tbl.wrapOn(c, W, H)
    tbl.drawOn(c, margin, y - 20*mm)

    # ── Итог ───────────────────────────────────────────────────────────────────
    y -= 34*mm
    c.setFont(fn, 9)
    c.drawString(margin, y, f"НДС: {nds}")
    y -= 7*mm
    c.setFont(fn_b, 10)
    c.drawRightString(W - margin, y, f"Итого к оплате: {price:,.0f} руб.")

    # ── Подпись ────────────────────────────────────────────────────────────────
    y -= 20*mm
    line(y + 3*mm)
    c.setFont(fn, 9)
    c.drawString(margin, y, "Руководитель / ИП  ________________  ")
    c.drawString(120*mm, y, "М.П.")

    c.save()
    with open(path, "wb") as f:
        f.write(buf.getvalue())
    return path


def _make_qr(request_id: int, total_price) -> str:
    path = os.path.join(QR_DIR, f"qr_{request_id}.png")
    data = f"Test QR | invoice {request_id} | {total_price or 0} rub. (not real payment)"
    img = qrcode_lib.make(data)
    img.save(path)
    return path


def _make_contract_pdf(request_id: int, contract_number: str,
                       company_name: str, inn: str, contact_name: str,
                       course_name: str, total_price, headcount: int) -> str:
    """Договор оказания образовательных услуг (PDF, 2 страницы)."""
    from datetime import date as _date
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT

    path = os.path.join(CONTRACTS_DIR, f"contract_{request_id}.pdf")
    buf  = io.BytesIO()
    W, H = A4
    c    = canvas.Canvas(buf, pagesize=A4)
    fn_b, fn = _pdf_font(True), _pdf_font(False)
    margin = 20 * mm
    today  = _date.today()
    price  = float(total_price or 0)
    cnt    = int(headcount or 1)

    def draw_text(text: str, x: float, y: float, bold=False, size=9, max_w=None):
        c.setFont(fn_b if bold else fn, size)
        if max_w:
            # wrap manually
            words = text.split()
            line, lines = [], []
            for w in words:
                test = " ".join(line + [w])
                if c.stringWidth(test, fn_b if bold else fn, size) > max_w:
                    lines.append(" ".join(line)); line = [w]
                else:
                    line.append(w)
            lines.append(" ".join(line))
            for i, l in enumerate(lines):
                c.drawString(x, y - i * (size + 2), l)
            return y - len(lines) * (size + 2)
        else:
            c.drawString(x, y, text)
            return y

    def hline(y_pos, lw=0.5):
        c.setLineWidth(lw)
        c.line(margin, y_pos, W - margin, y_pos)

    # ─── СТРАНИЦА 1 ─────────────────────────────────────────────────────────

    # Заголовок
    c.setFont(fn_b, 13)
    c.drawCentredString(W / 2, H - 22*mm, "ДОГОВОР ОКАЗАНИЯ ОБРАЗОВАТЕЛЬНЫХ УСЛУГ")
    c.setFont(fn_b, 10)
    c.drawCentredString(W / 2, H - 30*mm, f"№ {contract_number}")
    c.setFont(fn, 9)
    c.drawString(margin,      H - 38*mm, f"г. Санкт-Петербург")
    c.drawRightString(W - margin, H - 38*mm, f"{today.strftime('%d %B %Y г.').replace('January','января').replace('February','февраля').replace('March','марта').replace('April','апреля').replace('May','мая').replace('June','июня').replace('July','июля').replace('August','августа').replace('September','сентября').replace('October','октября').replace('November','ноября').replace('December','декабря')}")
    hline(H - 41*mm)

    # Стороны
    y = H - 50*mm
    seller = INV_SELLER_NAME or "Исполнитель"
    seller_inn = INV_SELLER_INN or ""
    buyer  = company_name or "Заказчик"
    buyer_inn = inn or ""

    parties = (
        f"{seller} (ИНН {seller_inn}), именуемое в дальнейшем «Исполнитель», с одной стороны, "
        f"и {buyer} (ИНН {buyer_inn}), именуемое в дальнейшем «Заказчик», "
        f"с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем:"
    )
    c.setFont(fn, 9)
    text_w = W - 2 * margin
    y = draw_text(parties, margin, y, size=9, max_w=text_w)
    y -= 6*mm

    sections = [
        ("1. ПРЕДМЕТ ДОГОВОРА", [
            f"1.1. Исполнитель обязуется оказать Заказчику образовательные услуги "
            f"по программе: «{course_name}» (далее — «Курс»), а Заказчик обязуется "
            f"принять и оплатить данные услуги.",
            f"1.2. Количество слушателей: {cnt} чел.",
            "1.3. Форма обучения: дистанционная (онлайн-платформа Moodle).",
            "1.4. Срок доступа к материалам курса: 30 (тридцать) календарных дней с момента "
            "предоставления доступа.",
        ]),
        ("2. СТОИМОСТЬ И ПОРЯДОК ОПЛАТЫ", [
            f"2.1. Стоимость услуг составляет {price:,.0f} ({int(price)} рублей 00 копеек), НДС не облагается.",
            "2.2. Заказчик производит оплату на основании выставленного Исполнителем счёта "
            "в течение 5 (пяти) банковских дней с момента его выставления.",
            "2.3. Оплата производится безналичным перечислением на расчётный счёт Исполнителя.",
        ]),
        ("3. ПРАВА И ОБЯЗАННОСТИ СТОРОН", [
            "3.1. Исполнитель обязан: предоставить Заказчику доступ к материалам Курса "
            "в течение 2 (двух) рабочих дней после поступления оплаты; обеспечить "
            "функционирование онлайн-платформы в режиме 24/7.",
            "3.2. Заказчик обязан: своевременно оплатить услуги; обеспечить соблюдение "
            "авторских прав на материалы Курса; не передавать данные доступа третьим лицам.",
            "3.3. Заказчик вправе получить сертификат об обучении по окончании Курса "
            "при условии прохождения итогового тестирования.",
        ]),
        ("4. ОТВЕТСТВЕННОСТЬ СТОРОН", [
            "4.1. За неисполнение или ненадлежащее исполнение обязательств Стороны несут "
            "ответственность в соответствии с действующим законодательством РФ.",
            "4.2. Исполнитель не несёт ответственности за невозможность доступа к Курсу "
            "вследствие технических неполадок на стороне Заказчика.",
        ]),
        ("5. КОНФИДЕНЦИАЛЬНОСТЬ", [
            "5.1. Стороны обязуются сохранять конфиденциальность информации, полученной "
            "в ходе исполнения настоящего договора.",
        ]),
        ("6. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ", [
            "6.1. Договор вступает в силу с момента подписания обеими Сторонами и действует "
            "до полного исполнения обязательств.",
            "6.2. Все изменения и дополнения к договору действительны в письменной форме.",
            "6.3. Споры разрешаются путём переговоров; при недостижении согласия — "
            "в суде по месту нахождения Исполнителя.",
            f"6.4. Договор составлен в 2 (двух) экземплярах, имеющих одинаковую юридическую "
            f"силу.",
        ]),
    ]

    for title, items in sections:
        if y < 40*mm:
            c.showPage()
            y = H - 20*mm
        c.setFont(fn_b, 9)
        c.drawString(margin, y, title)
        y -= 5*mm
        for item in items:
            if y < 30*mm:
                c.showPage()
                y = H - 20*mm
            y = draw_text(item, margin, y, size=9, max_w=text_w)
            y -= 4*mm
        y -= 2*mm

    # Реквизиты и подписи
    if y < 60*mm:
        c.showPage()
        y = H - 20*mm

    hline(y)
    y -= 8*mm
    c.setFont(fn_b, 9)
    c.drawString(margin, y, "РЕКВИЗИТЫ И ПОДПИСИ СТОРОН")
    y -= 8*mm

    col_w = (W - 2 * margin) / 2 - 5*mm
    lx, rx = margin, margin + col_w + 10*mm

    def col_line(label, value, x, yy, w):
        c.setFont(fn_b, 8); c.drawString(x, yy, label)
        c.setFont(fn, 8);   c.drawString(x + 30*mm, yy, value or "—")
        return yy - 5*mm

    c.setFont(fn_b, 9)
    c.drawString(lx, y, "Исполнитель:")
    c.drawString(rx, y, "Заказчик:")
    y -= 6*mm

    seller_lines = [
        ("Наименование:", INV_SELLER_NAME or ""),
        ("ИНН:", INV_SELLER_INN or ""),
        ("КПП:", INV_SELLER_KPP or ""),
        ("Р/С:", INV_SELLER_ACCOUNT or ""),
        ("Банк:", INV_SELLER_BANK or ""),
        ("БИК:", INV_SELLER_BIK or ""),
        ("Адрес:", INV_SELLER_ADDR or ""),
    ]
    buyer_lines = [
        ("Наименование:", company_name or ""),
        ("ИНН:", inn or ""),
        ("КПП:", ""),
        ("Р/С:", ""),
        ("Банк:", ""),
        ("БИК:", ""),
        ("Адрес:", ""),
    ]
    y0 = y
    for (ll, lv), (rl, rv) in zip(seller_lines, buyer_lines):
        col_line(ll, lv, lx, y, col_w)
        col_line(rl, rv, rx, y, col_w)
        y -= 5*mm

    y -= 8*mm
    c.setFont(fn, 9)
    c.drawString(lx, y, "Подпись / печать:  ____________________")
    c.drawString(rx, y, "Подпись / печать:  ____________________")
    y -= 7*mm
    c.setFont(fn, 8)
    c.drawString(lx, y, f"({INV_SELLER_NAME or 'Исполнитель'})")
    c.drawString(rx, y, f"({contact_name or company_name or 'Заказчик'})")

    c.save()
    with open(path, "wb") as f:
        f.write(buf.getvalue())
    return path


def _record_income_in_usn(course_name: str, amount: float, company_name: str) -> None:
    """Фиксируем доход в USN-app при подтверждении оплаты."""
    if not USN_API_URL or amount <= 0:
        return
    import urllib.request, json as _json, datetime
    payload = _json.dumps({
        "date": datetime.date.today().isoformat(),
        "description": f"{course_name} — {company_name}",
        "amount": amount,
        "category": "services",
    }).encode()
    req = urllib.request.Request(
        f"{USN_API_URL}/api/income",
        data=payload,
        headers={"Content-Type": "application/json", "x-api-key": USN_API_KEY},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print(f"[USN] Не удалось записать доход: {e}")


def _send_accounts_email(to_email: str, accounts: list, course_name: str,
                         expiry_date, course_url: str = "") -> None:
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
        return
    rows = "\n".join(f"  Логин: {a['username']}\n  Пароль: {a['password']}" for a in accounts)
    link = course_url or MOODLE_URL
    body = (
        f"Здравствуйте!\n\n"
        f"Ваша оплата подтверждена. Доступ к курсу «{course_name}» предоставлен.\n\n"
        f"Данные для входа:\n{rows}\n\n"
        f"Ссылка на курс: {link}\n"
        f"Доступ до: {expiry_date or 'не ограничен'}\n\n"
        f"С уважением,\nGeoCore Academy\ninfo@geocore-academy.ru"
    )
    msg = MIMEMultipart()
    msg["From"]    = f"GeoCore Academy <{SMTP_USER}>"
    msg["To"]      = to_email
    msg["Subject"] = f"Данные для входа — {course_name}"
    msg.attach(MIMEText(body, "plain", "utf-8"))
    try:
        _smtp_send(msg)
        print(f"[email] Аккаунты → {to_email}")
    except Exception as e:
        print(f"[email] Ошибка отправки аккаунтов: {e}")


async def _get_moodle_course_id(course_name: str) -> Optional[int]:
    if not MOODLE_TOKEN:
        return None
    params = {"wstoken": MOODLE_TOKEN, "wsfunction": "core_course_get_courses",
               "moodlewsrestformat": "json"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{MOODLE_URL}/webservice/rest/server.php", params=params)
            courses = resp.json()
        if not isinstance(courses, list):
            return None
        needle = course_name.lower()
        for c in courses:
            if c["id"] != 1 and needle in c.get("fullname", "").lower():
                return c["id"]
    except Exception as e:
        print(f"[moodle] Ошибка поиска курса: {e}")
    return None


async def _create_moodle_accounts(req: dict) -> tuple:
    accounts = []
    if not MOODLE_TOKEN:
        print("[moodle] MOODLE_TOKEN не задан — аккаунты не созданы")
        return accounts, None
    course_id = await _get_moodle_course_id(req["course_name"])
    expiry_ts = 0
    if req.get("access_expiry_date"):
        try:
            exp = req["access_expiry_date"]
            if isinstance(exp, str):
                exp = date_type.fromisoformat(exp)
            import calendar
            expiry_ts = calendar.timegm(exp.timetuple())
        except Exception:
            expiry_ts = 0
    pool = await get_pool()
    async with httpx.AsyncClient(timeout=15) as client:
        for i in range(int(req.get("headcount") or 1)):
            username = f"gc_{req['id']}_{i+1}"
            password = _generate_secure_password()
            email = (req.get("employee_email") or f"user_{req['id']}_{i+1}@temp.geocore.ru") \
                    if (req.get("headcount") or 1) == 1 \
                    else f"gc_{req['id']}_{i+1}@temp.geocore.ru"
            moodle_id = 0
            try:
                payload = {
                    "wstoken": MOODLE_TOKEN,
                    "wsfunction": "core_user_create_users",
                    "moodlewsrestformat": "json",
                    "users[0][username]": username,
                    "users[0][password]": password,
                    "users[0][firstname]": f"User{i+1}",
                    "users[0][lastname]": (req.get("company_name") or "GeoCore")[:30] or "GeoCore",
                    "users[0][email]": email,
                    "users[0][auth]": "manual",
                }
                resp = await client.post(f"{MOODLE_URL}/webservice/rest/server.php", data=payload)
                data = resp.json()
                if isinstance(data, list) and data:
                    moodle_id = data[0].get("id", 0)
                    if course_id:
                        enrol = {
                            "wstoken": MOODLE_TOKEN,
                            "wsfunction": "enrol_manual_enrol_users",
                            "moodlewsrestformat": "json",
                            "enrolments[0][roleid]": 5,
                            "enrolments[0][userid]": moodle_id,
                            "enrolments[0][courseid]": course_id,
                            "enrolments[0][timestart]": int(time.time()),
                            "enrolments[0][timeend]": expiry_ts,
                        }
                        await client.get(f"{MOODLE_URL}/webservice/rest/server.php", params=enrol)
                else:
                    print(f"[moodle] Ошибка создания пользователя: {data}")
            except Exception as e:
                print(f"[moodle] Ошибка для пользователя {username}: {e}")
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "INSERT INTO moodle_accounts (request_id, username, password, moodle_user_id) VALUES (%s,%s,%s,%s)",
                        (req["id"], username, password, moodle_id)
                    )
            accounts.append({"username": username, "password": password})
    return accounts, course_id


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
        raise HTTPException(status_code=500, detail="Ошибка сохранения заявки, попробуйте позже")

    background_tasks.add_task(_send_request_emails, request)
    return {"success": True, "message": "Request received"}


# ── Admin auth ───────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    username: str
    token: str


async def require_admin(
    authorization: Optional[str] = Header(None),
    x_admin_user: Optional[str] = Header(None),
    gc_admin_token: Optional[str] = Cookie(None),
    gc_admin_user: Optional[str] = Cookie(None),
):
    if not ADMIN_TOKEN:
        raise HTTPException(500, "ADMIN_TOKEN не задан на сервере")
    if gc_admin_token is not None:
        if ADMIN_USERNAME and gc_admin_user != ADMIN_USERNAME:
            raise HTTPException(401, "Неверный логин или токен")
        if gc_admin_token != ADMIN_TOKEN:
            raise HTTPException(401, "Неверный логин или токен")
        return
    if ADMIN_USERNAME and x_admin_user != ADMIN_USERNAME:
        raise HTTPException(401, "Неверный логин или токен")
    if authorization != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(401, "Неверный логин или токен")


@app.post("/api/admin/login")
async def admin_login(body: AdminLoginRequest, response: Response):
    if not ADMIN_TOKEN:
        raise HTTPException(500, "ADMIN_TOKEN не задан на сервере")
    if ADMIN_USERNAME and body.username != ADMIN_USERNAME:
        raise HTTPException(401, "Неверный логин или токен")
    if body.token != ADMIN_TOKEN:
        raise HTTPException(401, "Неверный логин или токен")
    _cookie_opts = dict(httponly=True, secure=True, samesite="none", max_age=86400)
    response.set_cookie("gc_admin_token", body.token, **_cookie_opts)
    response.set_cookie("gc_admin_user", body.username, **_cookie_opts)
    return {"ok": True}


@app.post("/api/admin/logout")
async def admin_logout(response: Response):
    response.delete_cookie("gc_admin_token", samesite="none", secure=True)
    response.delete_cookie("gc_admin_user", samesite="none", secure=True)
    return {"ok": True}


# ── Admin: заявки ────────────────────────────────────────────────────────────

@app.get("/api/admin/requests")
async def admin_get_requests(_=Depends(require_admin)):
    """Список всех заявок (без архивных)"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests WHERE archived=0 ORDER BY created_at DESC")
            rows = await cur.fetchall()
    for row in rows:
        if row.get("created_at"):
            row["created_at"] = str(row["created_at"])
    return {"requests": rows}


@app.get("/api/admin/requests/archive")
async def admin_get_archive(_=Depends(require_admin)):
    """Список архивных заявок"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests WHERE archived=1 ORDER BY created_at DESC")
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


@app.patch("/api/admin/requests/{request_id}/archive")
async def admin_archive_request(request_id: int, _=Depends(require_admin)):
    """Отправить заявку в архив"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE requests SET archived=1 WHERE id=%s", (request_id,))
    return {"success": True}


@app.patch("/api/admin/requests/{request_id}/unarchive")
async def admin_unarchive_request(request_id: int, _=Depends(require_admin)):
    """Восстановить заявку из архива"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE requests SET archived=0 WHERE id=%s", (request_id,))
    return {"success": True}


@app.delete("/api/admin/requests/{request_id}")
async def admin_delete_request(request_id: int, _=Depends(require_admin)):
    """Удалить заявку насовсем (только из архива)"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM requests WHERE id=%s AND archived=1", (request_id,))
    return {"success": True}


@app.get("/api/admin/requests/{request_id}")
async def admin_get_request(request_id: int, _=Depends(require_admin)):
    """Получить одну заявку + её аккаунты Moodle"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests WHERE id=%s", (request_id,))
            req = await cur.fetchone()
            if not req:
                raise HTTPException(404, "Заявка не найдена")
            await cur.execute(
                "SELECT username, password FROM moodle_accounts WHERE request_id=%s ORDER BY id",
                (request_id,)
            )
            accounts = await cur.fetchall()
    for k in ("created_at", "access_expiry_date"):
        if req.get(k):
            req[k] = str(req[k])
    req["accounts"] = list(accounts)
    return req


@app.patch("/api/admin/requests/{request_id}/headcount")
async def admin_update_headcount(request_id: int, headcount: int, _=Depends(require_admin)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE requests SET headcount=%s WHERE id=%s", (headcount, request_id))
    return {"success": True}


@app.patch("/api/admin/requests/{request_id}/total_price")
async def admin_update_total_price(request_id: int, total_price: float, _=Depends(require_admin)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE requests SET total_price=%s WHERE id=%s", (total_price, request_id))
    return {"success": True}


@app.post("/api/admin/requests/{request_id}/generate-invoice")
async def admin_generate_invoice(request_id: int, _=Depends(require_admin)):
    """Сформировать заглушку счёта (PDF + QR)"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests WHERE id=%s", (request_id,))
            req = await cur.fetchone()
    if not req:
        raise HTTPException(404, "Заявка не найдена")
    if not req.get("total_price"):
        raise HTTPException(400, "Сначала укажите стоимость (total_price)")
    try:
        _make_invoice_pdf(request_id, req["company_name"], req["course_name"],
                          req["total_price"], req["inn"])
        _make_qr(request_id, req["total_price"])
    except Exception as e:
        raise HTTPException(500, f"Ошибка генерации PDF: {e}")
    invoice_url = f"/static/invoices/invoice_{request_id}.pdf"
    qr_url      = f"/static/qr/qr_{request_id}.png"
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE requests SET invoice_status='created', invoice_link=%s WHERE id=%s",
                (invoice_url, request_id)
            )
    return {"invoice_url": invoice_url, "qr_url": qr_url, "status": "created"}


@app.post("/api/admin/requests/{request_id}/generate-contract")
async def admin_generate_contract(request_id: int, _=Depends(require_admin)):
    """Сформировать договор оказания образовательных услуг (PDF)"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests WHERE id=%s", (request_id,))
            req = await cur.fetchone()
    if not req:
        raise HTTPException(404, "Заявка не найдена")
    if not req.get("total_price"):
        raise HTTPException(400, "Сначала укажите стоимость (total_price)")

    from datetime import date as _date
    contract_number = req.get("contract_number") or f"{request_id}/{_date.today().year}"

    try:
        _make_contract_pdf(
            request_id   = request_id,
            contract_number = contract_number,
            company_name = req.get("company_name", ""),
            inn          = req.get("inn", ""),
            contact_name = req.get("contact_name", ""),
            course_name  = req.get("course_name", ""),
            total_price  = req.get("total_price"),
            headcount    = req.get("headcount", 1),
        )
    except Exception as e:
        raise HTTPException(500, f"Ошибка генерации договора: {e}")

    contract_url = f"/static/contracts/contract_{request_id}.pdf"
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE requests SET contract_status='created', contract_link=%s, "
                "contract_number=%s WHERE id=%s",
                (contract_url, contract_number, request_id)
            )
    return {"contract_url": contract_url, "contract_number": contract_number, "status": "created"}


@app.post("/api/admin/requests/{request_id}/mark-paid")
async def admin_mark_paid(request_id: int,
                          background_tasks: BackgroundTasks,
                          expiry_date: Optional[str] = None,
                          _=Depends(require_admin)):
    """Подтвердить оплату — обновить статус, создать аккаунты Moodle, отправить email"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("UPDATE requests SET payment_status='paid', status='paid' WHERE id=%s", (request_id,))
            if expiry_date:
                await cur.execute("UPDATE requests SET access_expiry_date=%s WHERE id=%s",
                                  (expiry_date, request_id))
            else:
                await cur.execute(
                    "UPDATE requests SET access_expiry_date=DATE_ADD(CURDATE(), INTERVAL 30 DAY) WHERE id=%s",
                    (request_id,)
                )
            await cur.execute("SELECT * FROM requests WHERE id=%s", (request_id,))
            req = await cur.fetchone()
    if not req:
        raise HTTPException(404, "Заявка не найдена")
    if req.get("access_expiry_date"):
        req["access_expiry_date"] = str(req["access_expiry_date"])
    if req.get("moodle_accounts_generated"):
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT username, password FROM moodle_accounts WHERE request_id=%s", (request_id,)
                )
                existing = await cur.fetchall()
        return {"ok": True, "accounts": list(existing)}
    accounts, course_id = await _create_moodle_accounts(req)
    course_url = f"{MOODLE_URL}/course/view.php?id={course_id}" if course_id else ""
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE requests SET moodle_accounts_generated=1 WHERE id=%s", (request_id,))
    background_tasks.add_task(
        _send_accounts_email,
        req.get("contact_email", ""),
        accounts,
        req.get("course_name", ""),
        req.get("access_expiry_date"),
        course_url,
    )
    # Фиксируем доход в USN-app
    background_tasks.add_task(
        _record_income_in_usn,
        req.get("course_name", "Курс"),
        float(req.get("total_price") or 0),
        str(req.get("company_name", "")),
    )
    return {"ok": True, "accounts": accounts}


@app.post("/api/admin/requests/{request_id}/extend-access")
async def admin_extend_access(request_id: int,
                              expiry_date: str,
                              _=Depends(require_admin)):
    """Продлить доступ к курсу: обновить дату в БД и timeend в Moodle для всех аккаунтов заявки."""
    try:
        new_expiry = date_type.fromisoformat(expiry_date)
    except ValueError:
        raise HTTPException(400, "expiry_date должен быть в формате YYYY-MM-DD")
    if new_expiry <= date_type.today():
        raise HTTPException(400, "expiry_date должен быть в будущем")

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests WHERE id=%s", (request_id,))
            req = await cur.fetchone()
            if not req:
                raise HTTPException(404, "Заявка не найдена")
            await cur.execute(
                "SELECT username, moodle_user_id FROM moodle_accounts WHERE request_id=%s",
                (request_id,)
            )
            accounts = await cur.fetchall()

    if not accounts:
        raise HTTPException(400, "Аккаунты для этой заявки ещё не созданы")

    import calendar
    expiry_ts = calendar.timegm(new_expiry.timetuple())
    course_id = await _get_moodle_course_id(req["course_name"])
    moodle_errors = []
    moodle_updated = 0

    if MOODLE_TOKEN and course_id:
        async with httpx.AsyncClient(timeout=15) as client:
            for acc in accounts:
                uid = acc.get("moodle_user_id", 0)
                if not uid:
                    moodle_errors.append(f"Аккаунт {acc.get('username')} не имеет Moodle ID — пропущен")
                    continue
                params = {
                    "wstoken": MOODLE_TOKEN,
                    "wsfunction": "enrol_manual_enrol_users",
                    "moodlewsrestformat": "json",
                    "enrolments[0][roleid]": 5,
                    "enrolments[0][userid]": uid,
                    "enrolments[0][courseid]": course_id,
                    "enrolments[0][timeend]": expiry_ts,
                }
                try:
                    resp = await client.get(f"{MOODLE_URL}/webservice/rest/server.php", params=params)
                    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    if isinstance(body, dict) and body.get("exception"):
                        moodle_errors.append(f"{acc.get('username')}: {body.get('message', body.get('exception'))}")
                    else:
                        moodle_updated += 1
                except Exception as e:
                    moodle_errors.append(f"{acc.get('username')}: {e}")
    elif not MOODLE_TOKEN:
        moodle_errors.append("MOODLE_TOKEN не задан")
    elif not course_id:
        moodle_errors.append(f"Курс «{req['course_name']}» не найден в Moodle")

    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE requests SET access_expiry_date=%s WHERE id=%s",
                (expiry_date, request_id)
            )

    result = {"ok": True, "access_expiry_date": expiry_date, "accounts_updated": moodle_updated}
    if moodle_errors:
        result["moodle_warnings"] = moodle_errors
    return result


@app.post("/api/admin/requests/{request_id}/send-accounts")
async def admin_send_accounts(request_id: int, background_tasks: BackgroundTasks,
                              _=Depends(require_admin)):
    """Повторно отправить аккаунты Moodle клиенту (ручная отправка из админки)"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM requests WHERE id=%s", (request_id,))
            req = await cur.fetchone()
            if not req:
                raise HTTPException(404, "Заявка не найдена")
            await cur.execute(
                "SELECT username, password FROM moodle_accounts WHERE request_id=%s ORDER BY id",
                (request_id,)
            )
            accounts = list(await cur.fetchall())
    if not accounts:
        raise HTTPException(400, "Аккаунты для этой заявки ещё не созданы")
    expiry = str(req["access_expiry_date"]) if req.get("access_expiry_date") else None
    course_id = await _get_moodle_course_id(req.get("course_name", ""))
    course_url = f"{MOODLE_URL}/course/view.php?id={course_id}" if course_id else ""
    background_tasks.add_task(
        _send_accounts_email,
        req.get("contact_email", ""),
        accounts,
        req.get("course_name", ""),
        expiry,
        course_url,
    )
    return {"ok": True, "sent_to": req.get("contact_email")}


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
        if resp.status_code == 401:
            raise HTTPException(502, "GitHub token невалиден или истёк — обновите GITHUB_TOKEN в .env")
        if resp.status_code == 404:
            raise HTTPException(404, "site.json не найден в репозитории")
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
        if resp.status_code == 401:
            raise HTTPException(502, "GitHub token невалиден или истёк — обновите GITHUB_TOKEN в .env")
        resp.raise_for_status()
    return {"success": True}


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "GeoCore Lab API"}


async def _read_limited_csv(file: UploadFile) -> pd.DataFrame:
    """Read a public CSV upload with bounded memory and row count."""
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(400, "Требуется CSV файл")

    content = await file.read(MAX_CSV_BYTES + 1)
    if len(content) > MAX_CSV_BYTES:
        max_mb = MAX_CSV_BYTES / 1024 / 1024
        raise HTTPException(413, f"CSV слишком большой. Максимум: {max_mb:.1f} MB")

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV должен быть в кодировке UTF-8")

    data_rows = max(0, len(text.splitlines()) - 1)
    if data_rows > MAX_CSV_ROWS:
        raise HTTPException(413, f"Слишком много строк в CSV. Максимум: {MAX_CSV_ROWS}")

    try:
        df = pd.read_csv(io.StringIO(text))
    except Exception as e:
        raise HTTPException(400, f"Ошибка чтения CSV: {str(e)}")

    if len(df) > MAX_CSV_ROWS:
        raise HTTPException(413, f"Слишком много строк в CSV. Максимум: {MAX_CSV_ROWS}")
    return df


def _require_positive(value: float, name: str) -> None:
    if value <= 0:
        raise HTTPException(400, f"{name} должен быть больше 0")


@app.post("/api/validate")
async def validate(
    file: UploadFile = File(..., description="CSV файл с данными опробования")
):
    """Только валидация CSV файла"""
    df = await _read_limited_csv(file)
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
    _require_positive(composite_length, "composite_length")
    _require_positive(block_size, "block_size")
    if cutoff < 0:
        raise HTTPException(400, "cutoff должен быть >= 0")
    if decluster_method not in {"none", "cell", "polygon", "distance"}:
        raise HTTPException(400, "Недопустимый decluster_method")
    if wireframe_method not in {"convex_hull", "alpha_shape", "sections"}:
        raise HTTPException(400, "Недопустимый wireframe_method")
    if mac_style not in {"standard", "simple", "variogram", "coal", "porphyry"}:
        raise HTTPException(400, "Недопустимый mac_style")

    df = await _read_limited_csv(file)
    
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
    if cutoff < 0:
        raise HTTPException(400, "cutoff должен быть >= 0")
    if method not in {"convex_hull", "alpha_shape", "sections"}:
        raise HTTPException(400, "Недопустимый method")

    df = await _read_limited_csv(file)
    
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
    _require_positive(composite_length, "composite_length")
    if cutoff < 0:
        raise HTTPException(400, "cutoff должен быть >= 0")
    if style not in {"standard", "simple", "variogram", "coal", "porphyry"}:
        raise HTTPException(400, "Недопустимый style")

    df = await _read_limited_csv(file)
    
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


_CHAT_SYSTEM_PROMPT = """Ты — GeoCore Assistant, образовательный AI-ассистент платформы GeoCore Academy (geocore-academy.ru).

ВАЖНО: Начинай ответ СРАЗУ с текста ответа. Никакого внутреннего монолога, рассуждений вслух, анализа задачи — только финальный ответ на русском языке.

РОЛЬ: Помогаешь разобраться в концепциях геологии и горного дела, направляешь к обучению. Не пишешь готовые пошаговые инструкции-шпаргалки. Объясняешь суть и принципы.

ФОРМАТ: 2–4 предложения, по-русски. Если тема охвачена курсом — упомяни: «Подробнее — в курсе "Название"».

КУРСЫ GEOCORE ACADEMY:
- Геологическое моделирование (Базовый) — структурное и литологическое моделирование, интерпретация скважин
- Геостатистика (Базовый) — вариограммный анализ, кригинг, оценка ресурсов МПИ
- Комплексный кейс Тренажёра — полный цикл ГРР на виртуальном месторождении, JORC/CRIRSCO
- Нейросети для прогнозирования — ML для геологических параметров и оценки ресурсов
- Математические методы анализа геохимии — кластеризация, факторный анализ, геохимические аномалии
- Тренажёр поисков и разведки — планирование поисковых работ, методы опробования

ЗАПИСЬ И УСЛОВИЯ:
- Записаться: форма на сайте geocore-academy.ru или письмо на info@geocore-academy.ru
- Стоимость: по запросу (уточнять через форму или email)
- Темп: свободный, дедлайнов нет
- По окончании курса выдаётся сертификат

НЕ ДЕЛАЙ: не показывай процесс рассуждений, не пиши «Давайте рассмотрим», «Итак», «Хорошо»."""


def _clean_thinking(content: str) -> str:
    """Удаляет thinking-монолог из ответа reasoning-моделей."""
    if not content:
        return content
    # Явный маркер "Possible response:" или "Final answer:"
    for marker in ("Possible response:", "Final answer:", "Мой ответ:", "Ответ:"):
        if marker in content:
            after = content.split(marker, 1)[-1].strip().strip('"\'')
            if len(after) > 30:
                return after
    # Если ответ начинается с признаков thinking на английском или русском —
    # берём последние 2 абзаца как финальный ответ
    thinking_starts = ("okay", "let me", "the user", "хорошо,", "давайте", "итак,", "пользователь")
    first_line = content.split("\n")[0].lower().strip()
    if any(first_line.startswith(s) for s in thinking_starts):
        paras = [p.strip() for p in content.split("\n\n") if p.strip()]
        if len(paras) > 1:
            candidate = "\n\n".join(paras[-2:])
            if len(candidate) > 30:
                return candidate
    return content

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(503, "AI-ассистент временно недоступен")
    messages = [{"role": "system", "content": _CHAT_SYSTEM_PROMPT}]
    for m in req.history[-6:]:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": req.message})
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={"model": "openai/gpt-4o-mini", "messages": messages, "max_tokens": 400},
            )
        if r.status_code != 200:
            raise HTTPException(502, "Ошибка AI-сервиса")
        reply = _clean_thinking(r.json()["choices"][0]["message"]["content"] or "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Ошибка AI-сервиса: {type(e).__name__}")
    return {"reply": reply}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
