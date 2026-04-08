# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Начало каждой сессии

Обязательно прочитать:
1. `STATUS.md` — текущий статус всех компонентов и список задач
2. `SESSION_LOG.md` — история сессий, принятые решения, что отложено
3. `WORKFLOW.md` — протокол работы: ветки, коммиты, правила

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

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `docker-compose.yml` | Production — образы с Docker Hub |
| `docker-compose.test.yml` | Локальный тест (порты 8081/8001) |
| `backend/main.py` | FastAPI: геологические расчёты + `/api/courses` из Moodle |
| `frontend/js/data/siteRenderer.js` | Рендеринг nav/курсов/футера, загрузка курсов из API |
| `frontend/js/data/site.json` | Статические данные: nav, анонсы курсов, футер |
| `nginx/geocore.conf` | Reverse proxy на хосте VPS |
| `moodle/entrypoint.sh` | Автоустановка Moodle, генерация config.php |

## Правила

- **Moodle не трогать** без явного согласования — `moodle/` только после подтверждения
- Хотфиксы и конфиги — сразу в `main`, крупные фичи — через ветку `feat/название`
- Коммиты: `feat:` / `fix:` / `docs:` / `chore:` / `ci:`
- После сессии обновить `STATUS.md` и `SESSION_LOG.md`

## Локальный запуск

```bash
docker compose -f docker-compose.test.yml up --build
# Moodle: http://localhost:8081
# API:    http://localhost:8001
```

## Обновление Moodle

```
1. Изменить MOODLE_VERSION в docker-compose.test.yml
2. docker compose -f docker-compose.test.yml down -v && up --build
3. Проверить localhost:8081
4. Изменить MOODLE_VERSION в .github/workflows/deploy.yml
5. git push → автодеплой
```
