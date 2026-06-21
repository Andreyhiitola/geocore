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

| ID | Название | Тип | Статус |
|----|----------|-----|--------|
| 10 | Паспортизация геологоразведочных проектов | SCORM | ✅ открыт |
| 11 | Leapfrog Viewer для руководителей | SCORM | ✅ открыт |
| 12 | Геологическое моделирование | CourseLab HTML | ✅ открыт |
| 16 | Геостатистика | CourseLab HTML | ✅ открыт |
| 17 | Комплексный кейс Тренажера | CourseLab HTML | ✅ открыт |
| 18 | Нейросети для прогнозирования | CourseLab HTML | ✅ открыт |
| 19 | Мат_методы анализа геохимии | CourseLab HTML | ✅ открыт |
| 20 | Тренажер поисков и разведки | CourseLab HTML | ✅ открыт |

- `moodleCourseOrder` в `site.json` — порядок и статус ОТКРЫТ: `[11, 10, 12, 16, 17, 18, 19, 20]`
- `moodleMeta` в `site.json` — иконка, тег, описание для каждого курса
- Метаданные курсов: `scripts/courses-meta.json`
- State {name → moodle_id}: `scripts/courses-state.json`

## SCORM-плеер: отдельное окно вместо встроенного

**Решение:** все 6 CourseLab SCORM-активностей переключены на `popup=1` (Display package = "New window") вместо `Current window`. Поле `mdl_scorm`: `width=98, height=100, options='scrollbars=0,directories=0,location=0,menubar=0,toolbar=0,status=0'`.

**Почему:** студенты жаловались, что плеер плохо использует экран; нативный Moodle popup (`mod/scorm/view.js`) открывает реальное окно верхнего уровня через `window.open()` — не iframe, поэтому никаких permissions-policy ограничений на Fullscreen API. `width=98` (не 100) специально оставляет небольшой отступ — на некоторых Linux-WM окно ровно в размер экрана теряет рамку/заголовок.

**Гоча:** Moodle переиспользует окно с фиксированным именем `"Popup"` — при повторном запуске активности браузер просто навигирует в уже открытое окно, не применяя новые `width/height`. Тестировать новые настройки только в новой инкогнито-сессии или с закрытыми старыми окнами.

**Гоча 2 — контент CourseLab выше экрана:** некоторые SCO (напр. «Комплексный кейс Тренажера») верстают слайды с фиксированной высотой пикселей, которая может быть больше реального экрана — нижний тулбар (Описание/Словарь/Помощь/Масштаб/Звук) уезжает за видимую область. Фикс — `moodle/theme/geocore/javascript/scorm-fullscreen.js`: тема тянется в `#scorm_object` iframe (он same-origin, см. `mod/scorm/module.js`) и масштабирует `<body>` SCO через `transform: scale()` под реальный размер iframe. Подробности реализации — в самом файле (там же объяснены все найденные грабли: `scrollHeight` врёт из-за `overflow:hidden` у CourseLab, нужен `getBoundingClientRect()`; ширину менять только в `px`, не в `%`, иначе reflow текста зацикливает пересчёт; SCO — это SPA на 30-50 слайдов в одной странице, высота отличается по слайдам, нужен периодический пересчёт, не разовый).

**Открытый вопрос:** на разных мониторах/разрешениях пользователь сообщил о разной картинке после деплоя фикса — не воспроизведено и не диагностировано, нужны скриншоты с обоих экранов в следующей сессии.

## Pipeline публикации CourseLab-курсов

```bash
./scripts/publish-courses.sh "/путь/к/Эл_курсы"  # --dry-run | --yes
```

Env подтягивается с VPS автоматически (`SSH_VPS=geocore`). После деплоя — добавить ID в `moodleCourseOrder` → `git push`.

⚠️ Курсы создаются с `visible=0` — включить в Moodle admin вручную.  
⚠️ Moodle `config.php`: `/var/www/moodle/config.php` (не `/var/www/html/`).

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

## Банк вопросов и тесты

### Конвертация тестов из DOCX/QTI → Moodle XML

Инструменты в `tools/` (в .gitignore, только локально):

| Скрипт | Назначение |
|--------|-----------|
| `tools/docx_to_moodle_xml.py` | DOCX → Moodle XML с картинками (base64) |
| `tools/qti_to_moodle_xml.py` | IMS QTI 1.2 → Moodle XML с картинками |

**Как конвертировать DOCX:**
1. Поменять `INPUT` и `OUTPUT` в начале скрипта
2. `python3 tools/docx_to_moodle_xml.py`
3. Импортировать `.xml` в Moodle: Банк вопросов → Импорт → **Moodle XML**

**Важно:**
- Правильные ответы в DOCX должны быть выделены цветом или цветным шрифтом
- GIFT формат не поддерживает картинки — использовать только Moodle XML
- Файлы для Moodle хранятся на Google Drive в папке `moodle_xml/` внутри каждого теста

### Файлы тестов на Google Drive

```
01_Пробный_итоговый_тест_1_семестр/
├── оригинал/       — исходный DOCX
├── moodle_xml/     — test_semester1.xml (25 вопросов, 4 с картинками)
└── _архив/         — старый GIFT файл

02_Тест_геологическое_моделирование_Datamine/
├── оригинал/       — исходный QTI архив
├── moodle_xml/     — test_datamine.xml (30 вопросов, 2 с картинками)
└── _архив/         — старые QTI файлы
```

### Создание теста из банка вопросов

1. Курс → Режим редактирования → Добавить элемент → **Тест**
2. Настроить: название, сроки, количество попыток, проходной балл
3. Тест → Вопросы → **Добавить → из банка вопросов**
4. Выбрать банк: **"Банк вопросов курса [название курса]"**
5. Выбрать все вопросы → добавить

**Проходной балл:** задаётся от максимальной оценки (не в процентах).
Например: максимум 25, проходной 60% → указать 15.

**Порядок вопросов:** в банке вопросы отсортированы по алфавиту — это нормально.
В тесте расставить вручную или включить перемешивание.

## Контроль доступа к курсам

- Студент зачисляется только на оплаченный курс (`enrol_manual_enrol_users`, `roleid=5`)
- Moodle автоматически блокирует доступ к незачисленным курсам — самозапись отключена
- Каталог (`/course/index.php`) виден залогиненному пользователю, но зайти в чужой курс нельзя
- Срок доступа: `timeend` в Moodle (Unix timestamp UTC) + `access_expiry_date` в БД `requests`
- Продление: `POST /api/admin/requests/{id}/extend-access?expiry_date=YYYY-MM-DD`
- Верифицировано на тестовой среде (2026-05-22): браузерная сессия подтвердила блокировку

⚠️ `calendar.timegm()` для конвертации даты в timestamp — `time.mktime()` использует локальное время сервера и даёт неверный результат.

## Что отложено

- Саморегистрация студентов — не приоритет
- SCORM редизайн (Leapfrog_geocore_v3.zip) — готов, нужно протестировать

## Связанные разделы

- [[problems]] — ERR_TOO_MANY_REDIRECTS, cookies, docker cp
- [[decisions]] — почему Moodle не трогаем
- [[infrastructure]] — Docker volumes, CI/CD
