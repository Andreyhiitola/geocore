# GeoCore Academy — Статус проекта

> Последнее обновление: 20 апреля 2026  
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
| Фронтенд (index/courses/lab/sandbox) | ✅ работает — geocore-academy.ru |
| Форма заявки на корпоративное обучение | ✅ работает — БД + email полностью |
| Email (транзакционный) | ✅ Gmail SMTP, уведомления → info@geocore-academy.ru |
| Zoho Mail (info@geocore-academy.ru) | ✅ настроен, MX/SPF/DKIM зелёные |
| Мобильная версия сайта | ✅ работает без доработок |
| Wiki (knowledge base) | ✅ создана — wiki/ в репозитории |
| Тесты в Moodle | ⏳ файлы проверены, ожидает ручного импорта через UI |
| Конвертеры тестов (tools/) | ✅ в репозитории, GUI-лаунчер готов |
| Мониторинг VPS + Telegram | ✅ работает — алерты, кнопки Статус/Бэкап/История |
| Админка (admin.html) | ✅ авторизация логин+токен, архив заявок |
| Тема день/ночь | ✅ синхронна на всех страницах (единый ключ geocoreLight) |
| Бэкапы (Selectel S3, restic) | ✅ инкрементальные — 8 сек на 3.4 GiB, прогресс в боте |
| Watchtower (автообновление) | ✅ работает — исправлен DOCKER_API_VERSION=1.40 |

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

### Инструменты
- `tools/convert.py` — GUI-лаунчер конвертеров (tkinter), выбор файла через «Обзор…»
- `tools/docx_to_gift.py`, `tools/docx_to_moodle_xml.py` — DOCX → GIFT/XML
- `tools/qti_to_gift.py`, `tools/qti_to_moodle_xml.py` — QTI 1.2 → GIFT/XML
- `tools/README.md` — инструкция по запуску

### Решённые проблемы
- **ERR_TOO_MANY_REDIRECTS** — Moodle за SSL-прокси уходил в бесконечный редирект. Фикс: `$CFG->sslproxy = true` в config.php (генерируется автоматически когда WWWROOT начинается с https://)
- **cookiesecure** — при локальном тесте на HTTP отключается автоматически
- **"cookies отключены" на странице входа** — шаблон `loginform.mustache` оборачивал форму в `{{#cookiesenabled}}`, но PHP никогда не передаёт это поле — форма не рендерилась. Фикс: убрана обёртка

---

## Что осталось сделать

### 1. Импорт тестов в Moodle
Файлы проверены (сессия 11), готовы к импорту:
- `~/Downloads/WhatSie/test_semester1.xml` — **25 вопросов**, 4 изображения → Банк вопросов → Импорт → **Moodle XML**
- `~/Downloads/WhatSie/test_datamine.xml` — **30 вопросов**, 2 изображения → Банк вопросов → Импорт → **Moodle XML**
- После импорта: проверить изображения в вопросах, создать тест из банка

### 1. Деплой мониторинга и бэкапов на VPS
Код готов в репо. На VPS нужно:
- Создать Telegram бота (@BotFather → /newbot)
- Зарегистрироваться на Selectel → Object Storage → bucket `geocore-backups`
- Прописать переменные в `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `git pull && docker compose up -d --build watchdog backup`
- Настроить UptimeRobot (внешний мониторинг VPS)

### 2. SCORM редизайн (CourseLab)
`scorm-tools/Leapfrog_geocore_v3.zip` готов — нужно протестировать в Moodle.
Когда будет доступ к CourseLab — применить редизайн напрямую в .clf и переопубликовать.
Скрипт переупаковки: `scorm-tools/repack.sh`

### 2. Саморегистрация студентов в Moodle
Настроить самостоятельную запись на курсы. Не приоритет.

### 3. Email — переход на платный Zoho
Сейчас транспорт Gmail SMTP. При переходе на платный Zoho:
- Поменять SMTP_HOST=smtp.zoho.eu, SMTP_USER=info@geocore-academy.ru, SMTP_PASS=<zoho>
- docker compose up -d --force-recreate backend

### 4. UptimeRobot (внешний мониторинг VPS)
Если VPS упадёт — внутренний watchdog тоже умрёт. Нужен внешний пинг.
uptimerobot.com (бесплатно) → добавить мониторы для трёх доменов → подключить Telegram.

### 5. www.geocore-academy.ru
Нет DNS записи — не приоритет.

### 6. Разделение бэкенда
Сейчас весь код в `backend/main.py`. Нужно разделить:
- **VPS API** — курсы, заявки, admin (остаётся на VPS)
- **Локальный API** — геологические расчёты (processing/) на локальном сервере в сети Wi-Fi, VPS не потянет тяжёлые вычисления

### 7. Саморегистрация студентов в Moodle
Не приоритет.

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
