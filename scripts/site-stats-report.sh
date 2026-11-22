#!/bin/bash
# GeoCore-Academy — отчёты посещаемости сайта.
# Запуск: cron на VPS каждые 15 минут.
#
#   index.html  — сводка «только люди» по дням (site-stats-humans.py), история накапливается
#   people.html — полный отчёт GoAccess по людям за всю накопленную историю
#   raw.html    — как раньше: весь трафик сегодня, включая ботов
#
# История людей лежит в /var/lib/geocore-stats (IP замаскированы до /24).

set -euo pipefail

LOG_FILE="/var/log/nginx/geocore-site-access.log"
OUT_DIR="/var/www/geocore-stats"
STATE="/var/lib/geocore-stats"
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$OUT_DIR" "$STATE"

python3 "$HERE/site-stats-humans.py"

if compgen -G "$STATE/human/*.log" > /dev/null; then
    goaccess "$STATE"/human/*.log \
        --log-format=COMBINED \
        --anonymize-ip \
        --html-report-title="GeoCore-Academy — люди" \
        -o "$OUT_DIR/people.html" \
        -a -q
fi

if [[ -s "$LOG_FILE" ]]; then
    goaccess "$LOG_FILE" \
        --log-format=COMBINED \
        --anonymize-ip \
        --ignore-crawlers \
        -o "$OUT_DIR/raw.html" \
        -a -q
fi
