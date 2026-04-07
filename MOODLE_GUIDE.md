# Руководство по управлению Moodle в GeoCore Academy

---

## Структура окружений

| Окружение | Файл | Порт | Назначение |
|-----------|------|------|------------|
| Тест | `docker-compose.test.yml` | 8081 | Проверка новых версий локально |
| Прод | `docker-compose.yml` | 8080 (за nginx) | Рабочий сервер на VPS |

---

## Как проверить версию Moodle

**В браузере** (войти как admin):
```
Администрирование → Сервер → Информация о системе
```

**Через терминал:**
```bash
# В тестовом контейнере
docker exec geocore_moodle_test cat /var/www/moodle/version.php | grep release

# В продовом контейнере
docker exec geocore_moodle cat /var/www/moodle/version.php | grep release
```

---

## Как отслеживать новые релизы Moodle

- Страница релизов: https://moodlerelease.org
- GitHub теги: https://github.com/moodle/moodle/tags

Нас интересуют теги вида `v5.1.3`, `v5.1.4`, `v5.2.0` — ветка **5.x стабильная**.

**Подписаться на уведомления GitHub:**
Открыть https://github.com/moodle/moodle → **Watch → Custom → Releases** — получать письмо при каждом новом теге.

---

## Алгоритм тестирования новой версии перед деплоем в прод

```
Вышел новый тег (например v5.1.4)
         ↓
Шаг 1 — Обновляем версию в тестовом окружении
         ↓
Шаг 2 — Запускаем тест локально
         ↓
Шаг 3 — Проверяем что всё работает
         ↓
Шаг 4 — Если ОК, обновляем прод
```

### Шаг 1 — Меняем версию в тесте

В файле `docker-compose.test.yml` найти и изменить:
```yaml
MOODLE_TEST_VERSION: 5.1.4   # ← новая версия
```

### Шаг 2 — Запускаем тест

```bash
cd ~/Desktop/geocore

# Сносим старые данные (обязательно при смене версии!)
docker compose -f docker-compose.test.yml down -v

# Собираем и запускаем
docker compose -f docker-compose.test.yml up --build
```

Установка займёт ~5 минут. Ждём сообщения:
```
==> Moodle успешно установлен!
==> Запускаем Apache...
```

### Шаг 3 — Проверяем

Открыть в браузере: **http://localhost:8081**

Чеклист проверки:
- [ ] Страница входа открывается
- [ ] Вход работает (admin / Admin1234!)
- [ ] Курсы отображаются
- [ ] Нет ошибок в логах: `docker logs geocore_moodle_test`

### Шаг 4 — Деплоим в прод

Если тест прошёл успешно — обновляем версию в двух файлах:

**`.github/workflows/deploy.yml`** — строка:
```yaml
MOODLE_VERSION: '5.1.4'
```

**`.env.example`** — строка:
```
MOODLE_VERSION=5.1.4
```

Затем коммит и пуш:
```bash
git add .github/workflows/deploy.yml .env.example
git commit -m "feat: обновление Moodle до версии 5.1.4"
git push
```

GitHub Actions автоматически соберёт новый образ и задеплоит на VPS.

---

## Тегирование образов на Docker Hub

Репозиторий: `andreysagurov/geocore-moodle`

### Схема тегов

| Тег | Пример | Смысл |
|-----|--------|-------|
| `{версия_moodle}` | `5.1.3` | Базовая версия Moodle |
| `{версия_moodle}-r{N}` | `5.1.3-r1` | Moodle + N-я ревизия наших правок |
| `latest` | `latest` | Всегда последний актуальный образ |

### Текущее состояние

```
5.1.3 = 5.1.3-r1 = latest
```

Все три тега указывают на один образ. Это нормально — `latest` всегда совпадает с последней ревизией.

### Когда создавать новую ревизию

При любых изменениях в `moodle/` (entrypoint, тема, php.ini) без обновления версии Moodle:

```bash
# На VPS после git pull
docker build -t andreysagurov/geocore-moodle:5.1.3 \
             -t andreysagurov/geocore-moodle:5.1.3-r2 \
             -t andreysagurov/geocore-moodle:latest \
             /opt/geocore/moodle/

docker push andreysagurov/geocore-moodle:5.1.3
docker push andreysagurov/geocore-moodle:5.1.3-r2
docker push andreysagurov/geocore-moodle:latest
```

### Откат к предыдущей ревизии

Если после обновления что-то сломалось — откатиться к предыдущей ревизии:

```bash
# В docker-compose.yml временно поменять тег
image: andreysagurov/geocore-moodle:5.1.3-r1

# Перезапустить
docker compose pull moodle
docker compose up -d moodle
```

---

## Быстрые команды

```bash
# Запустить тест
docker compose -f docker-compose.test.yml up --build

# Остановить тест (сохранить данные)
docker compose -f docker-compose.test.yml down

# Остановить тест и удалить все данные
docker compose -f docker-compose.test.yml down -v

# Логи Moodle
docker logs geocore_moodle_test

# Логи БД
docker logs geocore_db_test

# Зайти внутрь контейнера Moodle
docker exec -it geocore_moodle_test bash

# Статус всех контейнеров
docker ps
```

---

## Важные замечания

> **При смене версии Moodle всегда делать `down -v`** — старая схема БД несовместима с новой версией и Moodle не запустится.

> **Пароль админа в тесте:** `Admin1234!` — захардкожен в `docker-compose.test.yml`, не менять.

> **Секреты не коммитить** — файлы `.env`, `.env.prod`, `.env.test` в `.gitignore`. На VPS создаётся вручную из `.env.example`.
