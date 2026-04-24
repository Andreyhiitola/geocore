#!/bin/bash
# GeoCore Academy — резервное копирование с GFS-ротацией в Selectel S3
# Запускается ежедневно в 02:00 из контейнера geocore_backup
# Переменные окружения: приходят из docker-compose (.env на VPS)

set -euo pipefail

# ── Настройки ────────────────────────────────────────────────────────────────
DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u)    # 1=Пн … 7=Вс
DAY_OF_MONTH=$(date +%d)

BACKUP_DIR="/tmp/geocore-backup-${DATE}"
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.ru-3.storage.selcloud.ru}"
S3_BUCKET="${S3_BUCKET:?Переменная S3_BUCKET не задана}"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# ── Утилиты ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; notify "❌ *GeoCore Backup FAILED*\n$(date '+%d.%m.%Y %H:%M')\n$*"; exit 1; }

notify() {
    local message="$1"
    [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]] && return
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="${TELEGRAM_CHAT_ID}" \
        -d parse_mode="Markdown" \
        -d text="${message}" > /dev/null || true
}

s3() { aws --endpoint-url "$S3_ENDPOINT" s3 "$@"; }

# ── Подготовка ───────────────────────────────────────────────────────────────
log "Старт бэкапа за $DATE"
notify "⏳ *GeoCore Backup запущен*\n$(date '+%d.%m.%Y %H:%M')"
mkdir -p "$BACKUP_DIR"

# ── 1. Дамп базы данных ──────────────────────────────────────────────────────
log "Дамп MariaDB..."
DB_FILE="$BACKUP_DIR/db-${DATE}.sql.gz"
mysqldump \
    -h "${DB_HOST:-mariadb}" \
    -u "${MOODLE_DB_USER}" \
    -p"${MOODLE_DB_PASSWORD}" \
    --single-transaction \
    --quick \
    "${MOODLE_DB_NAME}" | gzip > "$DB_FILE" \
    || fail "Ошибка дампа БД"
log "БД: $(du -sh "$DB_FILE" | cut -f1)"

# ── 2. Архив moodledata ──────────────────────────────────────────────────────
log "Архивирование moodledata..."
MOODLE_FILE="$BACKUP_DIR/moodle-${DATE}.tar.gz"
tar -czf "$MOODLE_FILE" /moodledata \
    || fail "Ошибка архивирования moodledata"
log "moodledata: $(du -sh "$MOODLE_FILE" | cut -f1)"

# ── 3. Сохранение размеров до удаления ───────────────────────────────────────
DB_SIZE=$(du -sh "$DB_FILE" | cut -f1)
MOODLE_SIZE=$(du -sh "$MOODLE_FILE" | cut -f1)

# ── 4. Загрузка в S3 ─────────────────────────────────────────────────────────
log "Загрузка ежедневного бэкапа в S3..."
s3 cp "$DB_FILE"     "s3://${S3_BUCKET}/daily/db-${DATE}.sql.gz"     || fail "Ошибка загрузки db в S3"
s3 cp "$MOODLE_FILE" "s3://${S3_BUCKET}/daily/moodle-${DATE}.tar.gz" || fail "Ошибка загрузки moodle в S3"

# Еженедельный (каждое воскресенье)
if [[ "$DAY_OF_WEEK" == "7" ]]; then
    WEEK=$(date +%Y-W%V)
    log "Еженедельный бэкап ($WEEK)..."
    s3 cp "$DB_FILE"     "s3://${S3_BUCKET}/weekly/db-${WEEK}.sql.gz"
    s3 cp "$MOODLE_FILE" "s3://${S3_BUCKET}/weekly/moodle-${WEEK}.tar.gz"
fi

# Ежемесячный (1-го числа)
if [[ "$DAY_OF_MONTH" == "01" ]]; then
    MONTH=$(date +%Y-%m)
    log "Ежемесячный бэкап ($MONTH)..."
    s3 cp "$DB_FILE"     "s3://${S3_BUCKET}/monthly/db-${MONTH}.sql.gz"
    s3 cp "$MOODLE_FILE" "s3://${S3_BUCKET}/monthly/moodle-${MONTH}.tar.gz"
fi

# ── 5. Ротация старых бэкапов ────────────────────────────────────────────────
log "Ротация daily (оставляем 7)..."
s3 ls "s3://${S3_BUCKET}/daily/" \
    | awk '{print $4}' | grep '^db-' | sort | head -n -7 \
    | while read -r key; do
        s3 rm "s3://${S3_BUCKET}/daily/${key}"
        s3 rm "s3://${S3_BUCKET}/daily/${key/db-/moodle-}" 2>/dev/null || true
    done

log "Ротация weekly (оставляем 4)..."
s3 ls "s3://${S3_BUCKET}/weekly/" \
    | awk '{print $4}' | grep '^db-' | sort | head -n -4 \
    | while read -r key; do
        s3 rm "s3://${S3_BUCKET}/weekly/${key}"
        s3 rm "s3://${S3_BUCKET}/weekly/${key/db-/moodle-}" 2>/dev/null || true
    done

log "Ротация monthly (оставляем 12)..."
s3 ls "s3://${S3_BUCKET}/monthly/" \
    | awk '{print $4}' | grep '^db-' | sort | head -n -12 \
    | while read -r key; do
        s3 rm "s3://${S3_BUCKET}/monthly/${key}"
        s3 rm "s3://${S3_BUCKET}/monthly/${key/db-/moodle-}" 2>/dev/null || true
    done

# ── 6. Финал ─────────────────────────────────────────────────────────────────
rm -rf "$BACKUP_DIR"
log "Бэкап завершён."
notify "✅ *GeoCore Backup OK*\n$(date '+%d.%m.%Y %H:%M')\nDB: ${DB_SIZE} | moodle: ${MOODLE_SIZE}"
