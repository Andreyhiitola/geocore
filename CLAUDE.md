# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Начало каждой сессии

Обязательно прочитать:
1. `STATUS.md` — текущий статус всех компонентов и список задач
2. `SESSION_LOG.md` — история сессий, принятые решения, что отложено
3. `WORKFLOW.md` — протокол работы: ветки, коммиты, правила
4. `wiki/INDEX.md` — накопленная база знаний (при работе с конкретной темой читать соответствующий раздел wiki)

## Архитектура

```
Браузер → nginx (хост VPS) → 
  ├── geocore-academy.ru        → geocore_frontend (nginx:alpine, порт 80)
  ├── courses.geocore-academy.ru → geocore_moodle (PHP/Apache, порт 8080)
  └── api.geocore-academy.ru    → geocore_api (FastAPI, порт 8000)
                                       ↓
                                 geocore_db (MariaDB 10.11)
```

- **VPS:** путь `/opt/geocore`
- **Docker Hub:** `andreysagurov` — образы `geocore-backend`, `geocore-frontend`, `geocore-moodle`
- **CI/CD:** GitHub Actions — пересобирает образ только при изменениях в соответствующей папке (`backend/`, `frontend/`, `moodle/`), затем деплоит на VPS

## Backend (FastAPI)

Бэкенд будет разделён на два независимых API:

**1. VPS API** (`api.geocore-academy.ru`) — лёгкие операции, живёт в Docker на VPS:
- `/api/courses` — список курсов из Moodle
- `/api/requests` — приём заявок на корпоративное обучение
- `/api/admin/*` — администрирование (защищено `ADMIN_TOKEN` Bearer)
- `/api/admin/site-json` — редактирование `frontend/js/data/site.json` через GitHub API → запускает CI/CD

**2. Локальный сервер (в сети Wi-Fi)** — тяжёлые геологические вычисления, VPS не потянет:
- Модули `backend/processing/` (compositor, decluster, wireframe, mac_generator)
- Пайплайн: validate → composite → decluster → wireframe → mac
- Собственный URL, доступный фронтенду или VPS API как прокси

Сейчас оба API живут в одном `backend/main.py`. Разделение — в планах, но не сейчас.

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `docker-compose.yml` | Production — образы с Docker Hub |
| `docker-compose.test.yml` | Обкатка новых версий Moodle локально перед деплоем в прод (порты 8081/8001) |
| `backend/main.py` | FastAPI: геологические расчёты + курсы Moodle + заявки + admin |
| `frontend/js/data/siteRenderer.js` | Рендеринг nav/курсов/футера, загрузка курсов из API |
| `frontend/js/data/site.json` | Статические данные: nav, анонсы курсов, футер |
| `nginx/geocore.conf` | Reverse proxy на хосте VPS |
| `moodle/entrypoint.sh` | Автоустановка Moodle, генерация config.php |
| `.github/workflows/deploy.yml` | CI/CD: переменная `MOODLE_VERSION` хранится здесь |

## Локальный запуск (обкатка Moodle)

```bash
docker compose -f docker-compose.test.yml up --build
# Moodle: http://localhost:8081
# API:    http://localhost:8001
```

Используется для проверки новой версии Moodle перед деплоем. В прод деплоится только после того, как убедились что сборка прошла и миграция БД выполнится без конфликтов.

## Правила

- **Moodle не трогать** — `moodle/` только после явного согласования, рабочую версию нельзя сломать
- Хотфиксы и конфиги — сразу в `main`, крупные фичи — через ветку `feat/название`
- Коммиты: `feat:` / `fix:` / `docs:` / `chore:` / `ci:`
- После сессии обновить `STATUS.md` и `SESSION_LOG.md` — автоматически, без напоминания
- После сессии обновить `wiki/` — извлечь новые знания и интегрировать в нужные разделы (не дублировать, а добавлять только новое)

## Переменные окружения (backend)

Задаются в `.env` на VPS (шаблон `.env.example`). Критичные:
- `MOODLE_TOKEN` — Web Services токен Moodle (нужен для `/api/courses`)
- `ADMIN_TOKEN` — Bearer-токен для `/api/admin/*`
- `GITHUB_TOKEN` — для редактирования `site.json` через GitHub API
- `SMTP_*` — транзакционная почта (сейчас Gmail SMTP)
