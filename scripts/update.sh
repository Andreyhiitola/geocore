#!/usr/bin/env bash
# Обновить все контейнеры до последних образов с Docker Hub
# Запуск: bash scripts/update.sh [backend|frontend|moodle|bot|all]
# По умолчанию: all

set -euo pipefail

SERVICE="${1:-all}"
COMPOSE="docker compose"

ok()  { echo "  ✅  $1"; }
hdr() { echo; echo "── $1 ──────────────────────────────"; }

hdr "Получаем последние образы"
if [[ "$SERVICE" == "all" ]]; then
    $COMPOSE pull frontend backend moodle
else
    $COMPOSE pull "$SERVICE"
fi

hdr "Перезапускаем контейнеры"
if [[ "$SERVICE" == "all" ]]; then
    $COMPOSE up -d --force-recreate frontend backend moodle
    $COMPOSE up -d --build --force-recreate bot backup
else
    $COMPOSE up -d --force-recreate "$SERVICE"
fi

hdr "Очищаем старые образы"
docker image prune -f

hdr "Статус контейнеров"
$COMPOSE ps

hdr "Логи (последние 20 строк каждого)"
for svc in frontend backend moodle; do
    echo
    echo "--- $svc ---"
    docker logs "geocore_${svc/backend/api}" --tail 20 2>&1 || true
done

echo
ok "Готово — $(date '+%d.%m.%Y %H:%M')"
