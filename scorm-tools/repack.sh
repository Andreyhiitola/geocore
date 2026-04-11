#!/usr/bin/env bash
# ================================================================
# GeoCore Academy — переупаковка SCORM с новым брендингом
#
# Использование:
#   ./repack.sh <входной.zip> [выходной.zip]
#
# Пример:
#   ./repack.sh ~/Downloads/Leapfrog_geocore_v2.zip
# ================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT_ZIP="$1"
OUTPUT_ZIP="${2:-}"

if [ -z "$INPUT_ZIP" ]; then
  echo "Использование: $0 <входной.zip> [выходной.zip]"
  exit 1
fi

if [ ! -f "$INPUT_ZIP" ]; then
  echo "Файл не найден: $INPUT_ZIP"
  exit 1
fi

if [ -z "$OUTPUT_ZIP" ]; then
  DIR="$(dirname "$INPUT_ZIP")"
  BASE="$(basename "$INPUT_ZIP" .zip)"
  OUTPUT_ZIP="$DIR/${BASE}_branded.zip"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "📦 Распаковываем: $INPUT_ZIP"
unzip -q "$INPUT_ZIP" -d "$TMP"

# ── 1. Заменяем geocore-brand.css ────────────────────────────
echo "🎨 Заменяем geocore-brand.css"
cp "$SCRIPT_DIR/geocore-brand.css" "$TMP/courseimages/geocore-brand.css"

# ── 2. Инъекция логотипа через Python ────────────────────────
echo "🔷 Добавляем логотип в start.html"

python3 - "$TMP" <<'PYEOF'
import sys, os

LOGO_HTML = """<div id="gc-logo" style="position:absolute;top:16px;right:20px;z-index:9999;display:flex;align-items:center;gap:8px;pointer-events:none;">
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="14,1 26,7.5 26,20.5 14,27 2,20.5 2,7.5" fill="#C9A84C"/>
    <text x="14" y="18" text-anchor="middle" font-family="IBM Plex Sans,sans-serif" font-size="9" font-weight="600" fill="#0A0A0B">GC</text>
  </svg>
  <span style="font-family:'Playfair Display',serif;font-size:13px;font-weight:700;color:#C9A84C;letter-spacing:0.04em;text-transform:uppercase;">GeoCore Academy</span>
</div>"""

INJECT = f"""<script>
(function() {{
  window.addEventListener('load', function() {{
    var container = document.querySelector('.cl-container');
    if (container && !document.getElementById('gc-logo')) {{
      container.style.position = 'relative';
      var div = document.createElement('div');
      div.innerHTML = {repr(LOGO_HTML)};
      container.appendChild(div.firstElementChild);
    }}
  }});
}})();
</script>
</body>"""

root = sys.argv[1]
for dirpath, _, files in os.walk(root):
    for fname in files:
        if fname == 'start.html':
            path = os.path.join(dirpath, fname)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            if 'gc-logo' not in content:
                content = content.replace('</body>', INJECT)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"   ✓ Логотип добавлен: {path}")
            else:
                print(f"   ℹ Логотип уже есть: {path}")
PYEOF

# ── 3. Пересобираем ZIP ───────────────────────────────────────
echo "🗜  Собираем: $OUTPUT_ZIP"
rm -f "$OUTPUT_ZIP"
(cd "$TMP" && zip -q -r "$OUTPUT_ZIP" .)

echo ""
echo "✅ Готово: $OUTPUT_ZIP"
echo ""
echo "Следующий шаг:"
echo "  1. Загрузить в тестовый Moodle (localhost:8081) и проверить"
echo "  2. Если OK → загрузить в продакшн (courses.geocore-academy.ru)"
