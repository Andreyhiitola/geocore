# GeoCore Academy — Бэкапы и восстановление

> Последнее обновление: 2026-06-11

---

## Как работает

Контейнер `geocore_backup` запускает `scripts/backup.sh` **ежедневно в 02:00**.

**Гибридная схема** (с 11.06.2026):

```
MariaDB (mysqldump) ──→ daily/weekly/monthly/db-*.sql.gz   (GFS-ротация)
moodledata          ──→ moodledata-mirror/                 (s3 sync --delete, ежедневно)
moodledata          ──→ monthly/moodle-*.tar.gz            (полный снапшот, только 1-го числа)
usn.db              ──→ daily/usn-*.db
```

**Почему так:** moodledata (~36 ГБ) — в основном статичные SCORM-курсы, которые
почти не меняются. Старая схема гнала полный `tar.gz` каждый день и хранила его
по GFS — до 23 почти идентичных копий по 36 ГБ (~840 ГБ за статичные данные).
`s3 sync` хранит одно актуальное состояние + версии изменившихся файлов (защита
через S3 versioning, см. ниже), а ежемесячный `tar.gz` даёт холодную точку
восстановления "на начало месяца".

**GFS-ротация (только БД и месячный снапшот moodledata):**

| Папка | Хранится | Когда создаётся |
|-------|----------|----------------|
| `daily/` | 7× `db-*.sql.gz` | каждый день |
| `weekly/` | 4× `db-*.sql.gz` | каждое воскресенье |
| `monthly/` | 12× `db-*.sql.gz` + 12× `moodle-*.tar.gz` | 1-го числа |

`moodledata-mirror/` ротации не подлежит — это живое зеркало с versioning
(старые версии файлов истекают по lifecycle через `NONCURRENT_DAYS`, см.
`scripts/setup-bucket.sh`).

---

## Переменные окружения

```env
S3_ENDPOINT=https://s3.ru-3.storage.selcloud.ru
S3_BUCKET=geocore-backups
AWS_ACCESS_KEY_ID=<ключ сервисного пользователя Selectel>
AWS_SECRET_ACCESS_KEY=<секрет>
AWS_DEFAULT_REGION=ru-3

# Опционально
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Если VPS за прокси
# HTTPS_PROXY=http://host:port
```

---

## Настройка Selectel S3

1. Selectel Console → Cloud Storage → Object Storage → Создать bucket `geocore-backups` (зона ru-3)
2. Профиль → Сервисные пользователи → Создать → выдать права на bucket
3. Скопировать Access Key и Secret Key в `.env`
4. Включить versioning + lifecycle (обязательно для гибридной схемы — без этого
   `moodledata-mirror/` либо не защищён от случайного `--delete`, либо растёт
   бесконечно за счёт старых версий):
   ```bash
   S3_BUCKET=geocore-backups S3_ENDPOINT=https://s3.ru-3.storage.selcloud.ru \
     bash scripts/setup-bucket.sh
   ```

⚠️ **Selectel ru-3 не поддерживает bucket lifecycle** (проверено 13.06.2026):
`put-bucket-lifecycle-configuration` возвращает успех (exit 0), но
`get-bucket-lifecycle-configuration` сразу после — `NoSuchLifecycleConfiguration`
(в обоих форматах правила: с `Filter` и со старым `Prefix`). Конфигурация не
сохраняется на стороне провайдера. Versioning при этом работает и включается
нормально.

**Следствие:** старые версии файлов в `moodledata-mirror/` (после `--delete`
или перезаписи) не истекают автоматически — versioning без lifecycle может
растить bucket бесконечно. На практике риск низкий — файлы moodledata (SCORM,
загрузки) почти не удаляются/перезаписываются. Но в "Регулярная проверка"
(см. ниже) стоит смотреть не только дату последнего файла, но и общий размер
`moodledata-mirror/` — если растёт быстрее самого moodledata, версии копятся
и нужно чистить вручную (`s3api list-object-versions` + `delete-object
--version-id`).

Проверить подключение:
```bash
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/
```

⚠️ **Если бакет удалён** (`NoSuchBucket` на любой операции — например, после
ручной чистки в консоли Selectel): данные из удалённого бакета теряются, если
Selectel не восстановит его по запросу в поддержку. Решение — повторить шаги
1-4 (новый/восстановленный бакет с тем же именем `geocore-backups`), затем
запустить `docker exec geocore_backup /scripts/backup.sh` вручную, чтобы сразу
закрыть разрыв в бэкапах.

---

## Ручной запуск бэкапа

```bash
# Запустить сейчас, не ждать 02:00
docker exec geocore_backup /scripts/backup.sh

# Смотреть лог
docker logs -f geocore_backup
```

---

## Что есть в S3

