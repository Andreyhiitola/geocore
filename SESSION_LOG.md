# GeoCore Academy — Журнал сессий

---

## 2026-04-25 (сессия 17)

### Что сделали

**Исправлены три бага в системе бэкапов — причина ❌ в Telegram:**

**`backup/scripts/backup.sh` — падение на ротации:**
- Корневая причина: `set -euo pipefail` + `grep '^db-'` возвращал exit 1, когда в `weekly/` или `monthly/` ещё нет файлов — скрипт падал после вывода "Ротация monthly...", не доходя до "Бэкап завершён.", бот показывал ❌
- Фикс: обёрнут `grep` в `{ grep '^db-' || true; }` во всех трёх блоках ротации (daily/weekly/monthly)
- Дополнительно: добавлен `|| true` в `notify()` — если curl сбоит при отправке Telegram, скрипт не роняет себя

**`bot/bot.py` — кнопка "📋 История бэкапов":**
- `backup_history_text()` вызывала `restic snapshots --json` — restic удалён в сессии 16, поэтому "Не удалось получить данные"
- Фикс: заменено на `aws s3 ls "s3://$S3_BUCKET/daily/"` внутри контейнера через `sh -c`

**`bot/bot.py` — прогресс ручного бэкапа (кнопка "💾 Бэкап"):**
- `run_backup()` искала строки `"snapshot saved"` и `"processed files"` (restic-формат) — шаги arch и s3 никогда не помечались ✅
- Фикс: заменено на `'moodledata:'` и правильные переходы между шагами по реальному выводу backup.sh
- Обновлены лейблы: "Бэкап restic" → "Архив moodledata"; финальное сообщение "✅ restic" → "✅ moodledata"

### Состояние после сессии
- Бэкап корректно завершается и показывает ✅ даже когда weekly/monthly пустые
- История бэкапов читает реальные файлы из S3 (daily/), показывает за последние 7 дней
- Прогресс-индикатор при ручном бэкапе корректно отображает все 4 шага

---

## 2026-04-24 (сессия 16)

### Что сделали

**Скрипт восстановления из S3 — `scripts/restore.sh`:**
- Создан полноценный `scripts/restore.sh` для восстановления из Selectel S3 при инцидентах
- Интерактивный выбор точки восстановления (daily/weekly/monthly) или аргументом
- Флаги: `--dry-run` (проверка без восстановления), `--auto` (для cron на standby без вопросов)
- Восстановление moodledata через named Docker volume (`docker run --rm alpine`)
- Volume находится через `docker inspect` (надёжнее угадывания имени проекта)
- Безопасная передача пароля БД через tmpfile внутри контейнера, не через ENV/ps
- Проверка готовности Moodle по HTTP (curl login/index.php), не по процессу PHP
- Применены замечания code review: убрана автоустановка зависимостей, добавлен комментарий gzip -l

**Убран restic — переход на plain S3 бэкап:**
- `scripts/backup.sh` — заменён на aws s3 (GFS daily/weekly/monthly)
- `backup/Dockerfile` — `restic` → `aws-cli`
- `docker-compose.yml` — убраны `RESTIC_REPOSITORY` и `RESTIC_PASSWORD`
- `.env.example` — убран `RESTIC_PASSWORD`
- Теперь `backup.sh` и `restore.sh` работают с одним форматом файлов — рассинхрон устранён

**Документация:**
- `wiki/BACKUP.md` — инструкция по бэкапам (упрощена после удаления restic)
- `wiki/MIGRATION.md` — три уровня инфраструктуры: локальная VM за NAT, переезд VPS, standby active-passive, балансировка (будущее)
- `.env.example` — исправлен S3_ENDPOINT на `s3.ru-3.storage.selcloud.ru`, добавлен HTTPS_PROXY

**Инфраструктура:**
- Обсудили настройку Proxmox VM как локального VPS (свой IP, те же порты что прод)
- Паттерн: `scp .env с прод + sed MOODLE_WWWROOT` = рабочее окружение за 30 сек

