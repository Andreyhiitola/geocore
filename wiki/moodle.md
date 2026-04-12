# Moodle

## Версия и доступ

- Текущая версия: **5.1.3**
- URL: https://courses.geocore-academy.ru
- Admin: логин в `.env` (MOODLE_ADMIN_USER / MOODLE_ADMIN_PASS)
- Пользователь Konstantin — роль Менеджер

## Установка и конфигурация

- Dockerfile: `moodle/Dockerfile` — универсальный для 4.x и 5.x, загрузка через tarball
- Entrypoint: `moodle/entrypoint.sh` — автоустановка, автообновление (upgrade.php), генерация config.php
- config.php генерируется **из переменных окружения** при старте контейнера
- `sslproxy = true` включается автоматически когда WWWROOT начинается с `https://`

## Тема

- Кастомная тёмная тема: `moodle/theme/geocore/`
- Активируется автоматически при первом старте
- Содержит исправленный `loginform.mustache` (убрана обёртка `{{#cookiesenabled}}`)

## Web Services (API для курсов)

- REST API включён, сервис: GeoCore API
- Токен: `MOODLE_TOKEN` в `.env` на VPS
- FastAPI тянет курсы через `core_course_get_courses`
- URL: `/webservice/rest/` (не /webservices/ — опечатка была зафиксирована)

## Курсы

| ID | Название | SCORM |
|----|----------|-------|
| 10 | Паспортизация геологоразведочных проектов | ✅ |
| 11 | Leapfrog Viewer для руководителей | ✅ |

- `moodleCourseOrder` в `site.json` определяет порядок отображения: `[11, 10]`
- `moodleMeta` в `site.json` — иконка и тег для каждого курса

## Обновление Moodle

```
1. Меняешь MOODLE_VERSION в docker-compose.test.yml
2. docker compose -f docker-compose.test.yml down -v && up --build
3. Проверяешь localhost:8081
4. Если OK → меняешь MOODLE_VERSION в .github/workflows/deploy.yml
5. git commit && git push → автодеплой
⚠️ Данные сохраняются через volumes (upgrade.php обновляет только схему)
⚠️ НЕ делать down -v на production
```

## Что отложено

- Саморегистрация студентов — не приоритет
- SCORM редизайн (Leapfrog_geocore_v3.zip) — готов, нужно протестировать

## Связанные разделы

- [[problems]] — ERR_TOO_MANY_REDIRECTS, cookies, docker cp
- [[decisions]] — почему Moodle не трогаем
- [[infrastructure]] — Docker volumes, CI/CD
