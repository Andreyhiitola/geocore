# GeoCore Academy — Бэкапы и восстановление

> Последнее обновление: 2026-06-14

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

# SOCKS5-туннель до severen для notify() — FirstVDS блокирует Telegram.
# По умолчанию docker-compose.yml сам ставит socks5h://172.19.0.1:1080
# (gateway бриджа geocore_net), переопределять нужно только если изменился
# адрес/порт туннеля. НЕ переименовывать в HTTPS_PROXY — его читает aws-cli
# и s3 sync пойдёт через тот же туннель (см. "SOCKS5-туннель для Telegram" ниже)
# BACKUP_TELEGRAM_PROXY=socks5h://172.19.0.1:1080
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

## SOCKS5-туннель для Telegram (notify)

С 13.06.2026 `geocore_backup` отправляет алерты в Telegram через тот же
SOCKS5-туннель, что использует `geocore_bot` (FirstVDS блокирует IP Telegram
напрямую).

**Отличие от бота:** `geocore_bot` сидит на `network_mode: host` и стучится в
`127.0.0.1:1080`. `geocore_backup` живёт на `geocore_net` (bridge), у него своего
`127.0.0.1` нет — поэтому `autossh-telegram.service` на хосте слушает **две**
привязки:

```
ExecStart=... -D 127.0.0.1:1080 -D 172.19.0.1:1080 ...
```

`172.19.0.1` — gateway-IP бриджа `geocore_geocore_net` (контейнеры стучатся в
host через него). Дополнительно нужно правило ufw (по умолчанию `INPUT` —
default-deny):

```bash
ufw allow from 172.19.0.0/16 to any port 1080 proto tcp comment 'geocore_net -> SOCKS5 tunnel (geocore_backup)'
```

**Важно — отдельная переменная `TELEGRAM_PROXY`, не `HTTPS_PROXY`:**
`aws-cli` (botocore) автоматически читает `HTTPS_PROXY`/`https_proxy`. Если
завести туда туннель до severen, `s3 sync`/`s3 cp` тоже попытаются идти через
него и упадут (`Failed to connect to proxy URL`) — Selectel S3 доступен с VPS
напрямую, проксировать его не нужно. Поэтому в `backup.sh` `notify()` явно
использует `--proxy "$TELEGRAM_PROXY"`, а `docker-compose.yml` задаёт
`TELEGRAM_PROXY` (не `HTTPS_PROXY`) для сервиса `backup`.

Проверить туннель из контейнера:
```bash
docker exec geocore_backup curl -s --max-time 15 --proxy socks5h://172.19.0.1:1080 \
  https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe
```

---

## Открытые вопросы (backlog, не приоритет)

**1. Единые credentials для прод и бэкапа — риск ransomware.**
`AWS_ACCESS_KEY_ID`/`SECRET` в `.env` на geocore VPS имеют полный доступ к
`geocore-backups` (включая удаление объектов/версий/бакета — именно так бакет
и пропал 13.06, см. таблицу ниже). Если скомпрометируют VPS — можно стереть
и прод, и бэкап одной командой.

Тестировалось 13.06.2026: ограничить через S3 bucket policy (`Deny` для
delete-операций конкретному ключу). **Не сработало надёжно** — Selectel ru-3
применяет policy (это не no-op, как lifecycle), но движок нестандартный:
минимальный `Deny Principal:* Action:s3:DeleteBucket` сразу сломал
`GetBucketPolicy` даже для владельца бакета. Точную настройку через bucket
policy на этой платформе считаем слишком рискованной (легко залочить себя).

**Реализовано 13.06.2026: S3 Object Lock (COMPLIANCE) для GFS db/usn.**
Selectel поддерживает Object Lock (подтверждено поддержкой + протестировано
на одноразовом тестовом бакете). На `geocore-backups` включён Object Lock
БЕЗ default-правила (`{"ObjectLockEnabled":"Enabled"}`, не действует на
существующие загрузки и на `moodledata-mirror`). В `backup.sh` добавлен
`s3_put_locked()` — `daily/weekly/monthly db-*.sql.gz` и `usn-*.db`
загружаются через `s3api put-object --object-lock-mode COMPLIANCE
--object-lock-retain-until-date +35 дней` (коммит `9d0808ae5`).

Протестировано на тестовом бакете `geocore-test-objectlock-20260613`:
- COMPLIANCE не имеет bypass (в отличие от GOVERNANCE, где
  `--bypass-governance-retention` сработал тем же credential'ом — то есть
  GOVERNANCE НЕ защищает от целевой атаки тем же ключом, только от
  случайного/наивного удаления)
- `s3 rm`/delete-маркеры работают как обычно на залоченных объектах —
  `rotate()` не падает, просто залоченная версия физически остаётся до
  конца retention (для ~1МБ файлов — несущественный прирост объёма)

