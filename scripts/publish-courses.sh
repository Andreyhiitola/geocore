#!/usr/bin/env bash
# GeoCore Academy — pipeline публикации курсов
#
# Паттерн:
#   Электронные курсы/ → (approval) → rsync → VPS /opt/geocore/courses/
#                      → nginx /content/COURSE/1/start.html
#                      → S3 ZIP-архив (geocore-backups/courses/archives/)
#                      → Moodle курс + URL-активность
#                      → site.json обновлён
#
# Использование:
#   ./scripts/publish-courses.sh <папка>           # показывает diff, требует подтверждения
#   ./scripts/publish-courses.sh <папка> --dry-run # только показать план
#   ./scripts/publish-courses.sh <папка> --yes     # деплой без интерактивного подтверждения
#
# SSH_VPS=geocore (alias из ~/.ssh/config, по умолчанию)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH_VPS="${SSH_VPS:-geocore}"
VPS_ENV_PATH="${VPS_ENV_PATH:-/opt/geocore/.env}"
VPS_COURSES_DIR="/opt/geocore/courses"      # nginx alias → /content/
VPS_WORK_DIR="/tmp/geocore-publish"
COURSES_BASE_URL="https://courses.geocore-academy.ru/content"
MOODLE_URL="${MOODLE_URL:-https://courses.geocore-academy.ru}"
MOODLE_CATEGORY="${MOODLE_CATEGORY_ID:-1}"

META_FILE="$SCRIPT_DIR/courses-meta.json"
STATE_FILE="$SCRIPT_DIR/courses-state.json"
SITE_JSON="$REPO_ROOT/frontend/js/data/site.json"

DRY_RUN=0
AUTO_YES=0

# ─── Аргументы ───────────────────────────────────────────────────────────────
SOURCE_DIR="${1:-}"
[[ -z "$SOURCE_DIR" ]] && { echo "Укажите папку с курсами: $0 <dir>"; exit 1; }
[[ ! -d "$SOURCE_DIR" ]] && { echo "Папка не найдена: $SOURCE_DIR"; exit 1; }
for arg in "${@:2}"; do
    [[ "$arg" == "--dry-run" ]] && DRY_RUN=1
    [[ "$arg" == "--yes" ]]     && AUTO_YES=1
done

# ─── Утилиты ─────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
info() { echo "    $*"; }
dry()  { [[ $DRY_RUN -eq 1 ]] && echo "  [DRY] $*"; }

moodle() {
    local func="$1"; shift
    curl -sf "${MOODLE_URL}/webservice/rest/server.php" \
        -d "wstoken=${MOODLE_TOKEN}" \
        -d "wsfunction=${func}" \
        -d "moodlewsrestformat=json" "$@"
}

meta() {
    python3 -c "
import json
try:
    d = json.load(open('$META_FILE'))
    print(d.get('''$1''', {}).get('$2', '$3'))
except: print('$3')
" 2>/dev/null || echo "$3"
}

state_get() {
    [[ ! -f "$STATE_FILE" ]] && echo "" && return
    python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('''$1''',''))" 2>/dev/null || echo ""
}

state_set() {
    python3 - "$STATE_FILE" "$1" "$2" <<'PY'
import json, sys
f, name, mid = sys.argv[1], sys.argv[2], int(sys.argv[3])
try: d = json.load(open(f))
except: d = {}
d[name] = mid
json.dump(d, open(f,'w'), ensure_ascii=False, indent=2)
PY
}

# ─── Инициализация ───────────────────────────────────────────────────────────
[[ ! -f "$META_FILE" ]]  && { echo "Нет $META_FILE"; exit 1; }
[[ ! -f "$STATE_FILE" ]] && echo '{}' > "$STATE_FILE"

ssh -q -o BatchMode=yes -o ConnectTimeout=5 "$SSH_VPS" true 2>/dev/null \
    || { echo "VPS недоступен: $SSH_VPS"; exit 1; }

[[ -z "${MOODLE_TOKEN:-}" ]] && \
    MOODLE_TOKEN=$(ssh -q "$SSH_VPS" "grep '^MOODLE_TOKEN' '$VPS_ENV_PATH' | cut -d= -f2" 2>/dev/null)
[[ -z "$MOODLE_TOKEN" ]] && { echo "MOODLE_TOKEN не найден на VPS"; exit 1; }