### Состояние после сессии
- `scripts/restore.sh` и `scripts/backup.sh` — готовы, протестированы синтаксически
- Всё запушено, CI/CD пересобирает backup-контейнер
- На VPS вручную: удалить `RESTIC_PASSWORD` из `.env`, затем `docker compose up -d --build backup`
- Proxmox VM для тестирования — запуск запланирован
- Пересоздание БД (DROP + CREATE) перед импортом дампа
- Ожидание готовности MariaDB и Moodle без `sleep` (polling с timeout)
- Telegram-уведомления о старте, успехе и ошибках
- Проверка свободного места перед распаковкой

**Для тренировки на локальном окружении:**
```bash
COMPOSE_FILE=docker-compose.test.yml \
MOODLE_SERVICE=moodle-test \
MARIADB_SERVICE=mariadb-test \
MOODLE_DB_NAME=moodle_test \
MOODLE_DB_USER=moodle \
MOODLE_DB_PASSWORD=testpass \
MOODLE_URL=http://localhost:8082 \
./scripts/restore.sh --dry-run
```

### Состояние после сессии
- `scripts/restore.sh` готов, синтаксис проверен
- Требует: `aws` CLI с настроенными ключами Selectel, `S3_BUCKET`, `MOODLE_DB_PASSWORD` в окружении

---

## 2026-04-21 (сессия 15, продолжение)

### Что сделали (дополнение)

**Moodle 5.1.4 — обновление (2 критические уязвимости безопасности):**
- Локальный тест на порту 8082 (8081 занят pelikan-bot) — сборка прошла успешно
- `deploy.yml`: `MOODLE_VERSION` изменён с `5.1.3` на `5.1.4`, добавлен деплой `moodle` в `up -d`, добавлена автосинхронизация `MOODLE_VERSION` в `.env` на VPS через `sed`
- CI/CD собрал образ `andreysagurov/geocore-moodle:5.1.4`, задеплоил на VPS
- На VPS вручную: обновлён `.env` (MOODLE_VERSION=5.1.4), выполнен `docker compose pull moodle && docker compose up -d moodle`
- `upgrade.php` выполнился: «Обновление с 5.1.3 (Build: 20260216) до 5.1.4 (Build: 20260420) успешно завершено»

**Исправлена структурная проблема CI/CD:**
- `MOODLE_VERSION` жил в двух местах (`.env` на VPS и `deploy.yml`) и расходился при обновлении
- Фикс: `sed -i "s/MOODLE_VERSION=.*/MOODLE_VERSION=${{ env.MOODLE_VERSION }}/" /opt/geocore/.env` в deploy-шаге

**Уроки:**
- Перед обновлением Moodle — обязательно локальный тест (протокол нарушался в этой сессии)
- `down -v` — только для тестового окружения, никогда на проде
- При обновлении `MOODLE_VERSION` в `deploy.yml` нужно обновить и `.env` на VPS — теперь автоматически

### Состояние после сессии
- Moodle 5.1.4 работает на проде, уязвимости закрыты
- CI/CD: moodle теперь деплоится автоматически, MOODLE_VERSION синхронизируется
- Этапы 1–3 расширения админки: задеплоено

---

## 2026-04-21 (сессия 15)

### Что сделали

**Расширение админки — счета, оплаты, аккаунты Moodle (Этапы 1–3 дорожной карты):**

