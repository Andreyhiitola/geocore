#!/bin/bash
# GeoCore-Academy — генерация статического отчёта посещений сайта (GoAccess)
# Запуск: через cron на VPS, каждые 15-30 минут
# Не хранит историю дольше суток — nginx logrotate ежедневно перекладывает
# access-лог, отчёт просто отражает "сегодня с полуночи".

set -euo pipefail

LOG_FILE="/var/log/nginx/geocore-site-access.log"
OUT_DIR="/var/www/geocore-stats"
OUT_FILE="${OUT_DIR}/index.html"

mkdir -p "$OUT_DIR"

if [[ ! -s "$LOG_FILE" ]]; then
    exit 0
fi

goaccess "$LOG_FILE" \
    --log-format=COMBINED \
    --anonymize-ip \
    --ignore-crawlers \
    -o "$OUT_FILE" \
    -a -q
