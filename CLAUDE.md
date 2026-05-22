# geocore

> Контекст для Claude Code. Полная wiki: `wiki-vault/geocore/`.

## Контекст

## Цель

Геологическое ПО и e-learning платформа: инструмент построения wireframe-моделей + онлайн-курсы.

## Ключевые решения

- SCORM-курсы создаются в CourseLab
- Редизайн — CSS/asset замена без пересборки логики
- Wireframe tool: validation-first подход (Hausdorff distance, volume diff, 3D IoU)
- Монетизация: freemium, CLI → web → enterprise (5 фаз)

## Деплой

Pipeline: `git push` → GitHub Actions → Docker Hub → Watchtower авто-обновляет каждые 24ч

```bash
docker compose up -d
docker compose logs -f app
docker compose pull && docker compose up -d
```

nginx конфиг: `/etc/nginx/sites-enabled/geocore` — **файл, не симлинк**.
После изменения: `sudo cp nginx/geocore.conf /etc/nginx/sites-enabled/geocore && sudo nginx -t && sudo systemctl reload nginx`

## Гочи

- MariaDB data в volume — не удалять при `docker compose down`
- `MOODLE_WWWROOT` должен совпадать с реальным URL, иначе редиректы ломаются
- `php.ini` memory_limit минимум 256M для SCORM-плееров
- `.env` редактировать через Bitwarden (источник правды) → потом на VPS

## Решения

- **Watchtower вместо ручного деплоя** — проверяет Docker Hub каждые 24ч, не нужен SSH на каждый коммит
- **nginx как API-прокси для USN** — фронт и бэкенд на одном домене, ключ скрыт от браузера
- **USN→Geocore интеграция** — при подтверждении оплаты USN вызывает Geocore `mark-paid` (не наоборот)
- **HSTS** — `max-age=31536000; includeSubDomains` во всех HTTPS server block'ах; браузер больше не делает HTTP-запрос
- **Bitwarden — источник правды для `.

_(...сокращено)_

## Сделано (07.05.2026 — ночь, usn деплой)

- [x] Задеплоен USN-app на VPS: backend (:3001) + frontend (:3002) в docker-compose geocore
- [x] Dockerfiles для backend и frontend, GitHub Actions workflow
- [x] API-ключ авторизация в usn-app backend (`USN_API_KEY`)
- [x] nginx блоки для `usn.geocore-academy.ru` и `usn-api.geocore-academy.ru`
- [x] SSL сертификат Let's Encrypt для обоих поддоменов
- [x] DNS записи добавлены в FirstVDS DNS Manager
- [x] USN SQLite добавлен в backup.

_(...сокращено)_

## Применимые знания из shared/

- [`shared/docker-vps-deploy.md`](shared/docker-vps-deploy.md) — `docker`, `github actions`, `nginx`, `vps`, `watchtower`
- [`shared/vps-maintenance.md`](shared/vps-maintenance.md) — `docker`, `vps`
- [`shared/github-pages-pwa.md`](shared/github-pages-pwa.md) — `html`
- [`shared/trello-dropbox-pipeline.md`](shared/trello-dropbox-pipeline.md) — `python`

## Частые команды

```bash
docker compose up -d
docker compose logs -f app
docker compose pull && docker compose up -d
```

## Файлы wiki

- [`geocore/geocore-overview.md`](geocore/geocore-overview.md) — GeoCore — Overview
- [`geocore/geocore-stack.md`](geocore/geocore-stack.md) — GeoCore — Tech Stack
- [`geocore/geocore.md`](geocore/geocore.md) — geocore
- [`geocore/geocore-tasks.md`](geocore/geocore-tasks.md) — GeoCore — Tasks

## Инструкции для Claude

- Сверяйся с wiki и shared/ файлами перед изменениями.
- Новые гочи и решения — проси добавить в проектную wiki.
