# geocore-academy

> Контекст для Claude Code. Полная wiki: `wiki-vault/geocore-academy/`.

## Контекст

> Платформа онлайн-обучения геологов на базе Moodle.

## Стек

- Backend: Moodle (PHP) + FastAPI (Python) + MariaDB
- Frontend: Moodle UI
- Deployment: VPS + Docker Compose + Watchtower + Nginx + Let's Encrypt

## Deployment

См. также: [[shared/docker-vps-deploy]]

```bash
docker compose up -d
docker compose logs -f app
docker compose pull && docker compose up -d
```

Pipeline: git push → GitHub Actions → Docker Hub → Watchtower авто-обновляет

## Гочи

- MariaDB data в volume — не удалять при `docker compose down`
- MOODLE_WWWROOT должен совпадать с реальным URL, иначе редиректы ломаются
- `php.ini` memory_limit минимум 256M для SCORM-плееров

## Применимые знания из shared/

- [`shared/docker-vps-deploy.md`](shared/docker-vps-deploy.md) — `docker`, `github actions`, `nginx`, `vps`, `watchtower`
- [`shared/trello-dropbox-pipeline.md`](shared/trello-dropbox-pipeline.md) — `python`

## Частые команды

```bash
docker compose up -d
docker compose logs -f app
docker compose pull && docker compose up -d
```

## Файлы wiki

- [`geocore-academy/README.md`](geocore-academy/README.md) — GeoCore Academy

## Инструкции для Claude

- Сверяйся с wiki и shared/ файлами перед изменениями.
- Новые гочи и решения — проси добавить в проектную wiki.
