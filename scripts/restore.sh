#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  GeoCore Academy — Restore from Selectel S3                                ║
# ║                                                                            ║
# ║  Использование:                                                            ║
# ║    ./restore.sh                     # интерактивный выбор точки            ║
# ║    ./restore.sh 2024-04-20          # ежедневный бэкап за дату             ║
# ║    ./restore.sh weekly/2024-W15     # еженедельный бэкап                   ║
# ║    ./restore.sh monthly/2024-04     # ежемесячный бэкап                    ║
# ║    ./restore.sh --dry-run           # проверка без реального восстановления ║
# ║                                                                            ║
# ║  Локальное тестирование (без изменений продакшена):                        ║
# ║    COMPOSE_FILE=docker-compose.test.yml \                                  ║
# ║    MOODLE_SERVICE=moodle-test \                                            ║
# ║    MARIADB_SERVICE=mariadb-test \                                          ║
# ║    MOODLE_DB_NAME=moodle_test \                                            ║
# ║    MOODLE_DB_USER=moodle \                                                 ║
# ║    MOODLE_DB_PASSWORD=testpass \                                           ║
# ║    MOODLE_URL=http://localhost:8082 \                                      ║
# ║    ./restore.sh --dry-run                                                  ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── 1. Настройки ───────────────────────────────────────────────────────────────
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.ru-3.storage.selcloud.ru}"
S3_BUCKET="${S3_BUCKET:?Не задан S3_BUCKET}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/geocore}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
MOODLE_SERVICE="${MOODLE_SERVICE:-moodle}"
MARIADB_SERVICE="${MARIADB_SERVICE:-mariadb}"
DB_NAME="${MOODLE_DB_NAME:-moodle}"
DB_USER="${MOODLE_DB_USER:-moodle}"
DB_PASS="${MOODLE_DB_PASSWORD:?Не задан MOODLE_DB_PASSWORD}"
MOODLE_URL="${MOODLE_URL:-${MOODLE_WWWROOT:-http://localhost:8080}}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
DRY_RUN="${DRY_RUN:-false}"

# ── 2. Цвета и утилиты ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $*"; notify "❌ *GeoCore Restore FAILED*\n$(date '+%d.%m.%Y %H:%M')\n$*"; exit 1; }

notify() {
    [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]] && return
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="${TELEGRAM_CHAT_ID}" -d parse_mode="Markdown" \
        -d text="$1" > /dev/null || true
}

s3() { aws --endpoint-url "$S3_ENDPOINT" s3 "$@"; }
dc() { docker compose -f "${COMPOSE_DIR}/${COMPOSE_FILE}" "$@"; }

TMPDIR_WORK=$(mktemp -d)
cleanup() { rm -rf "${TMPDIR_WORK}"; }
trap cleanup EXIT

# ── 3. Проверка зависимостей ───────────────────────────────────────────────────
for cmd in docker aws curl gzip tar; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Утилита '$cmd' не найдена. Установите её вручную и повторите запуск."
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 не установлен. См. https://docs.docker.com/compose/install/"
[[ -f "${COMPOSE_DIR}/${COMPOSE_FILE}" ]] || fail "Compose-файл не найден: ${COMPOSE_DIR}/${COMPOSE_FILE}"

# ── 4. Pre-check ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}=== GeoCore Restore ===${NC}"
printf "  Compose:  %s/%s\n" "$COMPOSE_DIR" "$COMPOSE_FILE"
printf "  S3:       %s/%s\n" "$S3_ENDPOINT" "$S3_BUCKET"
printf "  DB:       %s@%s/%s\n" "$DB_USER" "mariadb" "$DB_NAME"
printf "  DRY_RUN:  %s\n" "$DRY_RUN"
echo -e "${CYAN}========================${NC}\n"

# ── 5. Разбор аргументов ───────────────────────────────────────────────────────
RESTORE_POINT_ARG=""
AUTO="${AUTO:-false}"
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --auto)    AUTO=true ;;   # для cron на standby VPS: берёт последний бэкап без вопросов
        --*)       warn "Неизвестный флаг: $arg" ;;
        *)         RESTORE_POINT_ARG="$arg" ;;
    esac
done

DB_KEY=""
MOODLE_KEY=""
RESTORE_POINT=""