```bash
# Список всех бэкапов БД (daily/weekly/monthly)
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/ --recursive | grep -v moodledata-mirror

# Только daily
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/daily/

# Зеркало moodledata — текущий размер
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru \
  s3 ls s3://geocore-backups/moodledata-mirror/ --recursive --summarize | tail -2

# Месячные холодные снапшоты moodledata
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/monthly/ | grep moodle
```

---

## Восстановление

**Полный runbook → [`RECOVERY.md`](../RECOVERY.md)** (открывай во время инцидента).

Быстрые команды:

```bash
cd /opt/geocore

# Загрузить .env безопасно (source ломается на значениях с пробелами)
while IFS= read -r line; do [[ "$line" =~ ^[^#=]*= ]] && export "$line" 2>/dev/null; done < .env

bash scripts/restore.sh --dry-run   # проверить что файлы есть в S3
bash scripts/restore.sh             # восстановить (интерактивный выбор точки)
bash scripts/restore.sh 2026-04-24  # конкретная дата
bash scripts/restore.sh weekly/2026-W15  # конкретная неделя
```

**Важно (гибридная схема):** moodledata восстанавливается по-разному в зависимости от точки:

- `daily/<date>` и `weekly/<id>` — БД восстанавливается на эту точку, а
  **moodledata — из текущего `moodledata-mirror/`** (т.е. на "сейчас", не на
  дату точки). Для разноса по времени между БД и файлами это не страшно —
  файлы Moodle (SCORM-пакеты и т.п.) почти не меняются.
- `monthly/<id>` — и БД, и moodledata восстанавливаются из **холодного
  снапшота на 1-е число месяца** (`monthly/moodle-<id>.tar.gz`) — полностью
  согласованная точка восстановления.

Восстановление moodledata из mirror требует `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` в `.env` (используется `amazon/aws-cli` для `s3 sync`
прямо в volume).

---

## Bootstrap новой машины (Сценарий 1 — полная потеря VPS)

Одна команда на чистой Ubuntu 22.04:

```bash
curl -fsSL https://raw.githubusercontent.com/Andreyhiitola/geocore/main/scripts/bootstrap-vps.sh \
  -o /tmp/bootstrap.sh && bash /tmp/bootstrap.sh --prod
```

Скрипт сам: установит Docker, swap, склонирует репо, запросит `.env` из Bitwarden, запустит restore.

**Флаги:**
- `--prod` — production: полный restore + напоминание настроить nginx/SSL
- `--local` — тест на локальной VM: только dry-run S3 (не качает данные)
- `--local --full` — тест с реальным restore (осторожно: качает всё)

---

## Тренировка на локальной VM

```bash
# Безопасная загрузка .env (без source — он ломается на пробелах в значениях)
set +H  # отключить history expansion для символа !
while IFS= read -r line; do
    [[ "$line" =~ ^[^#=]*= ]] && [[ ! "$line" =~ PROXY ]] && export "$line" 2>/dev/null
done < /opt/geocore/.env

COMPOSE_DIR=/opt/geocore MOODLE_URL=http://192.168.1.122:8080 \
  bash /opt/geocore/scripts/restore.sh --dry-run
```

⚠️ Для полного теста нужен диск **80+ ГБ** (moodledata ~36 ГБ на текущем объёме,
плюс место под скачивание + распаковку/синхронизацию). На Proxmox: Hardware →
Disk Action → Resize, потом `sudo growpart /dev/sda 3 && sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv && sudo resize2fs /dev/ubuntu-vg/ubuntu-lv`.

---

## Регулярная проверка (раз в месяц)

```bash
# Убедиться что свежие бэкапы БД есть
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru \
  s3 ls s3://geocore-backups/daily/ | tail -5

# Проверить размер БД — должен быть сопоставим с предыдущими
# Резкое уменьшение = что-то пошло не так при дампе

# Проверить что moodledata-mirror синхронизируется (дата последней модификации
# самого свежего файла должна быть близка к сегодняшней)
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru \
  s3 ls s3://geocore-backups/moodledata-mirror/ --recursive | sort | tail -3

# Проверить, что versioning/lifecycle не "слетели" (например, после ручных
# изменений бакета) — должно быть Status: Enabled и оба правила lifecycle
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3api get-bucket-versioning --bucket geocore-backups
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3api get-bucket-lifecycle-configuration --bucket geocore-backups
```

---

## Оптимизация размера бэкапа

`backup.sh` исключает временные папки Moodle — они пересоздаются автоматически.
Список одинаковый для `s3 sync` (`SYNC_EXCLUDES`, ежедневное зеркало) и для
`tar.gz` (`TAR_EXCLUDES`, месячный холодный снапшот):

