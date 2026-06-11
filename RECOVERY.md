# GeoCore Academy — Disaster Recovery Runbook

> Открыл во время инцидента — читай сверху вниз, выполняй по шагам.

---

## Сценарий 1 — Полная потеря VPS (новая машина)

**Когда:** VPS недоступен, провайдер не может восстановить, нужна новая машина.

### Требования к новой машине
- Ubuntu 22.04 LTS, минимум 4 CPU / 4 GB RAM / 80 GB диск (moodledata ~36 ГБ + место под скачивание/синхронизацию)
- Пользователь с sudo (не root)
- Интернет без прокси

### Шаг 1 — Запустить bootstrap (одна команда)

```bash
curl -fsSL https://raw.githubusercontent.com/Andreyhiitola/geocore/main/scripts/bootstrap-vps.sh -o /tmp/bootstrap.sh && bash /tmp/bootstrap.sh
```

Скрипт сам установит Docker, swap, склонирует репо и запустит restore из S3.  
Когда попросит `.env` — вставить из **Bitwarden** (секция GeoCore / VPS .env).
`.env` должен содержать `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` —
moodledata теперь восстанавливается через `s3 sync` из `moodledata-mirror/`
(см. [`BACKUP.md`](wiki/BACKUP.md)), для daily/weekly это обязательно.

⚠️ Если бакет `geocore-backups` отсутствует (`NoSuchBucket`) — сначала
пересоздать его и запустить `scripts/setup-bucket.sh` (versioning + lifecycle),
см. "Настройка Selectel S3" в [`BACKUP.md`](wiki/BACKUP.md). Без этого restore
из `moodledata-mirror/` падать не будет (бакет просто пуст), но восстановить
данные будет неоткуда.

### Шаг 2 — Установить nginx

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /opt/geocore/nginx/geocore.conf /etc/nginx/sites-enabled/geocore
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### Шаг 3 — SSL-сертификат

```bash
sudo certbot --nginx \
  -d geocore-academy.ru \
  -d www.geocore-academy.ru \
  -d courses.geocore-academy.ru \
  -d api.geocore-academy.ru \
  -d usn.geocore-academy.ru \
  -d usn-api.geocore-academy.ru \
  --non-interactive --agree-tos -m 9624294@gmail.com
```

### Шаг 4 — Обновить DNS у провайдера

Сменить A-записи на IP новой машины. DNS TTL = 300s → применяется за 5 минут.

| Домен | Тип | Значение |
|-------|-----|----------|
| geocore-academy.ru | A | <новый IP> |
| *.geocore-academy.ru | A | <новый IP> |

### Шаг 5 — Проверить

```bash
curl -I https://geocore-academy.ru
curl -I https://courses.geocore-academy.ru/login/index.php
docker compose -f /opt/geocore/docker-compose.yml ps
```

**Ожидаемый результат:** HTTP 200/301, все контейнеры `healthy`.

---

## Сценарий 2 — Повреждение данных (VPS жив)

**Когда:** Данные в БД или moodledata побились, но сервер работает.

```bash
cd /opt/geocore
source <(grep -v '^#' .env | grep '=' | grep -v 'PROXY')
bash scripts/restore.sh
# Выбрать точку восстановления из списка
```

Moodle остановится на время restore (~10-15 минут), потом поднимется автоматически.

**Что восстанавливается из какой точки (гибридная схема):**
- `daily/<date>` или `weekly/<id>` — БД на эту точку, moodledata —
  из **текущего** `moodledata-mirror/` (не привязано к дате точки).
- `monthly/<id>` — БД и moodledata из согласованного снапшота на 1-е число
  месяца (`monthly/moodle-<id>.tar.gz`).

Подробнее — [`BACKUP.md`](wiki/BACKUP.md#восстановление).

---

## Сценарий 3 — Плохой деплой / сломанный контейнер

**Когда:** После `git push` что-то сломалось.

```bash
cd /opt/geocore
# Откат к предыдущему образу:
docker compose pull --ignore-pull-failures
docker compose up -d
# Если не помогло — указать конкретный тег:
MOODLE_VERSION=5.1.2 docker compose up -d moodle
```

---

## Сценарий 4 — Потеря .env

**Источник правды:** Bitwarden → секция `GeoCore / VPS .env`  
Скопировать в `/opt/geocore/.env`, затем `docker compose up -d`.

---

## Контакты и доступы

| Ресурс | Где |
|--------|-----|
| Секреты (.env) | Bitwarden → GeoCore / VPS .env |
| Бэкапы S3 | Selectel Object Storage → geocore-backups (versioning + lifecycle, см. `scripts/setup-bucket.sh`) |
| Docker Hub | hub.docker.com → andreysagurov |
| DNS | FirstVDS DNS Manager |
| Провайдер VPS | FirstVDS |

---

## RTO / RPO

| Сценарий | RTO (время восстановления) | RPO (потеря данных) |
|----------|---------------------------|---------------------|
| Полная потеря VPS | 30-60 минут | до 24 часов |
| Повреждение данных | 10-15 минут | до 24 часов |
| Плохой деплой | 2-5 минут | 0 |

RPO для moodledata = время с последнего `s3 sync` (≤24ч, как и раньше).
Дополнительно: случайно удалённые/перезаписанные файлы moodledata можно достать
из старых версий объектов в `moodledata-mirror/` ещё `NONCURRENT_DAYS` (по
умолчанию 14) дней после `s3 sync --delete` — versioning, см. `setup-bucket.sh`.

---

## Bootstrap скрипт — флаги

```bash
bash scripts/bootstrap-vps.sh              # полный запуск с restore
bash scripts/bootstrap-vps.sh --dry-run    # только проверка S3, без записи
bash scripts/bootstrap-vps.sh --skip-restore  # только окружение, без данных
```
