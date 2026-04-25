# GeoCore Academy — Бэкапы и восстановление

> Последнее обновление: 2026-04-25

---

## Как работает

Контейнер `geocore_backup` запускает `scripts/backup.sh` **ежедневно в 02:00**.

```
MariaDB (mysqldump) ──┐
                      ├──→ /tmp/  ──→ Selectel S3 (geocore-backups)
moodledata (tar.gz) ──┘
```

**GFS-ротация в S3:**

| Папка | Хранится | Когда создаётся |
|-------|----------|----------------|
| `daily/` | 7 штук | каждый день |
| `weekly/` | 4 штуки | каждое воскресенье |
| `monthly/` | 12 штук | 1-го числа |

Файлы в S3: `daily/db-2026-04-24.sql.gz` и `daily/moodle-2026-04-24.tar.gz`.

---

## Переменные окружения

```env
S3_ENDPOINT=https://s3.ru-3.storage.selcloud.ru
S3_BUCKET=geocore-backups
AWS_ACCESS_KEY_ID=<ключ сервисного пользователя Selectel>
AWS_SECRET_ACCESS_KEY=<секрет>
AWS_DEFAULT_REGION=ru-3

# Опционально
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Если VPS за прокси
# HTTPS_PROXY=http://host:port
```

---

## Настройка Selectel S3

1. Selectel Console → Cloud Storage → Object Storage → Создать bucket `geocore-backups` (зона ru-3)
2. Профиль → Сервисные пользователи → Создать → выдать права на bucket
3. Скопировать Access Key и Secret Key в `.env`

Проверить подключение:
```bash
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/
```

---

## Ручной запуск бэкапа

```bash
# Запустить сейчас, не ждать 02:00
docker exec geocore_backup /scripts/backup.sh

# Смотреть лог
docker logs -f geocore_backup
```

---

## Что есть в S3

```bash
# Список всех бэкапов
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/ --recursive

# Только daily
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/daily/
```

---

## Восстановление

Используй `scripts/restore.sh` — он работает напрямую с этими файлами.

```bash
cd /opt/geocore
set -a && source .env && set +a

./scripts/restore.sh --dry-run   # проверить что файлы есть
./scripts/restore.sh             # восстановить (интерактивный выбор точки)
./scripts/restore.sh 2026-04-24  # конкретная дата
```

Подробнее — см. заголовок `scripts/restore.sh`.

---

## Тренировка на локальной VM

```bash
set -a && source /opt/geocore/.env && set +a  # взять S3-ключи

COMPOSE_DIR=$(pwd) \
COMPOSE_FILE=docker-compose.test.yml \
MOODLE_SERVICE=moodle-test \
MARIADB_SERVICE=mariadb-test \
MOODLE_DB_NAME=moodle_test \
MOODLE_DB_USER=moodle \
MOODLE_DB_PASSWORD=testpass \
MOODLE_URL=http://localhost:8082 \
./scripts/restore.sh --dry-run
```

---

## Регулярная проверка (раз в месяц)

```bash
# Убедиться что свежие бэкапы есть
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru \
  s3 ls s3://geocore-backups/daily/ | tail -5

# Проверить размер — должен быть сопоставим с предыдущими
# Резкое уменьшение = что-то пошло не так при архивировании
```

---

## Runbook: поднять с нуля

```
1. Новый VPS: установить Docker + Compose + nginx + certbot
2. git clone https://github.com/Andreyhiitola/geocore /opt/geocore
3. cp .env.example .env && nano .env
4. docker compose up -d
5. ./scripts/restore.sh
6. certbot + nginx (см. wiki/MIGRATION.md)
7. Проверить courses.geocore-academy.ru
```

Время восстановления: ~20–30 минут.

---

## Архитектурная особенность: crond и Docker env

**Busybox crond не наследует переменные окружения Docker.**
Переменные из `docker-compose.yml environment:` доступны процессу контейнера (PID 1), но не передаются заданиям crond.

Решение (реализовано в `backup/entrypoint.sh`):
```sh
#!/bin/sh
export -p > /tmp/docker_env.sh   # сохранить env при старте контейнера
exec crond -f
```
Crontab: `. /tmp/docker_env.sh && /scripts/backup.sh`

Без этого скрипт молча падал на `S3_BUCKET:?...`, не отправляя уведомлений.

---

## Возможные проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| `S3_BUCKET не задан` | Нет в `.env` или crond не унаследовал env | Добавить в `.env`; убедиться что `entrypoint.sh` есть в образе |
| `Access Denied` | Неверные ключи | Проверить ключи сервисного пользователя |
| `no such bucket` | Bucket не создан | Создать в Selectel Console |
| Файлы не появляются в S3 (только ручные) | Автоматический cron не работает | Пересобрать контейнер: `docker compose up -d --build backup` |
| Бэкап зависает на загрузке 3+ ГБ | `aws s3 cp` без таймаута | `--cli-read-timeout 300` в `s3()` функции (уже в скрипте) |
| Бэкап останавливается на ротации | `aws s3 ls` зависал или `set -e` на ошибке | Блоки ротации обёрнуты в `\|\| true` (уже в скрипте) |
| Moodle не отвечает после restore | Идёт инициализация | Подождать 2–5 мин, `docker logs geocore_moodle` |
