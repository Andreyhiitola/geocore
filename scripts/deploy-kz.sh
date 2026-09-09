#!/usr/bin/env bash
# Деплой на KZ-зеркало (geocore-academy.kz) — ВСЕГДА через docker-compose.demo.yml.
# Существует, чтобы исключить инцидент 09.09.2026: `docker compose up -d frontend`
# без -f docker-compose.demo.yml пересоздаёт frontend по RU-дефолту без
# SITE_DOMAIN → сайт тихо отдаёт RU-контент на .kz-домене без единой ошибки в логах.
#
# Запуск на KZ-сервере (geocore@213.109.146.180, /opt/geocore):
#   bash scripts/deploy-kz.sh [frontend|backend|moodle|mariadb|backup|all]
# По умолчанию: all
#
# ВАЖНО: bot, usn_backend, usn_frontend, watchtower на KZ НЕ существуют —
# они определены только в docker-compose.yml (RU). Скрипт откажется их трогать.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE_FILE="docker-compose.demo.yml"
COMPOSE="docker compose -f $COMPOSE_FILE"
SERVICE="${1:-all}"

RU_ONLY_SERVICES=("bot" "usn_backend" "usn_frontend" "watchtower")
for s in "${RU_ONLY_SERVICES[@]}"; do
    if [[ "$SERVICE" == "$s" ]]; then
        echo "❌ '$s' не существует в $COMPOSE_FILE — это RU-only сервис (docker-compose.yml)."
        echo "   На KZ его нет и не должно быть. Ничего не делаю."
        exit 1
    fi
done

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "❌ $COMPOSE_FILE не найден в $(pwd). Похоже, скрипт запущен не из /opt/geocore."
    exit 1
fi

hdr() { echo; echo "── $1 (via $COMPOSE_FILE) ──────────────────────"; }

hdr "Получаем последние образы"
case "$SERVICE" in
    all)      $COMPOSE pull frontend backend moodle mariadb ;;
    backup)   : ;;  # локальная сборка, pull не нужен
    *)        $COMPOSE pull "$SERVICE" ;;
esac

hdr "Пересоздаём контейнеры"
case "$SERVICE" in
    all)
        $COMPOSE up -d --force-recreate frontend backend moodle mariadb
        $COMPOSE up -d --build --force-recreate backup
        ;;
    backup)
        $COMPOSE up -d --build --force-recreate backup
        ;;
    *)
        $COMPOSE up -d --force-recreate "$SERVICE"
        ;;
esac

hdr "Статус"
$COMPOSE ps

if [[ "$SERVICE" == "all" || "$SERVICE" == "frontend" ]]; then
    hdr "Проверка региона (обязательно после frontend)"
    bash "$(dirname "${BASH_SOURCE[0]}")/verify-kz-region.sh" || {
        echo "❌ ПРОВЕРКА РЕГИОНА НЕ ПРОЙДЕНА — см. вывод выше. Не оставляй как есть."
        exit 1
    }
fi

echo
echo "✅ Готово — $(date '+%d.%m.%Y %H:%M')"
