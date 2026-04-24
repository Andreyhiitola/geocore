# GeoCore Academy — Бэкапы и восстановление

> Последнее обновление: 2026-04-24

---

## Что бэкапится и где хранится

| Данные | Размер (прим.) | Метод | Хранилище |
|--------|---------------|-------|-----------|
| MariaDB (`moodle` БД) | ~10–50 МБ | mysqldump → gzip | restic → Selectel S3 |
| moodledata (файлы курсов, аватары, сессии) | ~3–4 ГБ | tar snapshot | restic → Selectel S3 |

Бэкап запускается **ежедневно в 02:00** внутри контейнера `geocore_backup` (cron).

---

## Два backup-скрипта: какой используется

В репозитории два скрипта — важно не путать:

| Файл | Метод | Используется? |
|------|-------|--------------|
| `scripts/backup.sh` | **restic** → Selectel S3 (инкрементальный) | ✅ **Продакшен** (контейнер `geocore_backup`) |
| `backup/scripts/backup.sh` | **aws s3 cp** → plain tar.gz (GFS-ротация) | ❌ Не в контейнере, ручной запуск |

`backup/Dockerfile` копирует именно `scripts/backup.sh` (restic).  
`backup/scripts/backup.sh` — альтернативный скрипт для ситуаций, когда нужны plain-файлы в S3 (например, для `scripts/restore.sh`).

---

## Переменные окружения

Все задаются в `.env` на VPS. Минимальный набор для работы бэкапов:

```env
# Selectel S3
S3_ENDPOINT=https://s3.ru-3.storage.selcloud.ru
S3_BUCKET=geocore-backups
AWS_ACCESS_KEY_ID=<ключ сервисного пользователя Selectel>
AWS_SECRET_ACCESS_KEY=<секрет сервисного пользователя Selectel>
AWS_DEFAULT_REGION=ru-3

# restic
RESTIC_PASSWORD=<придумать один раз, хранить отдельно от сервера>

# Telegram (опционально — уведомления о результате)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

> ⚠️ `RESTIC_PASSWORD` — единственный ключ к зашифрованному архиву. Потеря = потеря данных. Хранить в менеджере паролей или бумажной записке.

> ℹ️ Если VPS ходит в интернет через прокси, добавить в `.env`:
> ```
> HTTPS_PROXY=http://host:port
> ```
> И при ручном запуске: `HTTPS_PROXY=... ./scripts/restore.sh`

---

## Настройка Selectel S3

1. Selectel Console → Cloud Storage → Object Storage → Создать bucket `geocore-backups`
2. Профиль → Сервисные пользователи → Создать пользователя → выдать права на bucket
3. Скопировать Access Key и Secret Key в `.env`

Проверить подключение с VPS:
```bash
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/
```

---

## Ручной запуск бэкапа

```bash
# Запустить один раз прямо сейчас (не ждать 02:00)
docker exec geocore_backup /scripts/backup.sh

# Смотреть логи контейнера
docker logs -f geocore_backup

# Или файл лога внутри контейнера
docker exec geocore_backup tail -50 /var/log/backup.log
```

---

## Просмотр снимков (snapshots)

```bash
# Список всех снимков
docker exec geocore_backup restic snapshots

# Последние 5
docker exec geocore_backup restic snapshots --latest 5

# Что внутри последнего снимка
docker exec geocore_backup restic ls latest
```

Пример вывода:
```
ID        Time                 Host        Tags
──────────────────────────────────────────────────────
a1b2c3d4  2026-04-24 02:00:05  geocore     geocore, 2026-04-24
e5f6g7h8  2026-04-23 02:00:03  geocore     geocore, 2026-04-23
```

---

## Восстановление

### Метод 1 — из restic (рекомендуется, production-данные)

Restic хранит данные в собственном формате — `aws s3 cp` из них не поможет. Нужен `restic restore`.

```bash
# 1. Создать временную папку
mkdir -p /tmp/geocore-restore

# 2. Восстановить последний снимок
docker exec geocore_backup restic restore latest --target /tmp/geocore-restore

# Либо конкретный снимок по ID
docker exec geocore_backup restic restore a1b2c3d4 --target /tmp/geocore-restore
```

Внутри `/tmp/geocore-restore` появятся:
```
tmp/db-2026-04-24.sql.gz   ← дамп БД
moodledata/                 ← файлы Moodle
```

```bash
# 3. Остановить Moodle
docker compose stop moodle

# 4. Найти volume moodledata
docker volume ls | grep moodle
# → geocore_moodle_data (или аналогичное)

# 5. Восстановить moodledata в volume (Moodle должен быть остановлен — шаг 3)
docker run --rm \
  -v geocore_moodle_data:/moodledata \
  -v /tmp/geocore-restore/moodledata:/source:ro \
  alpine \
  sh -c 'find /moodledata -mindepth 1 -delete && cp -a /source/. /moodledata/ && chown -R 33:33 /moodledata'

# 6. Восстановить БД
MARIADB_ID=$(docker compose ps -q mariadb)
gunzip -c /tmp/geocore-restore/tmp/db-*.sql.gz \
  | docker exec -i "$MARIADB_ID" mysql -u moodle -p"${MOODLE_DB_PASSWORD}" moodle

