# GeoCore Academy — Журнал сессий

---

## 2026-04-07

### Что сделали
- Подняли Moodle на VPS — courses.geocore-academy.ru работает
- Исправили ERR_TOO_MANY_REDIRECTS (sslproxy в entrypoint.sh)
- Исправили "cookies отключены" (убрали {{#cookiesenabled}} из loginform.mustache)
- Настроили GitHub Actions CI/CD (5 секретов в GitHub)
- Запушили образы на Docker Hub (andreysagurov): geocore-moodle:5.1.3-r1, geocore-backend:latest, geocore-frontend:latest
- Создали пользователя Konstantin (роль Менеджер) в Moodle
- Подняли FastAPI — api.geocore-academy.ru работает
- Подняли Frontend — geocore-academy.ru работает
- Вынесли nav/курсы/футер в site.json + siteRenderer.js
- Курсы на главной теперь ссылаются на courses.geocore-academy.ru

### Решённые проблемы
- sslproxy: Moodle за nginx уходил в бесконечный редирект
- cookiesenabled: форма входа не рендерилась (Mustache видел false)
- docker cp не работает на этом VPS — обходить через tar pipe

### Отложено
- www.geocore-academy.ru (нет DNS записи, не приоритет)
- Саморегистрация студентов в Moodle
- Ветки для фич (работали прямо в main — допустимо для старта)

### Принятые решения
- nginx остаётся на хосте VPS (не в Docker) — проще для SSL
- Теги Docker: {версия}-r{N} для ревизий наших правок
- Docker Hub аккаунт: andreysagurov

---
