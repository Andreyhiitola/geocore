# Frontend

## Страницы

| Файл | Назначение |
|------|-----------|
| `index.html` | Главная — курсы, stats-strip, форма заявки |
| `courses.html` | Все курсы — использует siteRenderer.js |
| `lab.html` | Лаборатория данных (инструмент подготовки данных) |
| `sandbox.html` | 3D песочница |

## Архитектура данных

**`frontend/js/data/site.json`** — единый источник правды:
- `nav` — навигация (все страницы)
- `courses` — плановые курсы "В разработке"
- `moodleCourseOrder` — порядок курсов из Moodle `[11, 10]`
- `moodleMeta` — иконка и тег для каждого Moodle-курса
- `footer` — данные футера

**`frontend/js/data/siteRenderer.js`** — рендеринг:
- Загружает курсы из `GET /api/courses` (FastAPI → Moodle)
- Fallback на `site.json` если API недоступен
- Параметры `showPlanned`, `showSoon` — управление видимостью типов курсов

## Трёхуровневая система карточек курсов

```
ОТКРЫТ     — курсы из Moodle с SCORM, кликабельные, первые в сетке
СКОРО      — Moodle-курсы без SCORM, некликабельные
В РАЗРАБОТКЕ — из site.json, блёклые
```

## Дизайн-система

CSS-переменные в каждом HTML-файле:
- `--gold: #C9A84C` — основной акцент
- `--dark: #0A0A0B` — фон
- Шрифты: IBM Plex Sans (текст), IBM Plex Mono (метки), Playfair Display (заголовки)
- Поддержка light/dark темы через `body.light`

## Деплой

Frontend деплоится как статика в контейнере `geocore_frontend` (nginx:alpine).
CI/CD пересобирает только при изменениях в `frontend/`.

## Связанные разделы

- [[backend]] — API `/api/courses` который тянет данные
- [[decisions]] — почему site.json + siteRenderer