| Исключено | Что там | Безопасно? |
|-----------|---------|-----------|
| `cache/` | сгенерированный кэш | да |
| `localcache/` | кэш плагинов | да |
| `temp/` | незавершённые загрузки | да |
| `trashdir/` | удалённые файлы | да |
| `filedir/` | **курсы, SCORM, загрузки** | ❌ не исключать |

mysqldump (БД) — каждый раз полный дамп, но он маленький и быстро меняется,
поэтому GFS-ротация по нему оправдана. moodledata — `s3 sync` инкрементален
(заливает только изменившиеся/новые файлы), а полный `tar.gz` теперь делается
только раз в месяц вместо каждого дня — это и есть основная экономия хранилища.

---

## Архитектурная особенность: crond и Docker env

**Busybox crond не наследует переменные окружения Docker.**
Переменные из `docker-compose.yml environment:` доступны процессу контейнера (PID 1), но не передаются заданиям crond.

Решение (реализовано в `backup/entrypoint.sh`):
```sh
#!/bin/sh
export -p > /tmp/docker_env.sh   # сохранить env при старте контейнера
exec crond -f
```
Crontab: `. /tmp/docker_env.sh && /scripts/backup.sh`

Без этого скрипт молча падал на `S3_BUCKET:?...`, не отправляя уведомлений.

---

## Возможные проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| `S3_BUCKET не задан` | Нет в `.env` или crond не унаследовал env | Добавить в `.env`; убедиться что `entrypoint.sh` есть в образе |
| `Access Denied` | Неверные ключи | Проверить ключи сервисного пользователя |
| `NoSuchBucket` на ВСЕХ операциях (sync, ls, rm) | Bucket удалён (в т.ч. вручную из консоли) или неверная зона | Пересоздать бакет (см. "Настройка Selectel S3"), запустить `setup-bucket.sh`, затем вручную `docker exec geocore_backup /scripts/backup.sh` |
| Файлы не появляются в S3 (только ручные) | Автоматический cron не работает | Пересобрать контейнер: `docker compose up -d --build backup` |
| Бэкап зависает на загрузке 3+ ГБ | `aws s3 cp` без таймаута | `--cli-read-timeout 300` в `s3()` функции (уже в скрипте) |
| Бэкап останавливается на ротации | `aws s3 ls` зависал или `set -e` на ошибке | Блоки ротации обёрнуты в `\|\| true` (уже в скрипте) |
| `moodledata-mirror/` растёт быстрее, чем меняются файлы | Versioning включён, а lifecycle — нет (старые версии копятся бесконечно) | Запустить `setup-bucket.sh` — добавит правило `expire-noncurrent-versions` |
| Старая ротация: `moodle-*.tar.gz` копится в `daily`/`weekly`/`monthly` без удаления | Баг в `${key/db-/moodle-}` — генерировал `.sql.gz` вместо `.tar.gz`, `s3 rm` молча падал | Исправлено в `backup.sh`; в гибридной схеме daily/weekly вообще не хранят moodle-tar — актуально только для `monthly/` |
| Restore moodledata из mirror падает: `AWS_ACCESS_KEY_ID не задан` | `restore.sh` для `daily`/`weekly` синхронизирует moodledata из `moodledata-mirror/` через `amazon/aws-cli`, нужны ключи | Добавить `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` в `.env` на восстанавливаемом хосте |
| Telegram-уведомления не приходят (`fail()`/`notify()`) | FirstVDS блокирует IP Telegram (та же проблема, что у `geocore_bot`) | Не исправлено для `geocore_backup` — нужен SOCKS5-туннель аналогично боту, либо проверять `docker logs`/`/var/log/backup.log` вручную |
| Moodle не отвечает после restore | Идёт инициализация | Подождать 2–5 мин, `docker logs geocore_moodle` |
| Диск VPS заполняется на ~36ГБ/день, бэкап падает на `ERROR: Ошибка загрузки db в S3` (`NoSuchBucket`) | (1) Бакет `geocore-backups` удалён/не пересоздан; (2) `BACKUP_DIR` не чистится при `fail()` → `exit 1` происходит ДО `rm -rf`, `/tmp/geocore-backup-<date>` (с tar.gz moodledata) копится в контейнере каждый день | (1) Пересоздать бакет (`aws s3 mb`) + `setup-bucket.sh`; (2) исправлено в `backup.sh` — `trap 'rm -rf "$BACKUP_DIR"' EXIT` чистит при любом исходе. Вручную почистить накопленное: `docker exec geocore_backup sh -c 'rm -rf /tmp/geocore-backup-2026-*'` |
| `geocore_backup` молча работает по старой (не гибридной) схеме после обновления `backup.sh` | `backup:` собирается локально (`build:`, без `image:`) — Watchtower обновляет только образы из registry, локальные билды не трогает | После любого изменения `scripts/backup.sh`/`backup/Dockerfile`: `docker compose build backup && docker compose up -d backup` на VPS вручную |
