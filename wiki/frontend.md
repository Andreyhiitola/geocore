# Frontend

## Страницы

| Файл | Назначение |
|------|-----------|
| `index.html` | Главная — курсы, stats-strip, форма заявки |
| `courses.html` | Все курсы — использует siteRenderer.js |
| `lab.html` | Лаборатория данных (инструмент подготовки данных) |
| `sandbox.html` | 3D песочница ⚠️ сырые данные, скрыть из nav до готовности |

## Архитектура данных

**`frontend/js/data/site.json`** — единый источник правды:
- `nav` — навигация (все страницы)
- `courses` — 9 плановых направлений курсов (planned: true)
- `moodleCourseOrder` — порядок live-курсов из Moodle `[12,16,17,18,19,20]`
- `moodleMeta` — иконка, тег и modal-данные для каждого Moodle-курса
- `footer` — данные футера (description + columns)

**`frontend/js/data/siteRenderer.js`** — рендеринг:
- Загружает `site.json` через `fetch('./js/data/site.json')` (путь относительно `index.html`)
- Загружает live-курсы из `GET /api/courses` (FastAPI → Moodle)
- Fallback на `renderCourses([], [], planned)` если API недоступен
- Параметры `showPlanned`, `showSoon` — управление видимостью типов курсов

⚠️ **Локальная разработка:** `file://` блокирует ES-модули. Запускать через:
```bash
python3 -m http.server 8080 --directory frontend
```

## Трёхуровневая система карточек курсов

```
ОТКРЫТ     — курсы из Moodle с SCORM, кликабельные → модалка + «Записаться»
СКОРО      — Moodle-курсы без SCORM, кликабельные → модалка «запись откроется позже»
В РАЗРАБОТКЕ — из site.json, кликабельные → модалка «в разработке» + email
```

Все три типа используют одинаковую структуру `cardInner()` — одинаковый размер карточек.

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
