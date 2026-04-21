#!/usr/bin/env bash
# Проверка деплоя биллинга — запускать на VPS из /opt/geocore
# Использование: bash scripts/check_billing.sh

set -euo pipefail

DB_PASS="${MOODLE_DB_PASSWORD:-$(grep MOODLE_DB_PASSWORD /opt/geocore/.env 2>/dev/null | cut -d= -f2)}"

ok()   { echo "  ✅  $1"; }
fail() { echo "  ❌  $1"; EXIT_CODE=1; }
hdr()  { echo; echo "── $1 ──"; }

EXIT_CODE=0

# ── 1. API health ──────────────────────────────────────────────────────────────
hdr "API health"
if curl -sf https://api.geocore-academy.ru/api/health > /dev/null; then
    ok "api.geocore-academy.ru/api/health → 200"
else
    fail "API не отвечает"
fi

# ── 2. Шрифт DejaVu (кириллица в PDF) ─────────────────────────────────────────
hdr "DejaVu шрифт"
if docker exec geocore_api ls /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf &>/dev/null; then
    ok "DejaVuSans.ttf найден в контейнере"
else
    fail "DejaVuSans.ttf НЕ найден — кириллица в PDF сломается"
fi

# ── 3. Новые колонки в таблице requests ────────────────────────────────────────
hdr "Колонки в таблице requests"
REQUIRED_COLS=(total_price invoice_status invoice_link payment_status access_expiry_date moodle_accounts_generated)
COLUMNS=$(docker exec geocore_db mysql -umoodle -p"${DB_PASS}" moodle -sNe 'SHOW COLUMNS FROM requests;' 2>/dev/null | awk '{print $1}')

for col in "${REQUIRED_COLS[@]}"; do
    if echo "$COLUMNS" | grep -q "^${col}$"; then
        ok "колонка $col"
    else
        fail "колонка $col ОТСУТСТВУЕТ"
    fi
done

# ── 4. Таблица moodle_accounts ─────────────────────────────────────────────────
hdr "Таблица moodle_accounts"
TABLES=$(docker exec geocore_db mysql -umoodle -p"${DB_PASS}" moodle -sNe 'SHOW TABLES;' 2>/dev/null)
if echo "$TABLES" | grep -q "^moodle_accounts$"; then
    ok "таблица moodle_accounts существует"
else
    fail "таблица moodle_accounts ОТСУТСТВУЕТ"
fi

# ── 5. Логи backend — нет ошибок запуска ───────────────────────────────────────
hdr "Логи geocore_api (последние 30 строк)"
LOGS=$(docker logs geocore_api --tail 30 2>&1)
echo "$LOGS" | sed 's/^/    /'

if echo "$LOGS" | grep -qi "error\|traceback\|exception"; then
    fail "В логах есть ошибки — проверить выше"
else
    ok "Ошибок в логах не обнаружено"
fi

# ── Итог ───────────────────────────────────────────────────────────────────────
echo
if [[ $EXIT_CODE -eq 0 ]]; then
    echo "✅  Все проверки пройдены — биллинг задеплоен корректно"
else
    echo "❌  Есть проблемы — смотреть выше"
    exit 1
fi
