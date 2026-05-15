# Инфраструктура

## Схема

```
Браузер → HTTPS
  → nginx (хост VPS, не в Docker)
      ├── geocore-academy.ru          → geocore_frontend (nginx:alpine, порт 80)
      ├── courses.geocore-academy.ru  → geocore_moodle (PHP/Apache, порт 8080)
      │   └── /content/               → /opt/geocore/courses/ (CourseLab HTML-курсы, диск VPS)
      └── api.geocore-academy.ru      → geocore_api (FastAPI, порт 8000)
                                            ↓
                                      geocore_db (MariaDB 10.11)
```

## VPS

- Провайдер: FirstVDS
- Путь на сервере: `/opt/geocore`
- nginx остаётся **на хосте** (не в Docker) — проще для SSL Let's Encrypt
- Подключение: см. [[../reference_vps]] или memory/reference_vps.md

## Docker

- **Production**: `docker-compose.yml` — тянет образы с Docker Hub
- **Локальный тест**: `docker-compose.test.yml` — порты 8081 (Moodle), 8001 (API)
- Docker Hub аккаунт: `andreysagurov`
- Образы: `geocore-backend`, `geocore-frontend`, `geocore-moodle`
- Теги Moodle: `{версия}-r{N}` (например `5.1.3-r1`) — N увеличивается при наших правках

## CI/CD (GitHub Actions)

- Файл: `.github/workflows/deploy.yml`
- Триггер: push в `main`
- Логика: пересборка образа **только** если изменились файлы в `backend/`, `frontend/`, или `moodle/`
- После сборки — SSH деплой на VPS
- Секреты в GitHub: 5 штук (DockerHub credentials + VPS SSH)

## SSL

- Let's Encrypt через certbot на хосте VPS
- Конфиг nginx: `nginx/geocore.conf`

## Переменные окружения

Файл `.env` на VPS заполняется вручную. Шаблон: `.env.example` в репо.
Критичные переменные: DB_ROOT_PASSWORD, MOODLE_ADMIN_PASS, API_SECRET_KEY, SMTP_PASS.

## Мониторинг

### Внутренний (watchdog)
- Контейнер `geocore_watchdog` — alpine + docker-cli + crond
- Скрипт `scripts/healthcheck.sh` запускается каждые 5 минут
- Проверяет: контейнеры (`docker inspect`), HTTP-эндпоинты, диск (порог 85%), RAM (порог 90%)
- При проблеме → сообщение в Telegram
- Переменные: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` в `.env`

### Внешний (UptimeRobot)
- Нужен отдельно: если VPS упадёт, watchdog умрёт вместе с ним
- uptimerobot.com (бесплатный план) → мониторы: geocore-academy.ru, courses.geocore-academy.ru, api.geocore-academy.ru
- Уведомления → Telegram

## Бэкапы

- Контейнер `geocore_backup` — alpine + mariadb-client + awscli + crond
- Скрипт `scripts/backup.sh` запускается каждый день в 02:00
- **Что бэкапит:** дамп MariaDB + архив volume `moodle_data` + ZIP-архивы курсов
- **Где хранит:** Selectel S3, bucket `geocore-backups` (endpoint `https://s3.ru-3.storage.selcloud.ru`)
  - `daily/`, `weekly/`, `monthly/` — бэкапы БД и Moodle
  - `courses/archives/*.zip` — ZIP-снапшоты CourseLab-курсов (загружает `publish-courses.sh`)
- **GFS-ротация:** 7 ежедневных / 4 еженедельных / 12 ежемесячных
- **Провайдер:** Selectel S3, регион `ru-3`
- Переменные: `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION=ru-3`
- При успехе и ошибке → уведомление в Telegram

⚠️ Bucket policy с `Principal: *` ломает write-доступ на Selectel (Ceph). Для публичного контента — nginx, не bucket policy (см. [[decisions]]).

## Связанные разделы

- [[moodle]] — детали по контейнеру Moodle
- [[backend]] — детали по FastAPI
- [[problems]] — проблемы с Docker cp, редиректами
