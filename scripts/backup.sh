#!/bin/bash
# GeoCore Academy — резервное копирование через restic (инкрементальные бэкапы)
# Запускается ежедневно в 02:00 из контейнера geocore_backup

set -euo pipefail

trap 'notify "❌ *GeoCore Backup FAILED*\n$(date +"%d.%m.%Y %H:%M")\nНеожиданный выход (строка $LINENO)"' ERR

# ── Настройки ────────────────────────────────────────────────────────────────
DATE=$(date +%Y-%m-%d)

export RESTIC_REPOSITORY="s3:${S3_ENDPOINT:-https://s3.selectel.ru}/${S3_BUCKET:?Переменная S3_BUCKET не задана}"
export RESTIC_PASSWORD="${RESTIC_PASSWORD:?Переменная RESTIC_PASSWORD не задана}"

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
        -d text="${message}" > /dev/null
}

# ── Инициализация репозитория (только первый запуск) ─────────────────────────
log "Старт бэкапа за $DATE"
if ! restic snapshots &>/dev/null; then
    log "Инициализация restic-репозитория..."
    restic init || fail "Ошибка инициализации репозитория"
fi

# ── 1. Дамп базы данных ──────────────────────────────────────────────────────
log "Дамп MariaDB..."
DB_FILE="/tmp/db-${DATE}.sql.gz"
mysqldump \
    -h "${DB_HOST:-mariadb}" \
    -u "${MOODLE_DB_USER}" \
    -p"${MOODLE_DB_PASSWORD}" \
    --single-transaction \
    --quick \
    "${MOODLE_DB_NAME}" | gzip > "$DB_FILE" \
    || fail "Ошибка дампа БД"
log "БД: $(du -sh "$DB_FILE" | cut -f1)"

# ── 2. Бэкап через restic ────────────────────────────────────────────────────
log "Бэкап через restic..."
restic backup /moodledata "$DB_FILE" \
    --tag "geocore" \
    --tag "$DATE" \
    || fail "Ошибка restic backup"

rm -f "$DB_FILE"

# ── 3. Ротация ───────────────────────────────────────────────────────────────
log "Ротация (forget + prune)..."
restic forget \
    --keep-daily 7 \
    --keep-weekly 4 \
    --keep-monthly 12 \
    --prune \
    || fail "Ошибка ротации"

# ── 4. Финал ─────────────────────────────────────────────────────────────────
SNAPSHOT=$(restic snapshots --latest 1 --json 2>/dev/null \
    | python3 -c "import sys,json; s=json.load(sys.stdin); print(s[0]['short_id'] if s else '?')" \
    2>/dev/null || echo "?")
log "Бэкап завершён. Снимок: $SNAPSHOT"
notify "✅ *GeoCore Backup OK*\n$(date '+%d.%m.%Y %H:%M')\nСнимок: \`${SNAPSHOT}\`"
