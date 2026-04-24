# GeoCore Academy — Миграция и масштабирование

> Последнее обновление: 2026-04-24

---

## Три уровня инфраструктуры

```
Сейчас          → 1 VPS (продакшен)
Ближайший план  → локальная машина для тестирования + 1 VPS
Перспектива     → 2 VPS: primary + standby, потом балансировка
```

---

## Уровень 1 — Локальное тестирование за NAT

### Что работает без публичного IP

| Задача | Работает? | Как |
|--------|-----------|-----|
| Поднять Moodle локально | ✅ | `docker-compose.test.yml` |
| Восстановить данные из S3 | ✅ | `restore.sh` с test-переменными |
| Проверить функциональность Moodle | ✅ | `http://localhost:8082` |
| Тест nginx + SSL с реальным доменом | ❌ | Нет публичного IP для Let's Encrypt |
| CI/CD деплой с GitHub Actions | ❌ | GitHub не достучится через NAT |

### Запуск полного тест-окружения

```bash
cd /home/andysag/Desktop/geocore

# 1. Поднять тестовый стек
docker compose -f docker-compose.test.yml up -d

# 2. Восстановить production-данные из S3 в тестовый стек
set -a && source /opt/geocore/.env && set +a   # взять S3-ключи с VPS (или вписать вручную)

COMPOSE_DIR=$(pwd) \
COMPOSE_FILE=docker-compose.test.yml \
MOODLE_SERVICE=moodle-test \
MARIADB_SERVICE=mariadb-test \
MOODLE_DB_NAME=moodle_test \
MOODLE_DB_USER=moodle \
MOODLE_DB_PASSWORD=testpass \
MOODLE_URL=http://localhost:8082 \
./scripts/restore.sh

# Открыть — Moodle с реальными данными на локальной машине
xdg-open http://localhost:8082
```

> ⚠️ `MOODLE_WWWROOT` в тестовом окружении = `http://localhost:8082`. После restore
> сессии из production не будут работать — это нормально, Moodle создаст новые.

### Тестирование CI/CD скрипта локально (без GitHub Actions)

Когда нужно проверить deploy-процедуру не запуская CI/CD:

```bash
# Эмуляция того, что делает GitHub Actions deploy-шаг
cd /home/andysag/Desktop/geocore
git pull origin main
docker compose -f docker-compose.test.yml pull 2>/dev/null || true
docker compose -f docker-compose.test.yml up -d --remove-orphans
```

### Локальный nginx + /etc/hosts (если нужен полный стек)

Если нужно тестировать nginx-конфиг или поведение за reverse proxy — без SSL:

```bash
# /etc/hosts — имитировать домены локально
echo "127.0.0.1  courses.local.test" | sudo tee -a /etc/hosts
echo "127.0.0.1  api.local.test" >> /etc/hosts

# Создать упрощённый nginx конфиг без SSL
# courses.local.test → localhost:8082
```

Это редко нужно — `docker-compose.test.yml` покрывает 95% случаев.

---

## Уровень 2 — Переезд на новый VPS

### Когда это нужно
- Смена хостинга / региона
- Апгрейд на более мощный тариф
- VPS скомпрометирован

### Чеклист (порядок важен)

```
□ 1. Снизить TTL DNS-записей до 60 сек (за сутки до переезда)
□ 2. Арендовать новый VPS (Ubuntu 22.04 / Debian 12)
□ 3. Установить Docker + Compose v2 + nginx + certbot на новом VPS
□ 4. git clone https://github.com/Andreyhiitola/geocore /opt/geocore
□ 5. Скопировать .env со старого VPS или заполнить заново
□ 6. docker compose up -d  ← поднять пустой стек
□ 7. Убедиться что MariaDB отвечает (docker exec geocore_db mysqladmin ping)
□ 8. ./scripts/restore.sh  ← восстановить данные из S3
□ 9. Переключить DNS → новый IP (A-записи: geocore-academy.ru, courses.*, api.*)
□ 10. certbot --nginx -d geocore-academy.ru -d courses.geocore-academy.ru -d api.geocore-academy.ru
□ 11. cp nginx/geocore.conf /etc/nginx/sites-available/geocore
□    ln -s /etc/nginx/sites-available/geocore /etc/nginx/sites-enabled/
□    nginx -t && systemctl reload nginx
□ 12. Открыть courses.geocore-academy.ru — проверить вход в Moodle
□ 13. GitHub → Settings → Secrets: VPS_HOST → новый IP
□    (VPS_SSH_KEY обновить если ключ другой)
□ 14. Сделать git push → убедиться что CI/CD деплоит на новый VPS
□ 15. Старый VPS держать ещё 2-3 дня, потом удалить
```

