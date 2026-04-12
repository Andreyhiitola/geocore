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

## Связанные разделы

- [[moodle]] — детали по контейнеру Moodle
- [[backend]] — детали по FastAPI
- [[problems]] — проблемы с Docker cp, редиректами