# 7. Поднять всё
docker compose up -d

# 8. Почистить кэш
docker exec geocore_moodle php /var/www/html/admin/cli/purge_caches.php
```

### Метод 2 — из plain S3 (scripts/restore.sh)

`scripts/restore.sh` работает с файлами, созданными `backup/scripts/backup.sh` (plain tar.gz в S3 с путями `daily/db-YYYY-MM-DD.sql.gz`). Это удобнее для автоматического восстановления, но требует настроить aws S3 backup дополнительно к restic.

**Запуск с реальными данными из S3:**
```bash
cd /opt/geocore

# Сначала — проверка без восстановления
S3_BUCKET=geocore-backups \
MOODLE_DB_PASSWORD="${MOODLE_DB_PASSWORD}" \
./scripts/restore.sh --dry-run

# Реальное восстановление последнего daily
S3_BUCKET=geocore-backups \
MOODLE_DB_PASSWORD="${MOODLE_DB_PASSWORD}" \
./scripts/restore.sh

# Или конкретную дату
S3_BUCKET=geocore-backups \
MOODLE_DB_PASSWORD="${MOODLE_DB_PASSWORD}" \
./scripts/restore.sh 2026-04-24
```

Все переменные можно не передавать вручную, если они уже в `.env`:
```bash
set -a && source /opt/geocore/.env && set +a
./scripts/restore.sh
```

---

## Тренировка на локальном окружении

Позволяет отработать процедуру без риска затронуть продакшен.

### Вариант 1 — dry-run с реальным S3 (проверяет доступность файлов)
```bash
set -a && source /opt/geocore/.env && set +a

COMPOSE_FILE=docker-compose.test.yml \
MOODLE_SERVICE=moodle-test \
MARIADB_SERVICE=mariadb-test \
MOODLE_DB_NAME=moodle_test \
MOODLE_DB_USER=moodle \
MOODLE_DB_PASSWORD=testpass \
MOODLE_URL=http://localhost:8082 \
./scripts/restore.sh --dry-run
# → показывает список бэкапов в S3, проверяет доступность, ничего не меняет
```

### Вариант 2 — полное восстановление в тестовое окружение
```bash
# Запустить тестовый стек
docker compose -f docker-compose.test.yml up -d

# Восстановить из S3 в тестовый стек
set -a && source /opt/geocore/.env && set +a

COMPOSE_DIR=$(pwd) \
COMPOSE_FILE=docker-compose.test.yml \
MOODLE_SERVICE=moodle-test \
MARIADB_SERVICE=mariadb-test \
MOODLE_DB_NAME=moodle_test \
MOODLE_DB_USER=moodle \
MOODLE_DB_PASSWORD=testpass \
MOODLE_URL=http://localhost:8082 \
./scripts/restore.sh 2026-04-24

# Открыть и проверить
xdg-open http://localhost:8082
```

> ⚠️ Тестовые volume (`moodle_test_data`) не связаны с продакшеном — ничего не пострадает.

---

## Смена пароля restic

Перешифровывает мастер-ключ — все старые снимки остаются доступны по новому паролю:

```bash
docker exec -it geocore_backup restic key passwd
# спросит: старый пароль → новый → повтор
```

После этого обновить `RESTIC_PASSWORD` в `.env` и перезапустить контейнер:

```bash
docker compose up -d --force-recreate backup
```

---

## Регулярная проверка бэкапов (раз в месяц)

```bash
# 1. Убедиться что снимки есть и свежие
docker exec geocore_backup restic snapshots --latest 3

# 2. Проверить целостность репозитория
docker exec geocore_backup restic check

# 3. Сверить размер последнего снимка (должен быть сопоставим с предыдущим)
docker exec geocore_backup restic stats latest
```

---

## Runbook: продакшен упал, нужно поднять с нуля

```
1. Арендовать новый VPS (или починить текущий)
2. Установить Docker + Docker Compose v2
3. git clone https://github.com/Andreyhiitola/geocore /opt/geocore
4. cp .env.example .env && nano .env  ← заполнить все переменные
5. docker compose up -d               ← поднимает пустой стек
6. Убедиться что MariaDB отвечает:
   docker exec geocore_db mysqladmin ping
7. Восстановить данные (Метод 1 или 2 выше)
8. docker compose up -d               ← перезапуск с восстановленными данными
9. Проверить https://courses.geocore-academy.ru
```

Время восстановления (ориентир): ~15–30 минут (скачать бэкап + импорт).

---

## Возможные проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| `RESTIC_PASSWORD не задан` | Нет в `.env` | Добавить, взять из менеджера паролей |
| `no such bucket` | Bucket не создан в Selectel | Создать через Console, проверить имя |
| `Access Denied` | Неверные ключи или нет прав | Проверить ключи сервисного пользователя |
| `restic: wrong password` | Потеря RESTIC_PASSWORD | Старые снимки недоступны, только новый репозиторий |
| Volume не найден при restore | Compose ещё не поднимался | `docker compose up -d` → потом restore |
| Moodle не отвечает после restore | Идёт миграция БД | Подождать 2–5 мин, проверить `docker logs geocore_moodle` |
