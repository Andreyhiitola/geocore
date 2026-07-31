#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  GeoCore-Academy — перенос RU → KZ (geocore-academy.ru → .kz)                 ║
# ║                                                                              ║
# ║  Двухфазный перенос (RU и KZ обычно не имеют прямого SSH между собой):        ║
# ║                                                                              ║
# ║    НА RU-сервере:   ./migrate-to-kz.sh export                                 ║
# ║        → создаёт geocore-migration-YYYY-MM-DD.tar.gz (БД + moodledata +       ║
# ║          usn + bot_data). Скопировать бандл на KZ (scp/rsync).                ║
# ║                                                                              ║
# ║    НА KZ-сервере:   ./migrate-to-kz.sh import geocore-migration-*.tar.gz      ║
# ║        → импортирует данные в поднятый стек и делает rewrite домена .ru→.kz    ║
# ║                                                                              ║
# ║    Отдельно (если нужно повторить только замену домена):                      ║
# ║                     ./migrate-to-kz.sh rewrite                                ║
# ║                                                                              ║
# ║  Опирается на конвенции scripts/backup.sh и scripts/restore.sh                ║
# ║  (volume по Destination контейнера, moodledata uid 33, restore через exec).   ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Настройки (переопределяются через env) ────────────────────────────────────
COMPOSE_DIR="${COMPOSE_DIR:-/opt/geocore}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_CONTAINER="${DB_CONTAINER:-geocore_db}"
MOODLE_CONTAINER="${MOODLE_CONTAINER:-geocore_moodle}"
USN_CONTAINER="${USN_CONTAINER:-geocore_usn_api}"
BOT_DATA_DIR="${BOT_DATA_DIR:-/opt/geocore/bot_data}"
MOODLE_ROOT="${MOODLE_ROOT:-/var/www/moodle}"

OLD_DOMAIN="${OLD_DOMAIN:-geocore-academy.ru}"
NEW_DOMAIN="${NEW_DOMAIN:-geocore-academy.kz}"

# moodledata: папки-кэши, которые пересоздаются — не тащим (как в backup.sh)
MD_EXCLUDES="--exclude=moodledata/cache --exclude=moodledata/localcache --exclude=moodledata/temp --exclude=moodledata/trashdir"

# ── Утилиты ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $*" >&2; exit 1; }
dc()   { docker compose -f "${COMPOSE_DIR}/${COMPOSE_FILE}" "$@"; }

confirm() {
    echo -en "${YELLOW}$1 [y/N]: ${NC}"
    read -r ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || fail "Отменено пользователем."
}

# Читаем DB-креды из .env стека
load_db_env() {
    local envf="${COMPOSE_DIR}/.env"
    [[ -f "$envf" ]] || fail "Не найден ${envf} — нужен для DB-кредов."
    DB_NAME=$(grep -E '^MOODLE_DB_NAME='     "$envf" | tail -1 | cut -d= -f2-)
    DB_USER=$(grep -E '^MOODLE_DB_USER='     "$envf" | tail -1 | cut -d= -f2-)
    DB_PASS=$(grep -E '^MOODLE_DB_PASSWORD=' "$envf" | tail -1 | cut -d= -f2-)
    : "${DB_NAME:?MOODLE_DB_NAME пуст в .env}"
    : "${DB_USER:?MOODLE_DB_USER пуст в .env}"
    : "${DB_PASS:?MOODLE_DB_PASSWORD пуст в .env}"
}

# Volume по Destination в контейнере (как в restore.sh)
vol_for() {
    local container="$1" dest="$2"
    docker inspect "$container" \
        --format "{{range .Mounts}}{{if eq .Destination \"$dest\"}}{{.Name}}{{end}}{{end}}" 2>/dev/null
}

