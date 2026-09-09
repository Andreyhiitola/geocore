#!/usr/bin/env bash
# Проверяет, что frontend-контейнер на KZ реально отдаёт KZ-регион, а не тихо
# откатился на RU-дефолт (SITE_DOMAIN не был передан при пересборке).
#
# Запуск на KZ-сервере: bash scripts/verify-kz-region.sh
# Код возврата: 0 — всё ок, 1 — обнаружена RU-утечка контента.

set -uo pipefail

FAIL=0

echo "1) Лог региональной подстановки в контейнере geocore_frontend:"
if docker logs geocore_frontend 2>&1 | grep -q "\[region-config\] domain -> geocore-academy.kz"; then
    echo "   ✅ SITE_DOMAIN применён (лог найден)"
else
    echo "   ❌ Строки '[region-config] domain -> geocore-academy.kz' в логах НЕТ."
    echo "      Либо SITE_DOMAIN не передан в env, либо контейнер пересоздан не через docker-compose.demo.yml."
    FAIL=1
fi

echo
echo "2) Живой контент https://geocore-academy.kz — ищем маркеры RU-утечки:"
BODY=$(curl -s --max-time 10 "https://geocore-academy.kz/" || echo "")
if [[ -z "$BODY" ]]; then
    echo "   ❌ Сайт не отвечает (curl timeout/empty)"
    FAIL=1
else
    if echo "$BODY" | grep -q "geocore-academy\.ru"; then
        echo "   ❌ Найдена ссылка на geocore-academy.ru — RU-контент отдаётся на .kz!"
        FAIL=1
    fi
    if echo "$BODY" | grep -q "152-ФЗ"; then
        echo "   ❌ Найдена ссылка на РФ 152-ФЗ вместо РК №94-V — RU-контент отдаётся на .kz!"
        FAIL=1
    fi
    if echo "$BODY" | grep -q "Казахстан, СНГ"; then
        echo "   ✅ Рыночный текст KZ на месте"
    else
        echo "   ⚠️  Не найден текст 'Казахстан, СНГ' — проверь вручную (могла измениться формулировка)"
    fi
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
    echo "✅ Регион KZ подтверждён."
else
    echo "❌ РЕГИОН НЕ KZ. Немедленно: docker compose -f docker-compose.demo.yml up -d --force-recreate frontend"
fi

exit "$FAIL"
