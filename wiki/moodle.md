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

## Что отложено

- Саморегистрация студентов — не приоритет
- SCORM редизайн (Leapfrog_geocore_v3.zip) — готов, нужно протестировать

## Связанные разделы

- [[problems]] — ERR_TOO_MANY_REDIRECTS, cookies, docker cp
- [[decisions]] — почему Moodle не трогаем
- [[infrastructure]] — Docker volumes, CI/CD