# ══════════════════════════════════════════════════════════════════════════════
#  EXPORT  (на RU-сервере)
# ══════════════════════════════════════════════════════════════════════════════
do_export() {
    load_db_env
    local date bundle work
    date=$(date +%Y-%m-%d)
    bundle="$(pwd)/geocore-migration-${date}.tar.gz"
    work=$(mktemp -d)
    trap 'rm -rf "$work"' EXIT

    log "Экспорт с RU-сервера (${OLD_DOMAIN})"

    # 1. Дамп MariaDB
    log "Дамп MariaDB (${DB_NAME})..."
    docker exec -e MYSQL_PWD="$DB_PASS" "$DB_CONTAINER" \
        mysqldump -u"$DB_USER" --single-transaction --quick "$DB_NAME" \
        | gzip > "$work/db.sql.gz" || fail "Ошибка дампа БД"
    log "  БД: $(du -sh "$work/db.sql.gz" | cut -f1)"

    # 2. moodledata (через volume)
    local mvol; mvol=$(vol_for "$MOODLE_CONTAINER" /var/moodledata)
    [[ -n "$mvol" ]] || fail "Не найден volume moodledata на $MOODLE_CONTAINER"
    log "Архив moodledata (volume $mvol)..."
    docker run --rm -v "$mvol:/moodledata:ro" -v "$work:/out" alpine \
        sh -c "tar czf /out/moodle_data.tar.gz $MD_EXCLUDES -C / moodledata" \
        || fail "Ошибка архивации moodledata"
    log "  moodledata: $(du -sh "$work/moodle_data.tar.gz" | cut -f1)"

    # 3. USN SQLite (если есть)
    local uvol; uvol=$(vol_for "$USN_CONTAINER" /app/data || true)
    if [[ -n "${uvol:-}" ]]; then
        log "Копирование usn.db (volume $uvol)..."
        docker run --rm -v "$uvol:/usn:ro" -v "$work:/out" alpine \
            sh -c 'cp /usn/usn.db /out/usn.db 2>/dev/null || echo "usn.db нет — пропуск"'
    else
        warn "USN volume не найден — пропуск."
    fi

    # 4. bot_data (host bind mount)
    if [[ -d "$BOT_DATA_DIR" ]]; then
        log "Архив bot_data ($BOT_DATA_DIR)..."
        tar czf "$work/bot_data.tar.gz" -C "$(dirname "$BOT_DATA_DIR")" "$(basename "$BOT_DATA_DIR")" || warn "bot_data не заархивирован"
    fi

    # 5. Манифест + упаковка
    cat > "$work/MANIFEST.txt" <<EOF
GeoCore migration bundle
date:        ${date}
source:      ${OLD_DOMAIN}
target:      ${NEW_DOMAIN}
db_name:     ${DB_NAME}
moodle_root: ${MOODLE_ROOT}
EOF
    tar czf "$bundle" -C "$work" .
    log "Готово: ${CYAN}${bundle}${NC} ($(du -sh "$bundle" | cut -f1))"
    echo
    log "Дальше: скопировать бандл на KZ-сервер и там выполнить:"
    echo -e "  ${CYAN}./migrate-to-kz.sh import $(basename "$bundle")${NC}"
}

