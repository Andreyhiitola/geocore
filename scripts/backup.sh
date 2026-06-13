#!/bin/bash
# GeoCore Academy — резервное копирование в Selectel S3 (гибридная схема)
#
#   mysqldump   ──→ daily/weekly/monthly с GFS-ротацией (мало весит, быстро меняется)
#   moodledata  ──→ s3 sync в moodledata-mirror/ (инкрементально, требует versioning на бакете)
#                    + раз в месяц холодный полный tar-снапшот в monthly/
#
# Запускается ежедневно в 02:00 из контейнера geocore_backup
# Переменные окружения: приходят из docker-compose (.env на VPS)

set -euo pipefail

# ── Настройки ────────────────────────────────────────────────────────────────
DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u)   # 1=Пн … 7=Вс
DAY_OF_MONTH=$(date +%d)

BACKUP_DIR="/tmp/geocore-backup-${DATE}"
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.selectel.ru}"
S3_BUCKET="${S3_BUCKET:?Переменная S3_BUCKET не задана}"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# Папки moodledata, которые пересоздаются автоматически — исключаем из бэкапа
TAR_EXCLUDES=(
    --exclude='/moodledata/cache'
    --exclude='/moodledata/localcache'
    --exclude='/moodledata/temp'
    --exclude='/moodledata/trashdir'
)
SYNC_EXCLUDES=(
    --exclude 'cache/*'
    --exclude 'localcache/*'
    --exclude 'temp/*'
    --exclude 'trashdir/*'
)

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

s3() { aws --endpoint-url "$S3_ENDPOINT" --cli-connect-timeout 30 --cli-read-timeout 300 s3 "$@"; }

# Уведомить в Telegram при неожиданных ошибках (set -e)
trap 'fail "Неожиданная ошибка в строке $LINENO"' ERR

# ── Подготовка ───────────────────────────────────────────────────────────────
log "Старт бэкапа за $DATE"
notify "⏳ *GeoCore Backup запущен*\n$(date '+%d.%m.%Y %H:%M')"
mkdir -p "$BACKUP_DIR"
# Чистим BACKUP_DIR при любом завершении (успех, fail() или ERR-trap) — иначе
# при ошибке загрузки в S3 временные файлы (включая месячный tar.gz moodledata)
# остаются в /tmp и забивают диск контейнера/хоста
trap 'rm -rf "$BACKUP_DIR"' EXIT

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
DB_SIZE=$(du -sh "$DB_FILE" | cut -f1)
log "БД: ${DB_SIZE}"

# ── 2. Синхронизация moodledata (инкрементальное зеркало) ────────────────────
log "Синхронизация moodledata в S3 (mirror, исключаем cache/temp/trash)..."
s3 sync /moodledata "s3://${S3_BUCKET}/moodledata-mirror/" \
    "${SYNC_EXCLUDES[@]}" \
    --delete \
    || fail "Ошибка синхронизации moodledata"
log "moodledata: синхронизировано"

# ── 3. Бэкап USN-app SQLite ───────────────────────────────────────────────────
USN_FILE=""
if [ -f "/usn_data/usn.db" ]; then
    log "Копирование USN-app базы..."
    USN_FILE="$BACKUP_DIR/usn-${DATE}.db"
    cp /usn_data/usn.db "$USN_FILE"
    log "USN DB: $(du -sh "$USN_FILE" | cut -f1)"
fi

# ── 4. Загрузка БД в S3 (GFS) ─────────────────────────────────────────────────
log "Загрузка ежедневного бэкапа БД в S3..."
s3 cp "$DB_FILE" "s3://${S3_BUCKET}/daily/db-${DATE}.sql.gz" || fail "Ошибка загрузки db в S3"
[[ -n "$USN_FILE" ]] && s3 cp "$USN_FILE" "s3://${S3_BUCKET}/daily/usn-${DATE}.db" || true

# Еженедельный (каждое воскресенье)
if [[ "$DAY_OF_WEEK" == "7" ]]; then
    WEEK=$(date +%Y-W%V)
    log "Еженедельный бэкап БД ($WEEK)..."
    s3 cp "$DB_FILE" "s3://${S3_BUCKET}/weekly/db-${WEEK}.sql.gz" || fail "Ошибка загрузки weekly db в S3"
fi

# Ежемесячный (1-го числа): дамп БД + холодный полный снапшот moodledata
if [[ "$DAY_OF_MONTH" == "01" ]]; then
    MONTH=$(date +%Y-%m)
    log "Ежемесячный бэкап БД ($MONTH)..."
    s3 cp "$DB_FILE" "s3://${S3_BUCKET}/monthly/db-${MONTH}.sql.gz" || fail "Ошибка загрузки monthly db в S3"

    log "Ежемесячный холодный снапшот moodledata ($MONTH)..."
    MOODLE_SNAPSHOT="$BACKUP_DIR/moodle-${MONTH}.tar.gz"
    tar -czf "$MOODLE_SNAPSHOT" "${TAR_EXCLUDES[@]}" /moodledata \
        || fail "Ошибка архивирования moodledata"
    log "moodledata snapshot: $(du -sh "$MOODLE_SNAPSHOT" | cut -f1)"
    s3 cp "$MOODLE_SNAPSHOT" "s3://${S3_BUCKET}/monthly/moodle-${MONTH}.tar.gz" || fail "Ошибка загрузки monthly moodle в S3"
fi

# ── 5. Ротация старых бэкапов БД ──────────────────────────────────────────────
# moodledata в ротации не нуждается: mirror живёт постоянно (старые версии — через
# S3 versioning + lifecycle), а monthly-снапшоты ротируются вместе с db ниже.
# Ротация некритична — ошибки не прерывают бэкап
log "Ротация daily (оставляем 7)..."
s3 ls "s3://${S3_BUCKET}/daily/" \
    | awk '{print $4}' \
    | { grep '^db-' || true; } \
    | sort \
    | head -n -7 \
    | while read -r key; do
        s3 rm "s3://${S3_BUCKET}/daily/${key}" || true
    done || log "Ротация daily: пропущена (ошибка S3)"

log "Ротация weekly (оставляем 4)..."
s3 ls "s3://${S3_BUCKET}/weekly/" \
    | awk '{print $4}' \
    | { grep '^db-' || true; } \
    | sort \
    | head -n -4 \
    | while read -r key; do
        s3 rm "s3://${S3_BUCKET}/weekly/${key}" || true
    done || log "Ротация weekly: пропущена (ошибка S3)"

log "Ротация monthly (оставляем 12)..."
s3 ls "s3://${S3_BUCKET}/monthly/" \
    | awk '{print $4}' \
    | { grep '^db-' || true; } \
    | sort \
    | head -n -12 \
    | while read -r key; do
        s3 rm "s3://${S3_BUCKET}/monthly/${key}" || true
        moodle_key="${key/db-/moodle-}"
        s3 rm "s3://${S3_BUCKET}/monthly/${moodle_key%.sql.gz}.tar.gz" 2>/dev/null || true
    done || log "Ротация monthly: пропущена (ошибка S3)"

# ── 6. Финал ─────────────────────────────────────────────────────────────────
log "Бэкап завершён."
notify "✅ *GeoCore Backup OK*\n$(date '+%d.%m.%Y %H:%M')\nDB: ${DB_SIZE} | moodledata: synced"
