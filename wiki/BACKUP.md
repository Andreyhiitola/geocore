# GeoCore Academy — Бэкапы и восстановление

> Последнее обновление: 2026-05-22

---

## Как работает

Контейнер `geocore_backup` запускает `scripts/backup.sh` **ежедневно в 02:00**.

```
MariaDB (mysqldump) ──┐
                      ├──→ /tmp/  ──→ Selectel S3 (geocore-backups)
moodledata (tar.gz) ──┘
```

**GFS-ротация в S3:**

| Папка | Хранится | Когда создаётся |
|-------|----------|----------------|
| `daily/` | 7 штук | каждый день |
| `weekly/` | 4 штуки | каждое воскресенье |
| `monthly/` | 12 штук | 1-го числа |

Файлы в S3: `daily/db-2026-04-24.sql.gz` и `daily/moodle-2026-04-24.tar.gz`.

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

Проверить подключение:
```bash
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/
```

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
# Список всех бэкапов
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/ --recursive

# Только daily
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru s3 ls s3://geocore-backups/daily/
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

⚠️ Для полного теста нужен диск **40+ ГБ** (moodledata ~16 ГБ на текущем объёме). На Proxmox: Hardware → Disk Action → Resize, потом `sudo growpart /dev/sda 3 && sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv && sudo resize2fs /dev/ubuntu-vg/ubuntu-lv`.

---

## Регулярная проверка (раз в месяц)

```bash
# Убедиться что свежие бэкапы есть
aws --endpoint-url https://s3.ru-3.storage.selcloud.ru \
  s3 ls s3://geocore-backups/daily/ | tail -5

# Проверить размер — должен быть сопоставим с предыдущими
# Резкое уменьшение = что-то пошло не так при архивировании
```

---

## Оптимизация размера бэкапа

`backup.sh` исключает временные папки Moodle из архива — они пересоздаются автоматически:

| Исключено | Что там | Безопасно? |
|-----------|---------|-----------|
| `cache/` | сгенерированный кэш | да |
| `localcache/` | кэш плагинов | да |
| `temp/` | незавершённые загрузки | да |
| `trashdir/` | удалённые файлы | да |
| `filedir/` | **курсы, SCORM, загрузки** | ❌ не исключать |

Бэкапы инкрементальными **не являются** — каждый раз полный tar + mysqldump.

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
| `no such bucket` | Bucket не создан | Создать в Selectel Console |
| Файлы не появляются в S3 (только ручные) | Автоматический cron не работает | Пересобрать контейнер: `docker compose up -d --build backup` |
| Бэкап зависает на загрузке 3+ ГБ | `aws s3 cp` без таймаута | `--cli-read-timeout 300` в `s3()` функции (уже в скрипте) |
| Бэкап останавливается на ротации | `aws s3 ls` зависал или `set -e` на ошибке | Блоки ротации обёрнуты в `\|\| true` (уже в скрипте) |
| Moodle не отвечает после restore | Идёт инициализация | Подождать 2–5 мин, `docker logs geocore_moodle` |
