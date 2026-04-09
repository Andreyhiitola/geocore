# GeoCore Academy — Журнал сессий

---

## 2026-04-09 (сессия 3)

### Что сделали
- Ребрендинг SCORM Паспортизации завершён:
  - GRRRR05 — переписан текст про Полиметалл на общеотраслевую формулировку (Приказ Минприроды)
  - GRRRR14 — убрано «сотрудник АО Полиметалла», заменено на «главный геолог проекта»
  - GRRRR22 — убраны все упоминания Полиметалл УК и регламентов компании, выводы переписаны нейтрально
  - Добавлен логотип GeoCore Academy в навигационную панель (Logotip2.png)
- Ребрендинг SCORM Leapfrog: убран логотип Полиметалла с обложки (Logotip.png → прозрачный)
- Оба пакета обновлены на Google Drive (актуальная/), старые → _архив/
- Курсы в Moodle: Паспортизация id=10, Leapfrog id=11 (пересоздан, старый id=9 удалён)
- site.json обновлён: moodleCourseOrder [9,10] → [11,10]
- SCORM загружены в Moodle, курсы работают на сайте

### Отложено
- Удалить `_мусор/` на Google Drive после проверки
- Саморегистрация студентов в Moodle

---

## 2026-04-09 (сессия 2)

### Что сделали
- Добавлен курс Паспортизации (id=10) в Moodle со SCORM-пакетом
- Исправлен id Leapfrog Viewer: 8 → 9 в moodleCourseOrder
- Обнаружен ребрендинг Полиметала в SCORM Паспортизации (логотип на слайдах)
- Создан чеклист `SCORM_REBRANDING.md` для проверки всех новых SCORM-пакетов (в .gitignore)
- `courses.html` переписан — теперь использует siteRenderer.js (Moodle + site.json), убраны 12 хардкодных карточек
- Блок цен переработан: убраны все цифры, три формата без стоимости
- Футер: убраны эмодзи из контактов, убран WhatsApp
- `start_serverpython_9001.sh` исправлен — запускает сервер из `frontend/`

### Отложено
- Удалить `_мусор/` на Google Drive после проверки
- Саморегистрация студентов в Moodle

---

## 2026-04-09

### Что сделали
- Организовали Google Drive: создали структуру папок по курсам (01_Leapfrog, 02_Паспортизация, Документы, _мусор)
- Реализована трёхуровневая система карточек курсов:
  - **ОТКРЫТ** — SCORM-курсы из Moodle (moodleCourseOrder), кликабельные, первые в сетке
  - **СКОРО** — Moodle-курсы без SCORM, некликабельные
  - **В РАЗРАБОТКЕ** — планируемые из site.json, самые блёклые
- Добавлен `moodleMeta` в site.json для обогащения карточек иконкой и тегом
- Leapfrog Viewer (id=8) — в moodleCourseOrder, отображается как ОТКРЫТ

### Структура Google Drive (SCORM-папка)
```
01_Leapfrog_Viewer_для_руководителей/
   актуальная/  ← Leapfrog..._rebrend_v_2.zip
   _архив/      ← старые версии (до ребрендинга, v1)
02_Паспортизация_геологоразведочных/
   актуальная/  ← Паспортизация..._rebrend.zip
Документы/      ← чеклисты, шаблоны
_мусор/         ← временный отстойник
```

### Отложено
- Удалить `_мусор/` на Google Drive после проверки
- ID курса Паспортизации в Moodle → добавить в `moodleCourseOrder` в site.json
- Саморегистрация студентов в Moodle

---

## 2026-04-08

### Что сделали
- Разобрались с результатами предыдущей зависшей сессии (загрузка SCORM на Google Drive не завершилась)
- Проверили содержимое Drive-папки: Leapfrog загрузился с суффиксом `_v_2`, Паспортизация не загрузилась, остался мусорный `.tmp` файл
- Нашли актуальные версии SCORM-файлов на локальной машине:
  - `Leapfrog Viewer для руководителей_SORM_fixed_rebrend_v_2.zip` (310 MB, от 20:13)
  - `Паспортизация геологоразведочных проектов_fixed_rebrend.zip` (4.7 MB, от 21:01)
- Скопировали оба файла в `/home/andysag/Downloads/Новые переработанные файлыscorm _8_04_26/`

### Отложено
- Удалить с Google Drive: мусорный `.tmp` файл и `Leapfrog_SORM_fixed.zip` (старый без ребрендинга)
- Загрузить файлы из новой папки на Google Drive (предыдущая загрузка зависла)
- Карточки `site.json` — сделать полупрозрачными с меткой «Скоро»
- Саморегистрация студентов в Moodle

---

## 2026-04-07 (сессия 2)

### Что сделали
- Настроили Moodle Web Services: включили REST, создали сервис GeoCore API, выдали права пользователю API Service
- Получили токен `MOODLE_TOKEN` и прописали в `.env` на VPS
- Добавили эндпоинт `GET /api/courses` в FastAPI — тянет курсы из Moodle через `core_course_get_courses`
- Добавили `httpx` в `requirements.txt`
- Пробросили `MOODLE_URL` и `MOODLE_TOKEN` в backend через `docker-compose.yml`
- Обновили `siteRenderer.js` — загружает курсы из API с fallback на `site.json`
- Карточки курсов на главной стали кликабельными ссылками
- Создали 6 курсов в Moodle — они появились на главной странице

### Решённые проблемы
- Опечатка `/webservices/rest/` → `/webservice/rest/` в `backend/main.py`
- CI/CD не обновил контейнер — исправили через `docker exec sed` + `docker restart`

### Отложено
- Убрать дублирование карточек: сейчас показываются 6 из `site.json` + 6 из Moodle — нужно оставить только Moodle
- Саморегистрация студентов в Moodle
- www.geocore-academy.ru

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