### Установка Docker на новом VPS (copy-paste)

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# Docker Compose v2
COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest \
  | grep tag_name | cut -d'"' -f4)
curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

---

## Уровень 3 — Запасной VPS (active-passive)

Два VPS: **primary** работает, **standby** готов принять трафик за ~5 минут.

### Архитектура

```
                    ┌─────────────────┐
DNS → primary VPS  │  geocore (prod) │ ← весь трафик
                    └────────┬────────┘
                             │ бэкапы → Selectel S3
                    ┌────────▼────────┐
standby VPS        │  geocore (copy) │ ← данные актуальны на 24ч
                    └─────────────────┘
```

### Настройка standby

Установить как обычный VPS (шаги 1–11 из чеклиста выше), но:

```bash
# На standby: настроить ночную синхронизацию из S3
# Добавить в crontab на standby VPS
crontab -e
# ежедневно в 04:00 (после того как primary сделал бэкап в 02:00)
0 4 * * * cd /opt/geocore && set -a && source .env && set +a && ./scripts/restore.sh --auto

# Флаг --auto нужно добавить в restore.sh — см. ниже
```

Добавить в `restore.sh` поддержку автоматического режима (без интерактивного ввода):

```bash
# В секции разбора аргументов:
--auto) AUTO=true; RESTORE_POINT_ARG="" ;;

# В секции подтверждения заменить read на:
if [[ "${AUTO:-false}" != "true" ]]; then
    read -r -p "Для подтверждения введите 'yes': " confirm
    [[ "$confirm" == "yes" ]] || { log "Отменено."; exit 0; }
fi
```

### Failover на standby (5 минут)

```
1. DNS → A-записи поменять на IP standby VPS
2. GitHub Secrets → VPS_HOST поменять на IP standby
3. Проверить courses.geocore-academy.ru
4. При необходимости: certbot --nginx -d ... (SSL уже есть, но может потребоваться обновить)
```

Потеря данных при failover: максимум 26 часов (последний бэкап был в 02:00, failover в 04:00 следующего дня). Чтобы уменьшить — поднять частоту бэкапов в `scripts/backup.sh` (каждые 6 часов).

### Возврат на primary (после ремонта)

```bash
# Восстановить primary из S3 (там будут данные со standby, т.к. standby тоже бэкапит)
./scripts/restore.sh

# Переключить DNS и GitHub secrets обратно
```

---

## Уровень 4 — Балансировка нагрузки (будущее)

### Почему сейчас не нужно

Moodle на одном VPS держит 200-500 одновременных пользователей без проблем. До этого порога горизонтальное масштабирование только добавит сложности.

Сначала вертикальный апгрейд (2 CPU → 4 CPU, 2 ГБ → 4 ГБ RAM) — дешевле и проще.

### Что потребуется когда придёт время

Moodle не масштабируется горизонтально из коробки — нужно решить три проблемы:

**1. Shared moodledata** — сейчас файлы в Docker volume на одном VPS. При двух VPS нужно общее хранилище:
```
Вариант А: NFS-сервер (отдельная VM, монтируется на оба VPS)
Вариант Б: S3-mount (s3fs/goofys) — медленнее, но дешевле
Вариант В: Переехать на облачный Moodle (Moodle Cloud, Bitnami) — самое простое
```

**2. Sticky sessions в nginx** — HTTP-сессии Moodle хранятся на сервере. При двух VPS пользователь должен всегда попадать на один и тот же:
```nginx
upstream moodle_backends {
    ip_hash;                          # один IP всегда на один backend
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
}
```

**3. Shared database** — MariaDB должна быть одна, не на каждом VPS:
```
Вариант А: MariaDB на отдельном VPS (primary), оба Moodle-сервера подключаются к нему
Вариант Б: MariaDB Galera Cluster (репликация) — сложно, для старта избыточно
Вариант В: Managed DB (Selectel DBaaS, Yandex Managed MySQL) — проще всего
```

### Итоговая схема при балансировке

```
Браузер
   ↓
nginx (балансировщик, отдельный VPS или Selectel Load Balancer)
   ├── VPS-1: geocore_moodle + geocore_api + geocore_frontend
   └── VPS-2: geocore_moodle + geocore_api + geocore_frontend
                    ↓
             NFS / S3 (shared moodledata)
                    ↓
             MariaDB (отдельный VPS или managed)
```

До 500 одновременных пользователей этот уровень не нужен.
