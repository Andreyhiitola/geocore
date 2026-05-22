# WORKLOG

### 2026-05-22 — Функционал курсов: credentials, продление доступа, code review

**Сделано:**
- Верифицирован флоу "оплата → credentials → доступ к курсу": Moodle корректно блокирует незачисленные курсы, самозапись отключена
- Исправлен email — теперь отправляет прямую ссылку на курс (`/course/view.php?id=X`) вместо корня платформы
- Добавлен эндпоинт `POST /api/admin/requests/{id}/extend-access` — продление доступа без захода в Moodle
- Добавлена кнопка "Продлить доступ" в модалку заявки (с предзаполненной датой +30 дней)
- Code review (high effort, 3 угла) → найдено и исправлено 6 багов: `time.mktime` → `calendar.timegm` (UTC), Moodle response не проверялся, `accounts_updated` считал неверно, race condition в JS, UTC-сдвиг при парсинге даты
- UX: кнопка "Продлить →" прямо в аналитике (список истекающих), `confirm()` перед продлением, `Escape` закрывает модалку
- Пароли аккаунтов скрыты по умолчанию (`••••••••••••`), кнопка 👁 для показа

**Изменённые файлы:**
- `backend/main.py` — новый эндпоинт extend-access, фикс email URL, tuple return из `_create_moodle_accounts`, 6 bug fixes
- `frontend/admin.html` — кнопка продления, скрытие паролей, кнопка в аналитике, Escape, confirm

**Решения:**
- `calendar.timegm()` вместо `time.mktime()` для UTC timestamp — `mktime` использует локальное время сервера, Moodle ожидает UTC
- Пароли в модалке скрыты через JS-toggle, а не через `type=password` — чтобы можно было скопировать без лишних кликов
- Прямая ссылка на курс в email решает задачу "клиент видит только свой курс" без изменения настроек Moodle

**Открытые вопросы:**
- Изменения ещё не задеплоены на прод (Watchtower каждые 24ч) — кнопка "Продлить" появится после обновления
- Toast-очередь: при двух сообщениях подряд второе перекрывает первое (частично исправлено объединением, но не системно)

### 2026-05-22 — DR тест, Сценарий 1 (Cold Restore)

**Сделано:**
- Написан `scripts/bootstrap-vps.sh` — одна команда поднимает чистую машину с нуля (Docker, swap, репо, .env, restore из S3)
- Добавлен `RECOVERY.md` — runbook с 4 сценариями, таблицей RTO/RPO, контактами
- Протестирован dry-run restore на локальной VM 192.168.1.122 (Proxmox, Ubuntu 22.04) — S3 доступен, бэкапы найдены
- Исправлены 3 бага в `restore.sh`: формат `daily/YYYY-MM-DD`, проверка диска до скачивания, прокси из .env
- Оптимизирован `backup.sh` — исключены `cache/`, `localcache/`, `temp/`, `trashdir/` из архива moodledata (ожидаемое уменьшение бэкапа в 2-3 раза)
- Добавлены режимы `--local` (dry-run по умолчанию) и `--prod` в bootstrap скрипт

**Изменённые файлы:**
- `scripts/bootstrap-vps.sh` — новый файл
- `scripts/restore.sh` — 3 фикса
- `scripts/backup.sh` — исключения temp/cache из tar
- `RECOVERY.md` — новый файл

**Решения:**
- `source .env` ломается на значениях с пробелами (MOODLE_SITE_NAME=GeoCore Academy) — использовать `while IFS= read + export`
- Thin pool Proxmox 100% при скачивании 16.5 ГБ — тест на большом бэкапе требует диск 40+ ГБ
- `--local` режим = dry-run по умолчанию, реальный restore на локальной машине только с `--full`
- Перенос VPS к Selectel нецелесообразен — экономия на S3 трафике не окупает миграцию

**Открытые вопросы:**
- Полный restore с поднятием Moodle не завершён (thin pool переполнился) — повторить на VPS у провайдера
- Добавить nginx в `--prod` режим bootstrap скрипта
- Standby VPS с `restore.sh --auto` (Фаза 2 DR стратегии)

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
