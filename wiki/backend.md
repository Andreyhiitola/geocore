# Backend (FastAPI)

## Доступ

- Production: https://api.geocore-academy.ru
- Локальный тест: http://localhost:8001
- Файл: `backend/main.py`

## Эндпоинты

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/` | Health check |
| GET | `/api/courses` | Курсы из Moodle (через Web Services) |
| POST | `/api/requests` | Заявка на корпоративное обучение |

## Переменные окружения

```env
API_SECRET_KEY=        # случайная строка 32+ символа
MOODLE_URL=https://courses.geocore-academy.ru
MOODLE_TOKEN=          # токен Web Services из Moodle
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=9624294@gmail.com
SMTP_PASS=             # Gmail App Password
NOTIFY_EMAIL=info@geocore-academy.ru
```

## Moodle API

- URL: `{MOODLE_URL}/webservice/rest/server.php` (без s в webservice!)
- Функция: `core_course_get_courses`
- Зависимость: `httpx` (async HTTP клиент)

## Email

- Библиотека: `smtplib` (стандартная)
- Отправка через `BackgroundTasks` — не блокирует ответ API
- Логика: уведомление на NOTIFY_EMAIL + авто-ответ клиенту

## Геологические расчёты

- Папка: `backend/processing/`
- FastAPI-роуты для геологических алгоритмов

## Docker

- Образ: `python:3.11-slim`
- Dockerfile: `backend/Dockerfile`
- Зависимости: `backend/requirements.txt` (включает httpx)

## Связанные разделы

- [[email]] — детали SMTP настройки
- [[moodle]] — Web Services токен
- [[problems]] — опечатка /webservice/rest/
