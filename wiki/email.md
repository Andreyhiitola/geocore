# Email

## Текущая конфигурация

| Параметр | Значение |
|---------|---------|
| Транспорт | Gmail SMTP (`smtp.gmail.com:587`) |
| Авторизация | App Password (не обычный пароль) |
| From | `GeoCore Academy <9624294@gmail.com>` |
| Reply-To | `info@geocore-academy.ru` |
| Уведомления о заявках | `NOTIFY_EMAIL=info@geocore-academy.ru` |

## Zoho Mail

- Домен: `info@geocore-academy.ru`
- DNS: MX, SPF, DKIM — все настроены и зелёные (FirstVDS)
- Zoho Free **не поддерживает** внешний SMTP → Gmail как транспорт
- Входящие заявки приходят в Zoho inbox

## Переменные окружения

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=9624294@gmail.com
SMTP_PASS=<gmail_app_password>
NOTIFY_EMAIL=info@geocore-academy.ru
```

## Что отправляется

1. **Уведомление администратору** — при новой заявке на корпоративное обучение → на NOTIFY_EMAIL
2. **Авто-ответ клиенту** — подтверждение получения заявки

## Форма заявки

- Кнопка "Записаться" → модальное окно на `index.html` и `courses.html`
- `POST /api/requests` в FastAPI — принимает заявку, шлёт email через `BackgroundTasks`

## Миграция на платный Zoho

При готовности — только меняем в `.env` на VPS:
```env
SMTP_HOST=smtp.zoho.eu
SMTP_USER=info@geocore-academy.ru
SMTP_PASS=<zoho_password>
```
Затем: `docker compose up -d --force-recreate backend`

## Связанные разделы

- [[backend]] — реализация отправки в main.py
- [[problems]] — проблема с From-адресом
- [[decisions]] — почему Gmail + Zoho
