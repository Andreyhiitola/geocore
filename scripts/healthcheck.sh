#!/bin/bash
# GeoCore Academy — healthcheck + Telegram alerts
# Запуск: вручную или через cron на VPS
# Переменные: TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID из .env

set -euo pipefail

# ── Загрузка переменных окружения ──────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"

if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source <(grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' "$ENV_FILE")
fi

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# ── Настройки ───────────────────────────────────────────────────────────────
CONTAINERS=("geocore_moodle" "geocore_api" "geocore_db")
ENDPOINTS=(
    "https://courses.geocore-academy.ru"
    "https://api.geocore-academy.ru/health"
    "https://geocore-academy.ru"
)
DISK_THRESHOLD=85   # % заполненности — алерт если выше
RAM_THRESHOLD=90    # % использования — алерт если выше

# ── Утилиты ─────────────────────────────────────────────────────────────────
HOSTNAME_SHORT=$(hostname -s)
ERRORS=()

send_telegram() {
    local message="$1"
    if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
        echo "[WARN] Telegram не настроен (нет TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)"
        return
    fi
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="${TELEGRAM_CHAT_ID}" \
        -d parse_mode="Markdown" \
        -d text="${message}" \
        > /dev/null
}

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── Проверка контейнеров ─────────────────────────────────────────────────────
log "Проверка контейнеров..."
for container in "${CONTAINERS[@]}"; do
    status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "not_found")
    if [[ "$status" != "running" ]]; then
        msg="Контейнер *${container}* не запущен (status: ${status})"
        log "ERROR: $msg"
        ERRORS+=("$msg")
    else
        log "OK: $container"
    fi
done

# ── Проверка HTTP-эндпоинтов ─────────────────────────────────────────────────
log "Проверка эндпоинтов..."
for url in "${ENDPOINTS[@]}"; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" || echo "000")
    if [[ "$http_code" == "000" ]]; then
        msg="Эндпоинт *${url}* недоступен (timeout)"
        log "ERROR: $msg"
        ERRORS+=("$msg")
    elif [[ "$http_code" -ge 500 ]]; then
        msg="Эндпоинт *${url}* вернул HTTP ${http_code}"
        log "ERROR: $msg"
        ERRORS+=("$msg")
    else
        log "OK: $url → HTTP $http_code"
    fi
done

# ── Проверка диска ───────────────────────────────────────────────────────────
log "Проверка диска..."
while IFS= read -r line; do
    usage=$(echo "$line" | awk '{print $5}' | tr -d '%')
    mount=$(echo "$line" | awk '{print $6}')
    if [[ "$usage" -ge "$DISK_THRESHOLD" ]]; then
        msg="Диск *${mount}* заполнен на ${usage}% (порог: ${DISK_THRESHOLD}%)"
        log "ERROR: $msg"
        ERRORS+=("$msg")
    else
        log "OK: диск $mount — ${usage}%"
    fi
done < <(df -h | awk 'NR>1 && $6 != "tmpfs" && $6 != "udev"' | grep -v "loop")

# ── Проверка RAM ─────────────────────────────────────────────────────────────
log "Проверка RAM..."
ram_used=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
if [[ "$ram_used" -ge "$RAM_THRESHOLD" ]]; then
    msg="RAM использована на ${ram_used}% (порог: ${RAM_THRESHOLD}%)"
    log "ERROR: $msg"
    ERRORS+=("$msg")
else
    log "OK: RAM — ${ram_used}%"
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
if [[ ${#ERRORS[@]} -eq 0 ]]; then
    log "Все проверки пройдены."
else
    log "${#ERRORS[@]} проблем(а) обнаружено — отправляю в Telegram..."

    message="🚨 *GeoCore Academy* — проблемы на \`${HOSTNAME_SHORT}\`
$(date '+%d.%m.%Y %H:%M UTC')

$(printf '• %s\n' "${ERRORS[@]}")"

    send_telegram "$message"
fi
