# Инфраструктура

## Схема

```
Браузер → HTTPS
  → nginx (хост VPS, не в Docker)
      ├── geocore-academy.ru        → geocore_frontend (nginx:alpine, порт 80)
      ├── courses.geocore-academy.ru → geocore_moodle (PHP/Apache, порт 8080)
      └── api.geocore-academy.ru    → geocore_api (FastAPI, порт 8000)
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
- **Что бэкапит:** дамп MariaDB (mysqldump по сети к `mariadb:3306`) + архив volume `moodle_data`
- **Где хранит:** Selectel S3 (`https://s3.selectel.ru`), bucket `geocore-backups`
- **GFS-ротация:** 7 ежедневных / 4 еженедельных / 12 ежемесячных → ~17 GB/год
- **Провайдер:** Selectel — VPS в той же сети, трафик бэкапов бесплатный, ~36₽/мес за 20 GB
- Переменные: `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION=ru-1`
- При успехе и ошибке → уведомление в Telegram

## Связанные разделы

- [[moodle]] — детали по контейнеру Moodle
- [[backend]] — детали по FastAPI
- [[problems]] — проблемы с Docker cp, редиректами
