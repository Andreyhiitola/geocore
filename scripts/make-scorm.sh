#!/usr/bin/env bash
# GeoCore-Academy — упаковка курсов CourseLab в SCORM и загрузка в Moodle
#
# Паттерн:
#   <source_dir>/<Курс>/1/start.html  →  imsmanifest.xml + zip  →  Moodle SCORM-активность
#
# Использование:
#   ./scripts/make-scorm.sh <source_dir>           # упаковка + загрузка в Moodle
#   ./scripts/make-scorm.sh <source_dir> --dry-run # показать план без изменений
#
# Пример:
#   ./scripts/make-scorm.sh "/home/andysag/Google_disk/GEOCORE_Academy/Эл_курсы"
#
# Источник правды — папка Эл_курсы в Google Drive (локальный кеш ~/Google_disk/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SOURCE_DIR="${1:-}"
DRY_RUN=0

[[ -z "$SOURCE_DIR" ]] && { echo "Укажи source_dir: $0 <source_dir> [--dry-run]"; exit 1; }
[[ ! -d "$SOURCE_DIR" ]] && { echo "Папка не найдена: $SOURCE_DIR"; exit 1; }

for arg in "${@:2}"; do
    [[ "$arg" == "--dry-run" ]] && DRY_RUN=1
done

SSH_VPS="${SSH_VPS:-geocore}"
STATE_FILE="$SCRIPT_DIR/courses-state.json"
# Temp на основном диске — крупные курсы (2GB+) не влезают в tmpfs
WORK_DIR="${SCORM_WORK_DIR:-/home/andysag/.cache/geocore-scorm}"
mkdir -p "$WORK_DIR"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
info() { echo "    $*"; }

state_get() {
    [[ ! -f "$STATE_FILE" ]] && echo "" && return
    python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('''$1''',''))" 2>/dev/null || echo ""
}

# ─── Проверки ────────────────────────────────────────────────────────────────
command -v zip   >/dev/null || { echo "Не найден: zip";  exit 1; }
command -v rsync >/dev/null || { echo "Не найден: rsync"; exit 1; }

if [[ $DRY_RUN -eq 0 ]]; then
    ssh -q -o BatchMode=yes -o ConnectTimeout=5 "$SSH_VPS" true 2>/dev/null \
        || { echo "VPS недоступен: $SSH_VPS"; exit 1; }
fi

# ─── Список курсов ───────────────────────────────────────────────────────────
mapfile -t COURSES < <(
    find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 -type d \
    ! -name '.*' ! -name 'PNG_LOGO' | sort
)
[[ ${#COURSES[@]} -eq 0 ]] && { log "Курсы не найдены в $SOURCE_DIR"; exit 0; }

log "Курсы для публикации (${#COURSES[@]}):"
for c in "${COURSES[@]}"; do
    cname="$(basename "$c")"
    cid=$(state_get "$cname")
    [[ -n "$cid" && "$cid" != "0" ]] && status="Moodle #$cid" || status="нет в Moodle"
    echo "  • $cname — $status"
done
echo ""

[[ $DRY_RUN -eq 1 ]] && { log "DRY RUN — изменения не применяются."; exit 0; }

# ─── Основной цикл ───────────────────────────────────────────────────────────
for course_dir in "${COURSES[@]}"; do
    course_name="$(basename "$course_dir")"
    log "══ $course_name ══"

    course_id=$(state_get "$course_name")
    if [[ -z "$course_id" || "$course_id" == "0" ]]; then
        info "SKIP: нет в courses-state.json"
        echo ""
        continue
    fi

    # Точка входа — самый неглубокий start.html
    entry=$(find "$course_dir" -name "start.html" \
            ! -path "*/thumbnails/*" ! -path "*/images/*" \
            2>/dev/null \
        | sed "s|${course_dir}/||" | sort | head -1)

    if [[ -z "$entry" ]]; then
        info "SKIP: start.html не найден"
        echo ""
        continue
    fi
    info "Entry: $entry | Moodle course #$course_id"

    # Временная директория на основном диске
    tmp=$(mktemp -d -p "$WORK_DIR")
    trap "rm -rf '$tmp'" EXIT

    # Копируем курс (включая .wcl — исходник CourseLab)
    rsync -a \
        --exclude="*.hta"       \
        --exclude="*.bak"       \
        --exclude="*.log"       \
        --exclude=".DS_Store"   \
        --exclude="desktop.ini" \
        "$course_dir/" "$tmp/pkg/"

    # Генерируем SCORM 1.2 imsmanifest.xml
    safe_id=$(echo "$course_name" | python3 -c \
        "import sys,re; print(re.sub(r'[^a-zA-Z0-9_-]','_',sys.stdin.read().strip()))")
    cat > "$tmp/pkg/imsmanifest.xml" << MANIFEST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${safe_id}" version="1"
    xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
    xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                        http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org_1">
    <organization identifier="org_1">
      <title>${course_name}</title>
      <item identifier="item_1" identifierref="res_1">
        <title>${course_name}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_1" type="webcontent" adlcp:scormtype="sco" href="${entry}">
      <file href="${entry}"/>
    </resource>
  </resources>
</manifest>
MANIFEST_EOF

    # Пакуем в ZIP
    safe_name="${course_name// /_}"
    zip_file="$tmp/${safe_name}.zip"
    (cd "$tmp/pkg" && zip -q -r "$zip_file" .)
    zip_size=$(du -sh "$zip_file" | cut -f1)
    info "ZIP: ${safe_name}.zip ($zip_size)"

    # Копируем ZIP на VPS (rsync — надёжнее scp для больших файлов)
    info "Загружаем в Moodle #${course_id}..."
    rsync -a --no-compress \
        -e "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=20" \
        "$zip_file" "${SSH_VPS}:/tmp/${safe_name}.zip"
    rsync -a -e "ssh -o ServerAliveInterval=30" \
        "$SCRIPT_DIR/moodle-upload-scorm.php" "${SSH_VPS}:/tmp/moodle-upload-scorm.php"

    result=$(ssh -q "$SSH_VPS" \
        "docker cp '/tmp/${safe_name}.zip' geocore_moodle:/tmp/course.zip && \
         docker cp /tmp/moodle-upload-scorm.php geocore_moodle:/tmp/moodle-upload-scorm.php && \
         docker exec geocore_moodle php /tmp/moodle-upload-scorm.php \
           '/tmp/course.zip' '${course_id}' '${course_name}'" 2>/dev/null \
        || echo '{"success":false,"error":"exec failed"}')

    if echo "$result" | python3 -c \
        "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
        cmid=$(echo "$result" | python3 -c \
            "import json,sys; print(json.load(sys.stdin).get('cmid','?'))")
        info "✅ SCORM активность создана (cmid=${cmid})"
    else
        info "WARN: $result"
    fi

    ssh -q "$SSH_VPS" "rm -f '/tmp/${safe_name}.zip' /tmp/moodle-upload-scorm.php" 2>/dev/null || true

    rm -rf "$tmp"
    trap - EXIT
    echo ""
done

log "══ ГОТОВО ══"