# ─── Сканируем папки курсов ───────────────────────────────────────────────────
mapfile -t COURSES < <(
    find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 -type d \
    ! -name '.*' ! -name 'PNG_LOGO' | sort
)
[[ ${#COURSES[@]} -eq 0 ]] && { log "Курсы не найдены в $SOURCE_DIR"; exit 0; }

# ─── APPROVAL: показываем diff и требуем подтверждения ───────────────────────
log "Курсы для публикации (${#COURSES[@]}):"
for course_dir in "${COURSES[@]}"; do
    cname="$(basename "$course_dir")"
    local_files=$(find "$course_dir" -type f ! -name "*.tmp" ! -name "*.log" \
        ! -name "desktop.ini" 2>/dev/null | wc -l)
    existing_id=$(state_get "$cname")
    if [[ -n "$existing_id" && "$existing_id" != "0" ]]; then
        status="ОБНОВЛЕНИЕ (Moodle ID: $existing_id)"
    else
        status="НОВЫЙ курс"
    fi
    echo "  • $cname — $local_files файлов — $status"
done
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY RUN — план показан, изменения не применяются."
    exit 0
fi

if [[ $AUTO_YES -eq 0 ]]; then
    read -r -p "Запустить деплой? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { log "Отменено."; exit 0; }
fi

# ─── Подготовка VPS ──────────────────────────────────────────────────────────
ssh -q "$SSH_VPS" "mkdir -p '$VPS_COURSES_DIR' '$VPS_WORK_DIR'"
SITE_JSON_PATCH="/tmp/geocore-site-patch-$$.json"
echo '{}' > "$SITE_JSON_PATCH"

# ─── Основной цикл ───────────────────────────────────────────────────────────
for course_dir in "${COURSES[@]}"; do
    course_name="$(basename "$course_dir")"
    log ""
    log "══ $course_name ══"

    course_url="${COURSES_BASE_URL}/${course_name}/1/start.html"

    # ── 1. rsync → VPS /opt/geocore/courses/ ────────────────────────────────
    log "  [1/4] rsync → VPS"
    rsync -aq --delete \
        --exclude="*.tmp" --exclude="*.log" \
        --exclude="desktop.ini" --exclude=".DS_Store" \
        "$course_dir/" "${SSH_VPS}:${VPS_COURSES_DIR}/${course_name}/"
    file_count=$(ssh -q "$SSH_VPS" "find '${VPS_COURSES_DIR}/${course_name}' -type f | wc -l")
    info "Файлов на VPS: $file_count"

    # ── 2. ZIP-архив → S3 (через geocore_backup контейнер) ──────────────────
    log "  [2/4] ZIP-архив → S3"
    # Используем фиксированное имя без пробелов внутри контейнера
    safe_name="${course_name// /_}"
    ssh -q "$SSH_VPS" \
        "cd '$VPS_COURSES_DIR' && \
         zip -q -r '/tmp/course_archive.zip' '${course_name}' && \
         docker cp /tmp/course_archive.zip geocore_backup:/tmp/course_archive.zip && \
         docker exec geocore_backup aws --endpoint-url https://s3.ru-3.storage.selcloud.ru \
           s3 cp /tmp/course_archive.zip 's3://geocore-backups/courses/archives/${safe_name}.zip' \
           --no-progress && \
         docker exec geocore_backup rm -f /tmp/course_archive.zip && \
         rm -f /tmp/course_archive.zip" 2>&1 | grep -v "^$" || true
    info "Архив: s3://geocore-backups/courses/archives/${safe_name}.zip"

    # ── 3+4. Moodle: курс + URL-активность (через PHP CLI в контейнере) ──────
    log "  [3/4] Moodle курс + URL-активность"
    existing_id=$(state_get "$course_name")
    if [[ -n "$existing_id" && "$existing_id" != "0" ]]; then
        info "Уже существует: course_id=$existing_id"
        moodle_id="$existing_id"
    else
        scp -q "$SCRIPT_DIR/moodle-create-course.php" "${SSH_VPS}:/tmp/moodle-create-course.php"
        result=$(ssh -q "$SSH_VPS" \
            "docker cp /tmp/moodle-create-course.php geocore_moodle:/tmp/ && \
             docker exec geocore_moodle php /tmp/moodle-create-course.php \
               '${course_name}' '${course_url}' '${MOODLE_CATEGORY}'" 2>/dev/null \
            || echo '{"success":false,"error":"exec failed"}')
        if echo "$result" | grep -q '"success":true'; then
            moodle_id=$(echo "$result" | python3 -c \
                "import json,sys; print(json.load(sys.stdin)['course_id'])" 2>/dev/null || echo 0)
            state_set "$course_name" "$moodle_id"
            info "Создан: course_id=$moodle_id + URL-активность добавлена"
        else
            info "WARN: $result"
            moodle_id=0
        fi
    fi
    log "  [4/4] → $course_url"

    # ── Patch site.json ───────────────────────────────────────────────────────
    if [[ "$moodle_id" -gt 0 ]]; then
        icon=$(meta "$course_name" "icon" "📚")
        tag=$(meta "$course_name" "tag" "Курс")
        duration=$(meta "$course_name" "duration" "~4 часа")
        audience=$(meta "$course_name" "audience" "Геологи")
        tagline=$(meta "$course_name" "tagline" "$course_name")
        desc=$(meta "$course_name" "desc" "")
        python3 - "$SITE_JSON_PATCH" "$moodle_id" "$course_name" \
            "$icon" "$tag" "$duration" "$audience" "$tagline" "$desc" <<'PY'
import json, sys
f, mid, name, icon, tag, dur, aud, tl, desc = sys.argv[1:10]
try: d = json.load(open(f))
except: d = {}
d[str(mid)] = {
    "icon": icon, "tag": tag,
    "meta": [{"icon":"🕐","text":dur},{"icon":"🎯","text":"HTML-курс"}],
    "modal": {
        "tagline": tl,
        "description": desc or f"Практический курс: {name}",
        "highlights": [], "audience": aud, "duration": dur,
        "format": "HTML-курс · открывается в браузере"
    }
}
json.dump(d, open(f,'w'), ensure_ascii=False, indent=2)
PY
    fi
done

# ─── Деплой nginx конфига ─────────────────────────────────────────────────────
log ""
log "══ nginx ══"
scp -q "$REPO_ROOT/nginx/geocore.conf" "${SSH_VPS}:/tmp/geocore.conf"
ssh -q "$SSH_VPS" "
    sudo cp /tmp/geocore.conf /etc/nginx/sites-enabled/geocore &&
    sudo nginx -t 2>&1 &&
    sudo systemctl reload nginx &&
    echo 'nginx OK'
" 2>&1

# ─── Обновляем site.json ─────────────────────────────────────────────────────
log ""
log "══ site.json ══"
python3 - "$SITE_JSON" "$SITE_JSON_PATCH" <<'PY'
import json, sys
with open(sys.argv[1]) as f: site = json.load(f)
with open(sys.argv[2]) as f: patch = json.load(f)
if not patch:
    print("  Нет новых данных"); sys.exit(0)
meta = site.setdefault("moodleMeta", {})
added = []
for mid, data in patch.items():
    if mid not in meta: added.append(mid)
    meta[mid] = data
with open(sys.argv[1], 'w') as f:
    json.dump(site, f, ensure_ascii=False, indent=2)
if added:
    print(f"  Добавлено в moodleMeta: ID {', '.join(added)}")
    print(f"  Чтобы курс стал ОТКРЫТ → добавьте ID в moodleCourseOrder")
PY

# ─── Итог ────────────────────────────────────────────────────────────────────
log ""
log "══ ИТОГ ══"
python3 - "$STATE_FILE" "$SITE_JSON" "$COURSES_BASE_URL" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
try: order = json.load(open(sys.argv[2])).get("moodleCourseOrder", [])
except: order = []
base_url = sys.argv[3]
print()
for name, mid in state.items():
    status = "✅ ОТКРЫТ" if mid in order else "⏳ soon"
    url = f"{base_url}/{name}/1/start.html"
    print(f"  [{mid}] {name}")
    print(f"       {url}")
    print(f"       Статус: {status}")
    print()
if state:
    print("  Чтобы сделать ОТКРЫТ:")
    print('  Добавьте ID в frontend/js/data/site.json → "moodleCourseOrder"')
    print("  Затем: git add -A && git commit -m 'feat: публикация курсов' && git push")
PY

rm -f "$SITE_JSON_PATCH"
ssh -q "$SSH_VPS" "rm -rf $VPS_WORK_DIR" 2>/dev/null || true
log "Деплой завершён."
