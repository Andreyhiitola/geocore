# Backend (FastAPI)

## Доступ

- Production: https://api.geocore-academy.ru
- Локальный тест: http://localhost:8001
- Файл: `backend/main.py`

## Эндпоинты

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/health` | Проверка доступности |
| GET | `/api/courses` | Курсы из Moodle (через Web Services) |
| POST | `/api/requests` | Заявка на корпоративное обучение |
| GET | `/api/admin/requests` | Список заявок (требует ADMIN_TOKEN) |
| PATCH | `/api/admin/requests/{id}` | Изменить статус заявки |
| POST | `/api/admin/requests/{id}/mark-paid` | Подтвердить оплату → создать аккаунты Moodle + email |
| POST | `/api/admin/requests/{id}/extend-access` | Продлить доступ: обновить дату в БД и timeend в Moodle |
| POST | `/api/admin/requests/{id}/send-accounts` | Повторно отправить credentials клиенту |
| POST | `/api/admin/requests/{id}/generate-invoice` | Сформировать PDF счёт |
| POST | `/api/admin/requests/{id}/generate-contract` | Сформировать PDF договор |
| GET | `/api/admin/site-json` | Получить site.json из GitHub |
| PUT | `/api/admin/site-json` | Сохранить site.json → запускает CI/CD деплой |
| POST | `/api/validate` | Валидация CSV |
| POST | `/api/process` | Полная геологическая обработка |
| POST | `/api/wireframe` | Только построение каркаса OBJ |
| POST | `/api/mac` | Только генерация .mac скрипта |

## Переменные окружения

```env
MOODLE_URL=https://courses.geocore-academy.ru
MOODLE_TOKEN=          # токен Web Services из Moodle (нужен для /api/courses)
ADMIN_TOKEN=           # Bearer-токен для /api/admin/*
GITHUB_TOKEN=          # для редактирования site.json через GitHub API
GITHUB_REPO=Andreyhiitola/geocore
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=             # Gmail-аккаунт
SMTP_PASS=             # Gmail App Password
NOTIFY_EMAIL=info@geocore-academy.ru
DB_HOST=mariadb
DB_NAME=moodle
DB_USER=moodle
DB_PASSWORD=
```

## Геологические расчёты

Папка `backend/processing/` — модули тяжёлых вычислений:

| Модуль | Назначение |
|--------|-----------|
| `validator.py` | Валидация CSV, определение поля значений |
| `compositor.py` | Композитирование интервалов |
| `decluster.py` | Декластеризация (cell / polygon / distance) |
| `wireframe_gen.py` | Каркасы OBJ (convex_hull / alpha_shape / sections) |
| `mac_generator.py` | .mac скрипты для Datamine Studio RM |

Пайплайн `/api/process`: validate → composite → decluster → wireframe → mac.

> В перспективе геологические расчёты переедут на локальный сервер в сети Wi-Fi — VPS не потянет тяжёлые вычисления. Пока всё в одном `main.py`.

## Admin API

Все `/api/admin/*` защищены через `Authorization: Bearer <ADMIN_TOKEN>`.
`PUT /api/admin/site-json` — сохраняет `frontend/js/data/site.json` через GitHub API, что триггерит CI/CD деплой фронтенда.

## Moodle API

- URL: `{MOODLE_URL}/webservice/rest/server.php` (без s в webservice!)
- Функции: `core_course_get_courses`, `core_user_create_users`, `enrol_manual_enrol_users`
- Зачисление: `roleid=5` (student), `timeend` = Unix timestamp в **UTC** (`calendar.timegm`, не `time.mktime`)
- Доступ к курсу: только через зачисление — незачисленные курсы заблокированы Moodle автоматически
- Ответ API всегда проверяется на `exception` в теле (HTTP 200 + JSON с ошибкой — норма для Moodle)

## Pipeline выдачи доступа

```
mark-paid → _create_moodle_accounts → core_user_create_users + enrol_manual_enrol_users
          → _send_accounts_email (прямая ссылка /course/view.php?id=X)
```

Продление: `extend-access?expiry_date=YYYY-MM-DD` → обновляет БД + `enrol_manual_enrol_users` с новым `timeend`.

## Email

- Библиотека: `smtplib` (стандартная)
- Отправка через `BackgroundTasks` — не блокирует ответ API
- Письмо с credentials содержит прямую ссылку на курс (не корень платформы)

## Docker

- Образ: `python:3.11-slim`
- Dockerfile: `backend/Dockerfile`

## Связанные разделы

- [[email]] — детали SMTP настройки
- [[moodle]] — Web Services токен
- [[problems]] — известные проблемы
- [[decisions]] — почему расчёты будут на локальном сервере