**Backend `backend/main.py`:**
- Новые колонки в `requests`: `total_price`, `invoice_status`, `invoice_link`, `payment_status`, `access_expiry_date`, `moodle_accounts_generated` (через `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
- Новая таблица `moodle_accounts` (request_id, username, password, moodle_user_id)
- Статика: `app.mount("/static", StaticFiles(...))` → `/static/invoices/` и `/static/qr/`
- Регистрация DejaVu-шрифтов для reportlab (поддержка кириллицы при наличии `fonts-dejavu-core`)
- Новые эндпоинты:
  - `GET /api/admin/requests/{id}` — одна заявка + аккаунты
  - `PATCH /api/admin/requests/{id}/headcount` и `/total_price`
  - `POST /api/admin/requests/{id}/generate-invoice` — генерация PDF + QR (заглушка)
  - `POST /api/admin/requests/{id}/mark-paid` — подтвердить оплату + создать аккаунты Moodle + отправить email
- Хелперы: `_make_invoice_pdf`, `_make_qr`, `_create_moodle_accounts`, `_send_accounts_email`, `_get_moodle_course_id`, `_generate_secure_password`

**`backend/requirements.txt`:** добавлены `reportlab`, `qrcode[pil]`, `Pillow`

**`backend/Dockerfile`:** добавлен `fonts-dejavu-core` (кириллица в PDF)

**Frontend `frontend/admin.html`:**
- Таблица заявок: новые колонки «Сумма», «Счёт», «Оплата» (бейджи), убрана колонка «Сотрудник»
- Кнопка ✎ на каждой строке открывает модальное окно
- Модальное окно: все детали заявки + редактирование headcount/total_price + формирование счёта + подтверждение оплаты + список аккаунтов Moodle
- CSS: модальное окно, бейджи статусов (badge-dim/blue/green/gold), кнопки btn-invoice/btn-paid

### Состояние после сессии
- Этапы 1–3 реализованы, готово к деплою
- Этап 4 (тестирование): заполнить заявку → открыть модалку → сформировать счёт → отметить оплаченным
- Для реального Moodle: нужен `MOODLE_TOKEN` с разрешениями `core_user_create_users` + `enrol_manual_enrol_users`
- Счета сохраняются в `/app/static/` внутри контейнера (теряются при перезапуске — это норма для заглушки)

---

## 2026-04-20 (сессия 14)

### Что сделали

**Админка — авторизация по логину + токену:**
- Добавлено поле «Логин» в форму входа `frontend/admin.html`
- Бэкенд `backend/main.py` — `require_admin` теперь проверяет заголовок `X-Admin-User` (если `ADMIN_USERNAME` задан в `.env`)
- Новая переменная `ADMIN_USERNAME` добавлена в `.env.example` и в конфиг бэкенда
- Обратная совместимость: если `ADMIN_USERNAME` не задан — проверка логина пропускается

**Архив заявок:**
- Колонка `archived` (TINYINT) добавлена в таблицу `requests` через `ALTER TABLE IF NOT EXISTS`
- Эндпоинты: `GET /archive`, `PATCH /{id}/archive`, `PATCH /{id}/unarchive`, `DELETE /{id}`
- Фронтенд: кнопка «архив» у отменённых заявок, вкладка «Архив» с восстановлением и удалением

**Тема день/ночь — унификация:**
- Все страницы переведены на единый ключ `geocoreLight` в localStorage
- `lab.html` — добавлено сохранение темы (раньше кнопка была без логики)
- `courses.html`, `sandbox.html` — исправлен старый ключ `theme`
- Все 4 статьи: добавлена кнопка 🌙, CSS светлой темы, JS с `geocoreLight`

**Прочие фиксы:**
- `deploy.yml` — добавлен перезапуск `frontend` и `backend` после `docker compose pull`
- Кнопки «Написать нам» и «Обсудить условия» — убраны `mailto:`, теперь ведут на `#consult`
- Создан `ROADMAP.md` — AI-чат на Claude API, ссылка на статьи в хэдере, саморегистрация Moodle

### Состояние после сессии
- Админка: двухпольная авторизация + архив заявок, задеплоено
- Тема: синхронна на всех страницах включая статьи
- ROADMAP.md создан в корне репозитория

---

## 2026-04-19 (сессия 13)

### Что сделали

**Telegram-бот — улучшения:**
- Добавлена постоянная `ReplyKeyboardMarkup` с кнопками: 📊 Статус, 💾 Бэкап, 📋 История бэкапов
- Прогресс бэкапа в реальном времени через `editMessageText` — сообщение обновляется пошагово
- Бэкап запускается в отдельном потоке — бот не блокируется на время выполнения
- Подавление CPU и HTTP алертов во время бэкапа (S3-загрузка грузит канал и CPU)
- Кнопка «История бэкапов» — читает снимки через `restic snapshots --json`

**Переход на restic (инкрементальные бэкапы):**
- Заменён `tar + aws-cli` на `restic` — бэкап 3.4 GiB занимает ~8 сек вместо 15 мин
- Первый бэкап полный, далее только дельта (добавляет ~331 KiB/день)
- Ротация через `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune`
- Добавлена переменная `RESTIC_PASSWORD` в `.env` и `docker-compose.yml`
- Volume `backup_logs` — лог пережиавет пересборку контейнера

**Починены баги:**
- `backup.sh`: `grep` в ротации возвращал exit 1 при пустом monthly → `set -euo pipefail` убивал скрипт без нотификации. Фикс: `|| true`
- `backup.sh`: `curl` в `notify()` мог завершиться с ошибкой → `set -e` ронял скрипт. Фикс: `|| true`
- `bot.py`: прогресс бэкапа использовал `stderr=PIPE` → дедлок при большом выводе restic. Фикс: `stderr=STDOUT`
- `bot.py`: Markdown-бэктики в значениях `done` dict ломали рендер. Фикс: переключение на HTML
- `deploy.yml`: `bot` и `backup` не пересобирались при деплое (только `pull`). Фикс: `--build bot backup`
- `trap ERR` добавлен в `backup.sh` — любой неожиданный выход шлёт уведомление с номером строки

### Состояние после сессии
- Бэкапы: restic работает, 8 сек на 3.4 GiB, ✅ нотификация в Telegram
- Бот: ReplyKeyboard постоянная, прогресс через HTML editMessageText, история бэкапов через restic

---

## 2026-04-18 (сессия 12)

### Что сделали

**Диагностика алертов + фикс инфраструктуры:**
- Утром пришла серия алертов о недоступности сайтов — оказались реальными транзиентными сбоями (сеть VPS), сейчас всё работает
- **Watchtower** перестал работать: Docker 29.x требует минимум API 1.40, watchtower использовал 1.25 → бесконечный restart. Фикс: добавлен `DOCKER_API_VERSION: "1.40"` в docker-compose.yml
- **backup.sh**: обнаружены два бага — `du -sh` вызывался после `rm -rf` (размеры в нотификации были пустыми), скрипт отсутствовал в репо. Создан `backup/scripts/backup.sh`, исправлена логика, добавлена нотификация о старте бэкапа (`⏳ GeoCore Backup запущен`)
- Задеплоено на VPS: watchtower healthy, backup пересобран с новым скриптом

### Состояние после сессии
- Все контейнеры Up и healthy
- Watchtower работает корректно, следующий запуск через ~24ч
- backup.sh теперь шлёт 3 нотификации: ⏳ старт → ✅ успех (с размерами) или ❌ ошибка

---

## 2026-04-16 (сессия 11)

### Что сделали

**Подготовка к импорту тестов в Moodle:**
- Проверены исходные XML-файлы в `~/Downloads/WhatSie/`:
  - `test_semester1.xml` — 25 вопросов, Moodle XML, 4 изображения (base64) — файл валиден
  - `test_datamine.xml` — 30 вопросов, Moodle XML, 2 изображения (base64) — файл валиден
- Исправлена документация: STATUS.md указывал `.gift` для семестра 1, реальный файл — `.xml`

### Отложено (сделать вручную в Moodle)
- Импорт `test_semester1.xml`: Банк вопросов → Импорт → Moodle XML → категория «Семестр 1»
- Импорт `test_datamine.xml`: Банк вопросов → Импорт → Moodle XML → категория «DataMine»
- Проверить изображения после импорта
- Создать тест из импортированных вопросов

---

## 2026-04-15 (сессия 10)

### Что сделали

**Мониторинг VPS + Telegram алерты:**
- `scripts/healthcheck.sh` — проверяет контейнеры (`docker inspect`), HTTP-эндпоинты, диск, RAM; при ошибках шлёт сообщение в Telegram
- `watchdog/Dockerfile` — alpine-контейнер с docker-cli + curl + crond (каждые 5 минут)
- `docker-compose.yml` — добавлен сервис `watchdog` (монтирует docker socket read-only)
- `.env.example` — добавлены `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Принято решение: внешний мониторинг (UptimeRobot) нужен дополнительно — если VPS упадёт, внутренний watchdog тоже умрёт

**Бэкапы (Selectel S3, GFS-ротация):**
- `scripts/backup.sh` — дамп MariaDB (`mysqldump` по сети) + архив moodledata volume; GFS: 7 ежедневных / 4 еженедельных / 12 ежемесячных; алерт в Telegram при ошибке и успехе
- `backup/Dockerfile` — alpine-контейнер с mariadb-client + awscli + crond (каждый день в 02:00)
- `docker-compose.yml` — добавлен сервис `backup` (подключается к mariadb по внутренней сети, не через docker socket)
- `.env.example` — добавлены `S3_ENDPOINT`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`
- Выбран Selectel S3 (`https://s3.selectel.ru`): VPS на той же сети → трафик бэкапов бесплатный
- Оценка хранилища: ~17 GB при GFS за год → берём 20 GB (~36₽/мес)

### Отложено (сделать на VPS)
- Создать Telegram бота (@BotFather → /newbot), получить BOT_TOKEN и CHAT_ID
- Зарегистрироваться на Selectel → Object Storage → bucket `geocore-backups` → получить ACCESS_KEY + SECRET_KEY
- Прописать переменные в `.env` на VPS
- `git pull && docker compose up -d --build watchdog backup`
- Проверить первый бэкап вручную: `docker exec geocore_backup /scripts/backup.sh`
- Замерить реальные размеры volumes: `du -sh /var/lib/docker/volumes/geocore_*`
- Настроить UptimeRobot (бесплатно) — внешний мониторинг трёх доменов → Telegram

---

## 2026-04-14 (сессия 9)

### Что сделали

**CLAUDE.md — улучшение:**
- Добавлен раздел про `backend/processing/` — модули и пайплайн геологической обработки
- Уточнено что `docker-compose.test.yml` для обкатки Moodle перед деплоем
- Добавлена таблица переменных окружения backend
- Зафиксирована архитектура: геологические расчёты в перспективе на локальный сервер, VPS только для лёгких операций
- Усилено правило про Moodle: «рабочую версию нельзя сломать»

**Wiki обновлена:**
- `wiki/backend.md` — добавлены все эндпоинты, переменные, таблица processing-модулей
- `wiki/decisions.md` — зафиксировано решение про локальный сервер для расчётов

**STATUS.md:**
- Добавлены задачи: разделение бэкенда, бэкапы, мониторинг VPS + алертинг

**tools/ — добавлены в репозиторий:**
- Убраны из `.gitignore`, все скрипты закоммичены
- `tools/convert.py` — переписан как tkinter GUI: окно выбора конвертера, «Обзор…» для файлов, кнопка «Конвертировать»
- `tools/README.md` — переписан: быстрый старт, таблица выбора конвертера, требования к файлам

### Отложено
- Установить `python3-tkinter` на машине (`sudo dnf install python3-tkinter`) и протестировать GUI
- Импорт тестов в Moodle (файлы готовы)
- Разделение бэкенда на VPS API и локальный API
- Бэкапы БД и файлов Moodle
- Мониторинг VPS + алертинг

---

## 2026-04-13 (сессия 8)

### Что сделали

**Подготовка тестов для Moodle (финал):**
- Исходники нашлись локально: `~/Downloads/WhatSie/`
- `tools/docx_to_gift.py` — исправлена точность процентов (4→5 знаков), чтобы Moodle принимал веса множественного выбора (16.66667% вместо 16.6667%)
- `tools/qti_to_gift.py` — новый конвертер IMS QTI 1.2 → GIFT (для тестов без картинок)
- `tools/qti_to_moodle_xml.py` — новый конвертер IMS QTI 1.2 → Moodle XML с встроенными base64-картинками

**Файлы для импорта в Moodle:**
- `~/Downloads/WhatSie/test_semester1.gift` — 25 вопросов (1 семестр), импорт → GIFT
- `~/Downloads/WhatSie/test_datamine.xml` — 30 вопросов (Datamine) + 2 картинки встроены, импорт → Moodle XML

### Отложено
- Завершить создание теста в Moodle (добавить все 25 вопросов, настроить баллы)
- Импорт test_datamine.xml (30 вопросов) — файл готов на Google Drive
- Выбор формата для 3D визуализации (CSV скважины vs DXF каркас)
- SCORM редизайн (Leapfrog_geocore_v3.zip) — протестировать в Moodle
- Саморегистрация студентов в Moodle
- Закоммитить tools/README.md (инструкция по конвертации)

---

## 2026-04-12 (сессия 7)

### Что сделали

**LLM Wiki (knowledge base):**
- Создана папка `wiki/` в репозитории по паттерну Karpathy
- Файлы: INDEX.md, infrastructure.md, moodle.md, email.md, frontend.md, backend.md, problems.md, decisions.md, lab.md
- Наполнена из STATUS.md и SESSION_LOG.md (все накопленные знания)
- CLAUDE.md обновлён: wiki читается в начале сессии, обновляется в конце
- Obsidian: открыть папку `wiki/` как vault для граф-вида
- Масштабирование: per-project wiki в git + личная ~/personal-library для общих паттернов

**Подготовка тестов для Moodle:**
- Проанализированы 2 файла: DOCX (25 вопросов) и QTI 1.2 XML (30 вопросов)
- Написан конвертер `tools/docx_to_gift.py`:
  - Определяет правильные ответы по цветовому выделению в Word
  - Поддерживает одиночный и множественный выбор
  - 25 вопросов конвертировано, 0 пропущено
- Написано руководство `tools/TEST_AUTHORING_GUIDE.md` для разработчика тестов
- Файлы сохранены на Google Drive в структуру:
  - 01_Пробный_итоговый_тест_1_семестр / оригинал + moodle_gift
  - 02_Тест_геологическое_моделирование_Datamine / оригинал + moodle_qti

**Лаборатория (планирование):**
- Решение: 3D визуализация (Three.js) — отображение, не построение
- Формат для начала: скважины из CSV или DXF каркас — выбор отложен
- База знаний: гибридный подход (LLM + ручное), файл wiki/lab.md
- Зафиксировано в wiki/lab.md

### Отложено
- Импорт тестов в Moodle (файлы готовы — выполнить вручную)
- Выбор формата для 3D визуализации (CSV скважины vs DXF каркас)
- SCORM редизайн (Leapfrog_geocore_v3.zip) — протестировать в Moodle
- Саморегистрация студентов в Moodle

---

## 2026-04-11 (сессия 6)

### Что сделали
- Email полностью настроен и протестирован:
  - SMTP: Gmail (smtp.gmail.com, App Password) как транспорт
  - `From: GeoCore Academy <9624294@gmail.com>`, `Reply-To: info@geocore-academy.ru`
  - `NOTIFY_EMAIL=info@geocore-academy.ru` — уведомления о заявках приходят в Zoho
  - Авто-ответ клиенту работает
  - Zoho Free не поддерживает внешний SMTP → при переходе на платный Zoho просто меняем переменные в .env
- Проверили мобильную версию сайта — всё работает, доработок не нужно
- SCORM редизайн подготовлен без CourseLab:
  - `scorm-tools/geocore-brand.css` — полная тёмная тема, золотые кнопки, IBM Plex
  - `scorm-tools/repack.sh` — скрипт переупаковки ZIP (заменяет CSS + добавляет логотип через JS)
  - `~/Downloads/Leapfrog_geocore_v3.zip` — готов к тестированию в Moodle

### Отложено
- Протестировать Leapfrog_geocore_v3.zip в локальном Moodle (localhost:8081)
- Когда будет CourseLab — применить редизайн напрямую в .clf
- Саморегистрация студентов в Moodle
- Переход на платный Zoho SMTP (при готовности)

---

## 2026-04-10 (сессия 5)

### Что сделали
- Форма заявки на корпоративное обучение: кнопка "Записаться" → форма внутри существующего модального окна
- `POST /api/requests` в FastAPI — принимает заявку, фоном шлёт email через smtplib (BackgroundTasks)
- CSS формы добавлен в index.html и courses.html в стиле сайта
- Zoho Mail Free — зарегистрирован ящик info@geocore-academy.ru
- DNS в FirstVDS: MX, SPF, DKIM — все настроены и подтверждены
- Gmail настроен на отправку от имени info@geocore-academy.ru через Zoho SMTP
- SMTP_USER/SMTP_PASS/NOTIFY_EMAIL добавлены в docker-compose.yml и .env.example

### Отложено
- Прописать SMTP_USER и SMTP_PASS в .env на VPS и перезапустить бэкенд
- Мобильная адаптация (index.html, courses.html) — приоритет следующей сессии
- Саморегистрация студентов в Moodle
- Большая архитектура: платежи, AI-координатор, ЭДО-заглушка — обсуждение начато

---

## 2026-04-09 (сессия 4)

### Что сделали
- Рефакторинг главной страницы (index.html): убраны 3D-песочница, лаборатория, архив датасетов → перенесены в sandbox.html и lab.html
- sandbox.html создан как отдельная страница с полным 3D-функционалом
- lab.html: добавлен архив 7 демо-датасетов (до инструмента подготовки), исправлена ссылка index.html#sandbox → sandbox.html
- index.html: заменён main.js на минимальный инлайн-скрипт (initSite + chat + theme + reveal)
- siteRenderer.js: добавлены параметры `showPlanned` и `showSoon` для гибкого управления курсами на разных страницах
- Главная показывает: 2 открытых курса (Leapfrog + Паспортизация) + 7 плановых "В разработке", без "Скоро"-курсов из Moodle
- Добавлена stats-strip между курсами и "Для кого": 2 / 6 / 16 / SCORM / JORC
- Добавлена 7-я плановая карточка: Python для геологических расчётов (для симметрии сетки)
- nav в site.json: "Песочница" ссылается на sandbox.html

### Отложено
- Удалить `_мусор/` на Google Drive после проверки
- Саморегистрация студентов в Moodle

---

## 2026-04-09 (сессия 3)

### Что сделали
- Ребрендинг SCORM Паспортизации завершён:
  - GRRRR05 — переписан текст про Полиметалл на общеотраслевую формулировку (Приказ Минприроды)
  - GRRRR14 — убрано «сотрудник АО Полиметалла», заменено на «главный геолог проекта»
  - GRRRR22 — убраны все упоминания Полиметалл УК и регламентов компании, выводы переписаны нейтрально
  - Добавлен логотип GeoCore Academy в навигационную панель (Logotip2.png)
- Ребрендинг SCORM Leapfrog: убран логотип Полиметалла с обложки (Logotip.png → прозрачный)
- Оба пакета обновлены на Google Drive (актуальная/), старые → _архив/
- Курсы в Moodle: Паспортизация id=10, Leapfrog id=11 (пересоздан, старый id=9 удалён)
- site.json обновлён: moodleCourseOrder [9,10] → [11,10]
- SCORM загружены в Moodle, курсы работают на сайте

### Отложено
- Удалить `_мусор/` на Google Drive после проверки
- Саморегистрация студентов в Moodle

---

## 2026-04-09 (сессия 2)

### Что сделали
- Добавлен курс Паспортизации (id=10) в Moodle со SCORM-пакетом
- Исправлен id Leapfrog Viewer: 8 → 9 в moodleCourseOrder
- Обнаружен ребрендинг Полиметала в SCORM Паспортизации (логотип на слайдах)
- Создан чеклист `SCORM_REBRANDING.md` для проверки всех новых SCORM-пакетов (в .gitignore)
- `courses.html` переписан — теперь использует siteRenderer.js (Moodle + site.json), убраны 12 хардкодных карточек
- Блок цен переработан: убраны все цифры, три формата без стоимости
- Футер: убраны эмодзи из контактов, убран WhatsApp
- `start_serverpython_9001.sh` исправлен — запускает сервер из `frontend/`

### Отложено
- Удалить `_мусор/` на Google Drive после проверки
- Саморегистрация студентов в Moodle

---

## 2026-04-09

### Что сделали
- Организовали Google Drive: создали структуру папок по курсам (01_Leapfrog, 02_Паспортизация, Документы, _мусор)
- Реализована трёхуровневая система карточек курсов:
  - **ОТКРЫТ** — SCORM-курсы из Moodle (moodleCourseOrder), кликабельные, первые в сетке
  - **СКОРО** — Moodle-курсы без SCORM, некликабельные
  - **В РАЗРАБОТКЕ** — планируемые из site.json, самые блёклые
- Добавлен `moodleMeta` в site.json для обогащения карточек иконкой и тегом
- Leapfrog Viewer (id=8) — в moodleCourseOrder, отображается как ОТКРЫТ

### Структура Google Drive (SCORM-папка)
```
01_Leapfrog_Viewer_для_руководителей/
   актуальная/  ← Leapfrog..._rebrend_v_2.zip
   _архив/      ← старые версии (до ребрендинга, v1)
02_Паспортизация_геологоразведочных/
   актуальная/  ← Паспортизация..._rebrend.zip
Документы/      ← чеклисты, шаблоны
_мусор/         ← временный отстойник
```

### Отложено
- Удалить `_мусор/` на Google Drive после проверки
- ID курса Паспортизации в Moodle → добавить в `moodleCourseOrder` в site.json
- Саморегистрация студентов в Moodle

---

## 2026-04-08

### Что сделали
- Разобрались с результатами предыдущей зависшей сессии (загрузка SCORM на Google Drive не завершилась)
- Проверили содержимое Drive-папки: Leapfrog загрузился с суффиксом `_v_2`, Паспортизация не загрузилась, остался мусорный `.tmp` файл
- Нашли актуальные версии SCORM-файлов на локальной машине:
  - `Leapfrog Viewer для руководителей_SORM_fixed_rebrend_v_2.zip` (310 MB, от 20:13)
  - `Паспортизация геологоразведочных проектов_fixed_rebrend.zip` (4.7 MB, от 21:01)
- Скопировали оба файла в `/home/andysag/Downloads/Новые переработанные файлыscorm _8_04_26/`

### Отложено
- Удалить с Google Drive: мусорный `.tmp` файл и `Leapfrog_SORM_fixed.zip` (старый без ребрендинга)
- Загрузить файлы из новой папки на Google Drive (предыдущая загрузка зависла)
- Карточки `site.json` — сделать полупрозрачными с меткой «Скоро»
- Саморегистрация студентов в Moodle

---

## 2026-04-07 (сессия 2)

### Что сделали
- Настроили Moodle Web Services: включили REST, создали сервис GeoCore API, выдали права пользователю API Service
- Получили токен `MOODLE_TOKEN` и прописали в `.env` на VPS
- Добавили эндпоинт `GET /api/courses` в FastAPI — тянет курсы из Moodle через `core_course_get_courses`
- Добавили `httpx` в `requirements.txt`
- Пробросили `MOODLE_URL` и `MOODLE_TOKEN` в backend через `docker-compose.yml`
- Обновили `siteRenderer.js` — загружает курсы из API с fallback на `site.json`
- Карточки курсов на главной стали кликабельными ссылками
- Создали 6 курсов в Moodle — они появились на главной странице

### Решённые проблемы
- Опечатка `/webservices/rest/` → `/webservice/rest/` в `backend/main.py`
- CI/CD не обновил контейнер — исправили через `docker exec sed` + `docker restart`

### Отложено
- Убрать дублирование карточек: сейчас показываются 6 из `site.json` + 6 из Moodle — нужно оставить только Moodle
- Саморегистрация студентов в Moodle
- www.geocore-academy.ru

---

## 2026-04-07

### Что сделали
- Подняли Moodle на VPS — courses.geocore-academy.ru работает
- Исправили ERR_TOO_MANY_REDIRECTS (sslproxy в entrypoint.sh)
- Исправили "cookies отключены" (убрали {{#cookiesenabled}} из loginform.mustache)
- Настроили GitHub Actions CI/CD (5 секретов в GitHub)
- Запушили образы на Docker Hub (andreysagurov): geocore-moodle:5.1.3-r1, geocore-backend:latest, geocore-frontend:latest
- Создали пользователя Konstantin (роль Менеджер) в Moodle
- Подняли FastAPI — api.geocore-academy.ru работает
- Подняли Frontend — geocore-academy.ru работает
- Вынесли nav/курсы/футер в site.json + siteRenderer.js
- Курсы на главной теперь ссылаются на courses.geocore-academy.ru

### Решённые проблемы
- sslproxy: Moodle за nginx уходил в бесконечный редирект
- cookiesenabled: форма входа не рендерилась (Mustache видел false)
- docker cp не работает на этом VPS — обходить через tar pipe

### Отложено
- www.geocore-academy.ru (нет DNS записи, не приоритет)
- Саморегистрация студентов в Moodle
- Ветки для фич (работали прямо в main — допустимо для старта)

### Принятые решения
- nginx остаётся на хосте VPS (не в Docker) — проще для SSL
- Теги Docker: {версия}-r{N} для ревизий наших правок
- Docker Hub аккаунт: andreysagurov

---
