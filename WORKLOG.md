# WORKLOG

### 2026-05-15 (сессия 2)

**Сделано:**
- Принудительная синхронизация всех 6 курсов через `rclone copy gdrive:` → локальный диск
- Задеплоены 2 курса полностью (Геологическое моделирование, Геостатистика) — rsync + S3 ZIP + nginx
- Исправлен URL Нейросетей в Moodle: `GeoChem/1/start.html` (нестандартная структура подпапки)
- VPS перезагрузился после `apt install zip` (новое ядро) — контейнеры поднялись автоматически
- Фикс скрипта: rsync exit 24 (vanished .partial files) больше не прерывает деплой
- Обновлена wiki: moodle.md, decisions.md, infrastructure.md — сокращены, оставлена суть

**Изменённые файлы:**
- `scripts/publish-courses.sh` — фикс rsync exit 24, исключение `*.partial`
- `wiki/moodle.md` — таблица курсов + pipeline (сокращено)
- `wiki/decisions.md` — 2 новых решения: контент на VPS не в S3, Google Drive не GitHub
- `wiki/infrastructure.md` — `/content/` в схеме nginx, предупреждение о Selectel bucket policy

**Решения:**
- Нейросети: структура `ПАПКА/GeoChem/1/start.html` — URL в Moodle пришлось исправлять вручную через PHP CLI

**Открытые вопросы:**
- 4 курса ещё не дозадеплоены (ID 17, 18, 19, 20) — прервано из-за нестабильного SSH
- Команда готова: `bash scripts/publish-courses.sh "/path/Эл_курсы" --yes`

### 2026-05-15

**Сделано:**
- Разработан и отлажен pipeline публикации CourseLab HTML-курсов: `Эл_курсы/` → VPS → S3 (архив) → Moodle → site.json
- Задеплоены 6 курсов в Moodle (ID 12, 16, 17, 18, 19, 20) с URL-активностями, все добавлены в `moodleCourseOrder` → статус ОТКРЫТ
- nginx: добавлен `location /content/` на `courses.geocore-academy.ru` — статика курсов с диска VPS
- S3 `geocore-backups/courses/archives/` — ZIP-архивы всех 6 курсов
- Создан отдельный бакет `geocore-courses` (не используется — write-доступ ограничен Selectel)
- Установлен `zip` на VPS

**Изменённые файлы:**
- `scripts/publish-courses.sh` — основной pipeline (rsync→VPS, S3 архив, Moodle PHP CLI, site.json)
- `scripts/moodle-create-course.php` — создание Moodle курса + URL-активности через docker exec
- `scripts/moodle-add-url.php` — добавление URL-активности в существующий курс
- `scripts/courses-meta.json` — метаданные 6 курсов (иконки, теги, описания)
- `scripts/courses-state.json` — state {name→moodle_id} для idempotency повторных запусков
- `nginx/geocore.conf` — location /content/ для статики курсов
- `frontend/js/data/site.json` — moodleMeta + moodleCourseOrder обновлены

**Решения:**
- Курсы хостятся на диске VPS (`/opt/geocore/courses/`) через nginx, не напрямую из S3 — S3 не позволяет public-read без ломающего bucket policy на Selectel/Ceph
- S3 используется только для ZIP-архивов (backup), не для раздачи контента
- Moodle-интеграция через PHP CLI (`docker exec geocore_moodle php`) — REST API токен не имел прав на `core_course_create_courses`
- Pipeline требует ручного запуска (защита от случайных изменений в источнике)
- `--dry-run` показывает план без изменений; `--yes` пропускает подтверждение

**Открытые вопросы:**
- Google Drive vs private GitHub repo как источник курсов — обсудить (см. ниже)
- Курсы в Google Drive частично не синхронизированы (большинство папок = 2 файла) — нужна полная синхронизация перед следующим деплоем
- Moodle курсы созданы с `visible=0` — нужно вручную включить видимость для студентов в Moodle admin
- `geocore-courses` бакет создан но пустой — удалить или настроить access key через Selectel panel