# ══════════════════════════════════════════════════════════════════════════════
#  IMPORT  (на KZ-сервере)
# ══════════════════════════════════════════════════════════════════════════════
do_import() {
    local bundle="${1:?Укажи путь к geocore-migration-*.tar.gz}"
    [[ -f "$bundle" ]] || fail "Бандл не найден: $bundle"
    load_db_env
    local work; work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
    log "Распаковка бандла..."
    tar xzf "$bundle" -C "$work"
    [[ -f "$work/MANIFEST.txt" ]] && cat "$work/MANIFEST.txt"

    echo
    warn "ИМПОРТ ПЕРЕЗАПИШЕТ БД и moodledata на этом (KZ) сервере данными из бандла."
    confirm "Продолжить импорт на ${NEW_DOMAIN}?"

    # 1. Поднять mariadb, дождаться готовности
    log "Поднимаю mariadb..."
    dc up -d mariadb
    log "Жду готовности MariaDB..."
    for _ in $(seq 1 30); do
        docker exec "$DB_CONTAINER" mysqladmin ping --silent 2>/dev/null && break
        sleep 2
    done
    docker exec "$DB_CONTAINER" mysqladmin ping --silent 2>/dev/null || fail "MariaDB не поднялась"

    # 2. Импорт БД
    log "Импорт БД (${DB_NAME})..."
    gunzip -c "$work/db.sql.gz" \
        | docker exec -i -e MYSQL_PWD="$DB_PASS" "$DB_CONTAINER" mysql -u"$DB_USER" "$DB_NAME" \
        || fail "Ошибка импорта БД"

    # 3. moodledata → volume (moodle остановлен на время)
    log "Останавливаю moodle для восстановления moodledata..."
    dc stop moodle 2>/dev/null || true
    dc up -d --no-start moodle 2>/dev/null || true   # чтобы volume существовал
    local mvol; mvol=$(vol_for "$MOODLE_CONTAINER" /var/moodledata)
    [[ -n "$mvol" ]] || fail "Не найден volume moodledata на $MOODLE_CONTAINER (стек поднят?)"
    log "Восстановление moodledata в volume $mvol..."
    docker run --rm -v "$mvol:/moodledata" -v "$work:/in:ro" alpine sh -c '
        find /moodledata -mindepth 1 -delete 2>/dev/null || true
        tar xzf /in/moodle_data.tar.gz --strip-components=1 -C /moodledata
        chown -R 33:33 /moodledata
    ' || fail "Ошибка восстановления moodledata"

    # 4. USN + bot_data
    if [[ -f "$work/usn.db" ]]; then
        local uvol; uvol=$(vol_for "$USN_CONTAINER" /app/data || true)
        if [[ -n "${uvol:-}" ]]; then
            log "Восстановление usn.db..."
            docker run --rm -v "$uvol:/usn" -v "$work:/in:ro" alpine \
                sh -c 'cp /in/usn.db /usn/usn.db'
        else
            warn "USN volume не найден — usn.db пропущен (подними usn_backend и повтори при нужде)."
        fi
    fi
    if [[ -f "$work/bot_data.tar.gz" ]]; then
        log "Восстановление bot_data → $BOT_DATA_DIR..."
        mkdir -p "$(dirname "$BOT_DATA_DIR")"
        tar xzf "$work/bot_data.tar.gz" -C "$(dirname "$BOT_DATA_DIR")" || warn "bot_data не распакован"
    fi

    # 5. Поднять весь стек
    log "Поднимаю стек..."
    dc up -d

    # 6. Rewrite домена .ru → .kz в БД + сброс кэшей
    do_rewrite

    echo
    log "${GREEN}Импорт завершён.${NC} Проверь: https://courses.${NEW_DOMAIN} (логин, SCORM-курс)."
}

# ══════════════════════════════════════════════════════════════════════════════
#  REWRITE  (замена домена в БД Moodle)
# ══════════════════════════════════════════════════════════════════════════════
do_rewrite() {
    log "Rewrite домена в БД Moodle: ${OLD_DOMAIN} → ${NEW_DOMAIN}"
    # Ждём, пока moodle-контейнер поднимется
    for _ in $(seq 1 30); do
        docker exec "$MOODLE_CONTAINER" test -f "$MOODLE_ROOT/version.php" 2>/dev/null && break
        sleep 2
    done
    # admin/tool/replace — штатный инструмент Moodle для search-replace по БД.
    # wwwroot уже задан из env (MOODLE_WWWROOT=.kz), здесь чиним контент/ссылки.
    docker exec "$MOODLE_CONTAINER" su -s /bin/bash www-data -c \
        "php $MOODLE_ROOT/admin/tool/replace/cli/replace.php \
         --search='$OLD_DOMAIN' --replace='$NEW_DOMAIN' --non-interactive" \
        || warn "replace.php вернул ошибку — проверь вручную (возможно, инструмент требует иных флагов в этой версии Moodle)."
    log "Сброс кэшей Moodle..."
    docker exec "$MOODLE_CONTAINER" su -s /bin/bash www-data -c \
        "php $MOODLE_ROOT/admin/cli/purge_caches.php" || warn "purge_caches вернул ошибку"
    log "Rewrite завершён."
}

# ── Точка входа ───────────────────────────────────────────────────────────────
case "${1:-}" in
    export)  do_export ;;
    import)  shift; do_import "${1:-}" ;;
    rewrite) do_rewrite ;;
    *)
        cat <<EOF
GeoCore перенос RU → KZ

  На RU:  $0 export
  На KZ:  $0 import geocore-migration-YYYY-MM-DD.tar.gz
  Повтор: $0 rewrite        # только замена домена .ru→.kz в БД

Env-переопределения: COMPOSE_DIR, OLD_DOMAIN, NEW_DOMAIN, *_CONTAINER, MOODLE_ROOT.
EOF
        exit 1 ;;
esac
