# GeoCore Academy — Статус проекта

> Последнее обновление: апрель 2026  
> Репозиторий: https://github.com/Andreyhiitola/geocore  
> Домен: geocore-academy.ru

---

## Архитектура

```
Браузер
   ↓ HTTPS
nginx (на VPS, хост)
   ├── courses.geocore-academy.ru → 127.0.0.1:8080 → geocore_moodle (PHP/Apache)
   └── api.geocore-academy.ru    → 127.0.0.1:8000 → geocore_api (FastAPI) [не запущен]
                                         ↓
                                  geocore_db (MariaDB 10.11)
```

---

## Текущий статус (апрель 2026)

| Компонент | Статус |
|-----------|--------|
| DNS (courses, api → VPS) | ✅ настроен |
| nginx + SSL (Let's Encrypt) | ✅ работает |
| MariaDB контейнер | ✅ работает |
| Moodle 5.1.3 контейнер | ✅ работает, тема geocore активна |
| courses.geocore-academy.ru | ✅ открывается |
| GitHub Actions CI/CD | ✅ работает — автодеплой по git push |
| FastAPI контейнер | ✅ работает |
| api.geocore-academy.ru | ✅ отвечает |
| Фронтенд (index/courses/lab) | ✅ работает — geocore-academy.ru |

---

## Что сделано

### Инфраструктура
- `moodle/Dockerfile` — единый для Moodle 4.x и 5.x, загрузка через tarball
- `moodle/entrypoint.sh` — автоустановка, автообновление (upgrade.php), генерация config.php из env, sslproxy при HTTPS
- `moodle/theme/geocore` — кастомная тёмная тема, активируется автоматически при первом старте
- `backend/Dockerfile` — FastAPI на python:3.11-slim
- `docker-compose.yml` — production (образы с Docker Hub)
- `docker-compose.test.yml` — локальный тест (порт 8081/8001)
- `nginx/geocore.conf` — reverse proxy с SSL для обоих поддоменов
- `.env.example` — шаблон всех переменных
- `.github/workflows/deploy.yml` — CI/CD: пересборка только при изменениях backend/ или moodle/, деплой на VPS по SSH

### Решённые проблемы
- **ERR_TOO_MANY_REDIRECTS** — Moodle за SSL-прокси уходил в бесконечный редирект. Фикс: `$CFG->sslproxy = true` в config.php (генерируется автоматически когда WWWROOT начинается с https://)
- **cookiesecure** — при локальном тесте на HTTP отключается автоматически
- **"cookies отключены" на странице входа** — шаблон `loginform.mustache` оборачивал форму в `{{#cookiesenabled}}`, но PHP никогда не передаёт это поле — форма не рендерилась. Фикс: убрана обёртка

---

## Что осталось сделать

### 1. Ребрендинг SCORM — Паспортизация
В SCORM-пакете Паспортизации на слайдах остался логотип Полиметала и упоминание «АО Полиметалл».
Нужно определить координаты логотипа и запустить скрипт удаления (`tools/remove_logo.py`).
Чеклист: `SCORM_REBRANDING.md`

### 2. Саморегистрация студентов в Moodle
Настроить самостоятельную запись на курсы.

### 3. www.geocore-academy.ru
Нет DNS записи — не приоритет.

---

## Переменные окружения (`.env` на VPS, заполнять вручную)

```env
DOCKERHUB_USER=...
MOODLE_VERSION=5.1.3

DB_ROOT_PASSWORD=         # сильный пароль
MOODLE_DB_NAME=moodle
MOODLE_DB_USER=moodle
MOODLE_DB_PASSWORD=       # сильный пароль

MOODLE_WWWROOT=https://courses.geocore-academy.ru
MOODLE_SITE_NAME=Geocore-Academy
MOODLE_SITE_SHORTNAME=geocore
MOODLE_LANG=ru

MOODLE_ADMIN_USER=admin
MOODLE_ADMIN_PASS=        # мин. 8 символов, буквы + цифры
MOODLE_ADMIN_EMAIL=       # реальный email

API_SECRET_KEY=           # случайная строка 32+ символа
```

---

## Алгоритм обновления Moodle

```
1. Вышел новый тег (например v5.1.4)
2. Меняешь MOODLE_VERSION в docker-compose.test.yml
3. docker compose -f docker-compose.test.yml down -v
4. docker compose -f docker-compose.test.yml up --build
5. Проверяешь localhost:8081
6. Если OK → меняешь MOODLE_VERSION в .github/workflows/deploy.yml
7. git commit && git push → автодеплой на VPS
8. Данные сохраняются (upgrade.php обновляет только схему БД)
```

---

## Структура репозитория

```
geocore/
├── .env.example
├── .github/workflows/deploy.yml   # CI/CD
├── backend/
│   ├── Dockerfile
│   ├── main.py                    # FastAPI
│   ├── requirements.txt
│   └── processing/                # геологические алгоритмы
├── moodle/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── php.ini
│   └── theme/geocore/             # кастомная тёмная тема
├── nginx/geocore.conf
├── docker-compose.yml             # production
├── docker-compose.test.yml        # локальный тест
├── index.html / courses.html / lab.html
├── ARCHITECTURE.md
├── MOODLE_GUIDE.md
└── STATUS.md                      # этот файл
```