# Превращает строку "2024-04-20" / "weekly/2024-W15" / "monthly/2024-04"
# в конкретные S3-ключи DB_KEY и MOODLE_KEY
resolve_keys() {
    local point="$1"
    if [[ "$point" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        DB_KEY="daily/db-${point}.sql.gz"
        MOODLE_KEY="daily/moodle-${point}.tar.gz"
        RESTORE_POINT="daily/${point}"
    elif [[ "$point" =~ ^weekly/(.+)$ ]]; then
        local id="${BASH_REMATCH[1]}"
        DB_KEY="weekly/db-${id}.sql.gz"
        MOODLE_KEY="weekly/moodle-${id}.tar.gz"
        RESTORE_POINT="weekly/${id}"
    elif [[ "$point" =~ ^monthly/(.+)$ ]]; then
        local id="${BASH_REMATCH[1]}"
        DB_KEY="monthly/db-${id}.sql.gz"
        MOODLE_KEY="monthly/moodle-${id}.tar.gz"
        RESTORE_POINT="monthly/${id}"
    else
        fail "Неизвестный формат: '${point}'. Примеры: 2024-04-20 | weekly/2024-W15 | monthly/2024-04"
    fi
}

# Показывает список бэкапов из S3 и предлагает выбрать
select_backup() {
    echo -e "${CYAN}Доступные точки восстановления:${NC}"
    local idx=0
    declare -a BACKUP_LIST=()

    for prefix in daily weekly monthly; do
        while IFS= read -r key; do
            [[ -z "$key" ]] && continue
            local id="${key#db-}"; id="${id%.sql.gz}"
            BACKUP_LIST+=("${prefix}/${id}")
            idx=$((idx + 1))
            printf "  %3d) %-10s %s\n" "$idx" "[$prefix]" "$id"
        done < <(s3 ls "s3://${S3_BUCKET}/${prefix}/" 2>/dev/null \
            | awk '{print $4}' | grep '^db-' | sort -r)
    done

    [[ ${#BACKUP_LIST[@]} -eq 0 ]] && fail "В S3 нет бэкапов (bucket: ${S3_BUCKET})"

    echo ""
    read -r -p "Номер точки (1-${#BACKUP_LIST[@]}), Enter = последний: " choice
    [[ -z "$choice" ]] && choice=1

    if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#BACKUP_LIST[@]} )); then
        fail "Неверный выбор: ${choice}"
    fi

    resolve_keys "${BACKUP_LIST[$((choice - 1))]}"
}

if [[ -n "$RESTORE_POINT_ARG" ]]; then
    resolve_keys "$RESTORE_POINT_ARG"
elif [[ "$AUTO" == "true" ]]; then
    # В автоматическом режиме всегда берём последний daily бэкап
    LATEST=$(s3 ls "s3://${S3_BUCKET}/daily/" 2>/dev/null \
        | awk '{print $4}' | grep '^db-' | sort -r | head -1)
    [[ -z "$LATEST" ]] && fail "В S3 нет daily бэкапов (bucket: ${S3_BUCKET})"
    resolve_keys "${LATEST#db-}" 2>/dev/null || \
        resolve_keys "$(echo "$LATEST" | sed 's/^db-//;s/\.sql\.gz$//')"
else
    select_backup
fi

log "Точка:  ${RESTORE_POINT}"
log "DB:     s3://${S3_BUCKET}/${DB_KEY}"
log "Data:   s3://${S3_BUCKET}/${MOODLE_KEY}"

# ── 6. Подтверждение или dry-run ───────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    log "[DRY-RUN] Проверяем доступность файлов в S3..."
    s3 ls "s3://${S3_BUCKET}/${DB_KEY}"     && log "  ✓ ${DB_KEY}" || warn "  ✗ ${DB_KEY} — НЕ НАЙДЕН"
    s3 ls "s3://${S3_BUCKET}/${MOODLE_KEY}" && log "  ✓ ${MOODLE_KEY}" || warn "  ✗ ${MOODLE_KEY} — НЕ НАЙДЕН"
    log "[DRY-RUN] Реальное восстановление пропущено. Выход."
    exit 0
fi

echo ""
echo -e "${RED}⚠️  ВНИМАНИЕ: текущие данные будут ПЕРЕЗАПИСАНЫ!${NC}"
printf "   БД:         %s\n" "$DB_NAME"
printf "   moodledata: volume ($(docker volume ls --format '{{.Name}}' | grep 'moodle' | head -1 || echo '?'))\n"
printf "   Точка:      %s\n" "$RESTORE_POINT"
echo ""
if [[ "$AUTO" == "true" ]]; then
    log "[AUTO] Подтверждение пропущено (--auto режим)."
else
    read -r -p "Для подтверждения введите 'yes': " confirm
    [[ "$confirm" == "yes" ]] || { log "Отменено."; exit 0; }
fi

notify "⏳ *GeoCore Restore запущен*\n$(date '+%d.%m.%Y %H:%M')\nТочка: ${RESTORE_POINT}"

# ── 7. Скачивание и проверка целостности ───────────────────────────────────────
log "Скачивание ${DB_KEY}..."
s3 cp "s3://${S3_BUCKET}/${DB_KEY}" "${TMPDIR_WORK}/db.sql.gz" \
    || fail "Ошибка загрузки БД из S3"
gzip -t "${TMPDIR_WORK}/db.sql.gz" \
    || fail "Дамп БД повреждён (gzip -t)"

log "Скачивание ${MOODLE_KEY}..."
s3 cp "s3://${S3_BUCKET}/${MOODLE_KEY}" "${TMPDIR_WORK}/moodle.tar.gz" \
    || fail "Ошибка загрузки moodledata из S3"
tar -tzf "${TMPDIR_WORK}/moodle.tar.gz" >/dev/null \
    || fail "Архив moodledata повреждён"

DB_SIZE=$(du -sh "${TMPDIR_WORK}/db.sql.gz" | cut -f1)
MOODLE_SIZE=$(du -sh "${TMPDIR_WORK}/moodle.tar.gz" | cut -f1)
log "Скачано: БД — ${DB_SIZE}, moodledata — ${MOODLE_SIZE}"

# ── 8. Проверка свободного места ───────────────────────────────────────────────
# gzip -l col2 = uncompressed size; SQL-дампы сжимаются в 5–10x, поэтому оценка консервативная
UNCOMPRESSED_DB=$(gzip -l "${TMPDIR_WORK}/db.sql.gz" | awk 'NR==2 {print $2}')
MOODLE_ESTIMATED=$(( $(stat -c%s "${TMPDIR_WORK}/moodle.tar.gz") * 3 ))
NEEDED=$(( UNCOMPRESSED_DB + MOODLE_ESTIMATED ))
AVAILABLE=$(df -k "${COMPOSE_DIR}" | awk 'NR==2 {print $4 * 1024}')

if (( NEEDED > AVAILABLE )); then
    fail "Недостаточно места: нужно ~$(( NEEDED/1024/1024 )) МБ, доступно $(( AVAILABLE/1024/1024 )) МБ"
fi
log "Место на диске: ок (доступно $(( AVAILABLE/1024/1024 )) МБ)"

# ── 9. Остановка Moodle ────────────────────────────────────────────────────────
log "Остановка ${MOODLE_SERVICE}..."
dc stop "${MOODLE_SERVICE}" 2>/dev/null || warn "${MOODLE_SERVICE} не запущен, пропускаю"

# ── 10. Запуск MariaDB и ожидание готовности ───────────────────────────────────
MARIADB_ID=$(dc ps -q "${MARIADB_SERVICE}" 2>/dev/null | head -1 || true)
if [[ -z "$MARIADB_ID" ]] || ! docker inspect "$MARIADB_ID" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    log "Запуск ${MARIADB_SERVICE}..."
    dc up -d "${MARIADB_SERVICE}"
    sleep 3
    MARIADB_ID=$(dc ps -q "${MARIADB_SERVICE}" 2>/dev/null | head -1)
fi

[[ -z "$MARIADB_ID" ]] && fail "Не удалось получить ID контейнера ${MARIADB_SERVICE}"

log "Ожидание готовности MariaDB (до 60 сек)..."
for i in $(seq 1 30); do
    if docker exec "$MARIADB_ID" mysqladmin ping --silent 2>/dev/null; then
        log "MariaDB готова (${i}*2 сек)"
        break
    fi
    sleep 2
    [[ $i -eq 30 ]] && fail "MariaDB не ответила за 60 секунд"
done

# ── 11. Восстановление БД (пароль через tmpfile, не через ENV) ─────────────────
log "Передача учётных данных в контейнер MariaDB..."
printf '[client]\nuser=%s\npassword=%s\n' "${DB_USER}" "${DB_PASS}" \
    | docker exec -i "$MARIADB_ID" bash -c 'cat > /tmp/.my.cnf && chmod 600 /tmp/.my.cnf'

log "Пересоздание БД ${DB_NAME}..."
docker exec "$MARIADB_ID" mysql --defaults-file=/tmp/.my.cnf \
    -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;
        CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" \
    || fail "Не удалось пересоздать БД"

log "Импорт дампа БД..."
gunzip -c "${TMPDIR_WORK}/db.sql.gz" \
    | docker exec -i "$MARIADB_ID" mysql --defaults-file=/tmp/.my.cnf "${DB_NAME}" 2>/dev/null \
    || fail "Ошибка импорта дампа"

docker exec "$MARIADB_ID" rm -f /tmp/.my.cnf
log "БД восстановлена."

# ── 12. Восстановление moodledata (через named Docker volume) ──────────────────
# Находим volume по имени контейнера (надёжнее, чем угадывать имя проекта)
MOODLE_CONTAINER=$(dc ps -q "${MOODLE_SERVICE}" 2>/dev/null | head -1 || true)
if [[ -n "$MOODLE_CONTAINER" ]]; then
    MOODLE_VOL=$(docker inspect "$MOODLE_CONTAINER" \
        --format '{{range .Mounts}}{{if eq .Destination "/var/moodledata"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)
fi

# Запасной вариант — ищем по паттерну
if [[ -z "${MOODLE_VOL:-}" ]]; then
    MOODLE_VOL=$(docker volume ls --format '{{.Name}}' | grep 'moodle.*data' | grep -v 'mariadb\|maria\|db_' | head -1 || true)
fi

[[ -z "${MOODLE_VOL:-}" ]] && fail "Не найден Docker volume для moodledata. Проверьте: docker volume ls"
log "Volume moodledata: ${MOODLE_VOL}"

log "Очистка и восстановление moodledata..."
# Архив содержит пути вида "moodledata/..."; --strip-components=1 убирает префикс
docker run --rm \
    -v "${MOODLE_VOL}:/moodledata" \
    -v "${TMPDIR_WORK}:/restore:ro" \
    alpine \
    sh -c '
        find /moodledata -mindepth 1 -delete 2>/dev/null || true
        tar -xzf /restore/moodle.tar.gz --strip-components=1 -C /moodledata
        chown -R 33:33 /moodledata
    ' || fail "Ошибка восстановления moodledata"
log "moodledata восстановлена."

# ── 13. Запуск всех сервисов ───────────────────────────────────────────────────
log "Запуск сервисов..."
dc up -d || fail "Не удалось запустить контейнеры"

# Ждём HTTP 200/303 на странице входа — признак что Apache и Moodle инициализированы
log "Ожидание готовности Moodle (до 120 сек)..."
ELAPSED=0
MOODLE_ID=""
while [[ $ELAPSED -lt 120 ]]; do
    MOODLE_ID=$(dc ps -q "${MOODLE_SERVICE}" 2>/dev/null | head -1 || true)
    if [[ -n "$MOODLE_ID" ]]; then
        HTTP_CODE=$(docker exec "$MOODLE_ID" \
            curl -sf -o /dev/null -w '%{http_code}' http://localhost/login/index.php 2>/dev/null || echo "000")
        if [[ "$HTTP_CODE" =~ ^(200|303)$ ]]; then
            log "Moodle готов — HTTP ${HTTP_CODE} (${ELAPSED} сек)"
            break
        fi
    fi
    sleep 3; ELAPSED=$((ELAPSED + 3))
done

if [[ $ELAPSED -ge 120 ]]; then
    warn "Moodle не ответил за 120 сек (последний код: ${HTTP_CODE:-000}) — возможно, выполняет миграцию БД. Продолжаю..."
fi

# ── 14. Очистка кэша Moodle ────────────────────────────────────────────────────
MOODLE_ID=$(dc ps -q "${MOODLE_SERVICE}" 2>/dev/null | head -1 || true)
if [[ -n "$MOODLE_ID" ]]; then
    log "Очистка кэша Moodle..."
    docker exec "$MOODLE_ID" php /var/www/html/admin/cli/purge_caches.php 2>/dev/null \
        && log "Кэш очищен." \
        || warn "Очистка кэша не удалась (Moodle ещё грузится — не критично)"
fi

# ── 15. Финал ──────────────────────────────────────────────────────────────────
echo ""
log "===== Восстановление успешно завершено ====="
log "Точка:  ${RESTORE_POINT}"
log "Сайт:   ${MOODLE_URL}"
notify "✅ *GeoCore Restore OK*\n$(date '+%d.%m.%Y %H:%M')\nТочка: ${RESTORE_POINT}\nСайт: ${MOODLE_URL}"