Итог: даже при полной компрометации credentials и `s3 rm --recursive` по
всему бакету последние ~35 дней дампов БД и USN физически неудаляемы.

**Остаточный риск:** `moodledata-mirror/` (файлы курсов, 36+ ГБ) Object
Lock'ом не защищён — там лок умножил бы уже известную проблему
накопления старых версий (lifecycle не работает). Для этого остаётся
предложение ниже.

**Предложенное решение для moodledata (не реализовано):** модель "pull"
вместо "push" — вторая независимая копия `geocore-backups`, которую
забирает к себе машина, НЕ имеющая доступа к ключам geocore VPS (например,
`severen` или другой аккаунт/провайдер — Yandex Object Storage и т.п.).
Даже при полной компрометации geocore VPS эта копия не пострадает.

**2. `severen` как единая точка для Telegram-тоннеля и потенциальной
второй копии.** Если `severen` упадёт:
- Telegram-алерты (`notify()`) снова замолкнут — но это деградация
  алертинга, не потеря данных: бэкап продолжит писать в S3 и в
  `/var/log/backup.log` (volume), `|| true` не прерывает скрипт
- Вторая копия (если будет реализована по пункту 1) перестанет обновляться,
  но не исчезнет — тоже деградация (stale), не потеря

Т.е. `severen` не SPOF для сохранности данных — только для "узнаем ли быстро
о проблеме". Страховка уже есть — ручная "Регулярная проверка" (см. ниже),
не зависит от Telegram.

**3. USN SQLite (`usn-*.db`) — GFS-ротация. Исправлено 13.06.2026.**
Раньше `$USN_FILE` копировался только в `daily/` и вообще не ротировался
(копии накапливались бесконечно). Теперь `usn-*.db` участвует в
weekly/monthly наравне с `$DB_FILE`, ротация (7/4/12) — через общий
helper `rotate()` в `backup.sh` (коммит `ce1cc577a`).

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
| Telegram-уведомления не приходят (`fail()`/`notify()`) | FirstVDS блокирует IP Telegram | Исправлено 13.06.2026 — SOCKS5-туннель через `TELEGRAM_PROXY` (см. "SOCKS5-туннель для Telegram" выше). Если снова не приходят — проверить `systemctl status autossh-telegram` и `docker exec geocore_backup curl --proxy socks5h://172.19.0.1:1080 https://api.telegram.org` |
| `notify()` висит ~2 мин на каждом вызове | `curl` без `--max-time`, упирается в OS TCP timeout при заблокированном Telegram | Исправлено 13.06.2026 — `--max-time 15` в `notify()` |
| Moodle не отвечает после restore | Идёт инициализация | Подождать 2–5 мин, `docker logs geocore_moodle` |
| Диск VPS заполняется на ~36ГБ/день, бэкап падает на `ERROR: Ошибка загрузки db в S3` (`NoSuchBucket`) | (1) Бакет `geocore-backups` удалён/не пересоздан; (2) `BACKUP_DIR` не чистится при `fail()` → `exit 1` происходит ДО `rm -rf`, `/tmp/geocore-backup-<date>` (с tar.gz moodledata) копится в контейнере каждый день | (1) Пересоздать бакет (`aws s3 mb`) + `setup-bucket.sh`; (2) исправлено в `backup.sh` — `trap 'rm -rf "$BACKUP_DIR"' EXIT` чистит при любом исходе. Вручную почистить накопленное: `docker exec geocore_backup sh -c 'rm -rf /tmp/geocore-backup-2026-*'` |
| `geocore_backup` молча работает по старой (не гибридной) схеме после обновления `backup.sh` | `backup:` собирается локально (`build:`, без `image:`) — Watchtower обновляет только образы из registry, локальные билды не трогает | После любого изменения `scripts/backup.sh`/`backup/Dockerfile`: `docker compose build backup && docker compose up -d backup` на VPS вручную |
| `daily/`/`weekly`/`monthly` в S3 пустые, бот `📋 История бэкапов` → "Не удалось получить данные", хотя `geocore_backup` зелёный и moodledata-mirror обновляется | **Исправлено 14.06.2026.** Старый порядок шагов: дамп БД → `s3 sync moodledata --delete` → загрузка db/usn в S3. Selectel периодически отдаёт `429 Too Many Requests` на `DeleteObject` при churn session-файлов moodledata → `s3 sync` возвращает ненулевой код → `\|\| fail(...)` делал `exit 1` ДО загрузки уже снятого дампа БД в `daily/` | Загрузка db/usn (Object Lock, GFS) теперь идёт сразу после дампа, ДО `s3 sync moodledata`; ошибка `s3 sync` больше не фатальна (warning + `⚠️` в Telegram, бэкап БД и ротация продолжаются) |
