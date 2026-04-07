# GeoCore Academy — Статус проекта

> Последнее обновление: 6 апреля 2026  
> Репозиторий: https://github.com/Andreyhiitola/geocore  
> VPS: 176.123.169.77 (   )  
> Домен: geocore-academy.ru

---

## Что уже сделано

### Docker инфраструктура
- [x] `moodle/Dockerfile` — единый для Moodle 4.x и 5.x, загрузка через tarball
- [x] `moodle/entrypoint.sh` — автоматическая установка и обновление Moodle при старте контейнера
- [x] `backend/Dockerfile` — FastAPI на python:3.11-slim
- [x] `docker-compose.yml` — production (образы с Docker Hub, порты только на 127.0.0.1)
- [x] `docker-compose.test.yml` — локальный тест (сборка локально, порт 8081/8001)
- [x] `nginx/geocore.conf` — reverse proxy с SSL для обоих поддоменов
- [x] `.env.example` — шаблон всех переменных окружения
- [x] `.gitignore` — исключены секреты (.env, config.php и т.д.)

### CI/CD
- [x] `.github/workflows/deploy.yml` — GitHub Actions pipeline:
  - backend пересобирается при изменении `backend/`
  - moodle пересобирается при изменении `moodle/`
  - деплой на VPS по SSH после каждого push в main

### Документация
- [x] `MOODLE_GUIDE.md` — как проверять версию, отслеживать релизы, тестировать обновления
- [x] `ARCHITECTURE.md` — архитектура проекта (эталонная схема)

### Тест локально — ПРОЙДЕН
- [x] Moodle 5.1.3 собирается автоматически
- [x] Установка проходит без ручного вмешательства (CLI installer)
- [x] При смене версии — автоматически запускает upgrade.php (данные сохраняются)
- [x] Backend (FastAPI) запускается

---

## Что осталось сделать

### GitHub (приоритет 1)
- [ ] Добавить 5 секретов в Settings → Secrets and variables → Actions:

| Secret | Значение |
|--------|----------|
| `DOCKERHUB_USERNAME` | логин Docker Hub |
| `DOCKERHUB_TOKEN` | токен из Docker Hub → Account Settings → Personal Access Tokens |
| `VPS_HOST` | `176.123.169.77` |
| `VPS_USER` | `  ` |
| `VPS_SSH_KEY` | содержимое `~/.ssh/id_rsa` или `~/.ssh/id_ed25519` |

### DNS (приоритет 2)
- [ ] У регистратора домена добавить два A-record:

| Имя | Тип | IP |
|-----|-----|----|
| `courses` | A | `176.123.169.77` |
| `api` | A | `176.123.169.77` |

Проверить распространение: https://dnschecker.org

### VPS — настройка (приоритет 3)
Выполнить после распространения DNS:

```bash
# 1. Установка пакетов
apt update && apt install -y nginx certbot python3-certbot-nginx git

# 2. Клонирование проекта
git clone https://github.com/Andreyhiitola/geocore /opt/geocore

# 3. Создание .env из шаблона (заполнить реальными паролями!)
cd /opt/geocore && cp .env.example .env && nano .env

# 4. Nginx конфиг
cp /opt/geocore/nginx/geocore.conf /etc/nginx/sites-available/geocore
ln -s /etc/nginx/sites-available/geocore /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 5. SSL сертификаты
certbot --nginx -d courses.geocore-academy.ru -d api.geocore-academy.ru

# 6. Первый запуск (образы подтянутся с Docker Hub)
cd /opt/geocore && docker compose up -d
```

### Первый деплой через GitHub Actions
- [ ] После настройки VPS сделать `git push` — Actions запустится автоматически
- [ ] Проверить что pipeline прошёл: GitHub → Actions вкладка
- [ ] Открыть https://courses.geocore-academy.ru

---

## Архитектура (итоговая схема)

```
Браузер
   ↓ HTTPS
nginx (на VPS, хост)
   ├── courses.geocore-academy.ru → 127.0.0.1:8080 → контейнер geocore_moodle
   └── api.geocore-academy.ru    → 127.0.0.1:8000 → контейнер geocore_api
                                         ↓
                                  контейнер geocore_db (MariaDB)
                                  контейнер geocore_watchtower (авто-обновления)
```

---

## Переменные окружения (что заполнять в .env на VPS)

```env
DOCKERHUB_USER=andreyhiitola
MOODLE_VERSION=5.1.3

DB_ROOT_PASSWORD=         # сильный пароль
MOODLE_DB_NAME=moodle
MOODLE_DB_USER=moodle
MOODLE_DB_PASSWORD=       # сильный пароль

MOODLE_WWWROOT=https://courses.geocore-academy.ru
MOODLE_SITE_NAME=Geocore-Academy
MOODLE_SITE_SHORTNAME=geocore
MOODLE_LANG=ru

MOODLE_ADMIN_USER=admin
MOODLE_ADMIN_PASS=        # мин. 8 символов, буквы + цифры
MOODLE_ADMIN_EMAIL=       # реальный email

API_SECRET_KEY=           # случайная строка 32+ символа
```

---

## Алгоритм обновления Moodle

```
1. Вышел новый тег (например v5.1.4)
2. Меняешь в docker-compose.test.yml: MOODLE_TEST_VERSION: 5.1.4
3. docker compose -f docker-compose.test.yml down -v
4. docker compose -f docker-compose.test.yml up --build
5. Проверяешь localhost:8081
6. Если OK → меняешь в .github/workflows/deploy.yml: MOODLE_VERSION: '5.1.4'
7. git commit && git push → автодеплой на VPS
8. Данные на VPS сохраняются (upgrade.php обновляет только схему БД)
```

---

## Структура репозитория

```
geocore/
├── .env.example                # шаблон переменных окружения
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD: build → Docker Hub → VPS
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── main.py                 # FastAPI приложение
│   ├── requirements.txt
│   └── processing/             # геологические алгоритмы
├── docker-compose.yml          # production
├── docker-compose.test.yml     # локальный тест
├── moodle/
│   ├── Dockerfile              # единый для 4.x и 5.x
│   ├── entrypoint.sh           # авто-установка и авто-обновление
│   └── php.ini
├── nginx/
│   └── geocore.conf            # reverse proxy + SSL
├── ARCHITECTURE.md             # архитектурная схема
├── MOODLE_GUIDE.md             # инструкция по Moodle
├── STATUS.md                   # этот файл
└── index.html / courses.html / lab.html  # фронтенд
```
