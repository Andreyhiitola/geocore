# Руководство по управлению Moodle в GeoCore-Academy

---

## Структура окружений

| Окружение | Файл | Порт | Назначение |
|-----------|------|------|------------|
| Тест | `docker-compose.test.yml` | **8082** | Проверка новых версий локально |
| Прод | `docker-compose.yml` | 8080 (за nginx) | Рабочий сервер на VPS |

> ⚠️ Порт 8081 занят `pelikan-bot` — тестовый Moodle всегда на **8082**.

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
docker logs geocore_moodle 2>&1 | grep -i "5\.\|версии\|обновление" | tail -5
docker inspect geocore_moodle --format='{{.Config.Image}}'
```

---

## Как отслеживать новые релизы Moodle

- GitHub теги: https://github.com/moodle/moodle/tags — ветка **MOODLE\_5\_1\_STABLE**

**Подписаться на уведомления:** https://github.com/moodle/moodle → **Watch → Custom → Releases**

---

## Алгоритм обновления Moodle

> **Обязательный порядок:** сначала локальный тест — только потом прод.  
> Менять `MOODLE_VERSION` в `deploy.yml` без пройденного локального теста запрещено.

### Шаг 1 — Локальный тест

```bash
cd ~/Desktop/geocore

# Сносим старые тестовые данные (⚠️ только тестовые — down -v на проде запрещён)
docker compose -f docker-compose.test.yml down -v

# Запускаем с новой версией
MOODLE_TEST_VERSION=5.1.4 docker compose -f docker-compose.test.yml up --build
```

Установка ~5 минут. Ждём в логах:
```
==> Moodle успешно установлен!
==> Запускаем Apache...
```

### Шаг 2 — Проверяем на localhost:8082

- [ ] Страница входа открывается
- [ ] Вход работает (`admin` / `Admin1234!`)
- [ ] Курсы отображаются
- [ ] Нет ошибок: `docker logs geocore_moodle_test`

### Шаг 3 — Деплой в прод (только после ✅ шага 2)

Меняем одну строку в `deploy.yml`:

```yaml
env:
  MOODLE_VERSION: '5.1.4'   # ← обновить здесь
```

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: обновление Moodle до 5.1.4"
git push
```

**CI/CD автоматически:**
1. Собирает образ `andreysagurov/geocore-moodle:5.1.4` (~10 мин)
2. Обновляет `MOODLE_VERSION` в `.env` на VPS
3. Перезапускает контейнер, `upgrade.php` мигрирует БД — данные сохраняются

### Шаг 4 — Проверяем прод

```bash
docker logs geocore_moodle 2>&1 | grep -i "обновление\|успешно" | tail -5
docker inspect geocore_moodle --format='{{.Config.Image}}'
```

---

## Откат

```bash
# На VPS: вернуть прошлую версию
sed -i 's/MOODLE_VERSION=5.1.4/MOODLE_VERSION=5.1.3/' /opt/geocore/.env
docker compose pull moodle && docker compose up -d moodle
```

Данные не теряются — схема БД совместима в пределах минорных версий.

---

## Тегирование образов на Docker Hub

Репозиторий: `andreysagurov/geocore-moodle`

| Тег | Пример | Смысл |
|-----|--------|-------|
| `{версия}` | `5.1.4` | Конкретная версия Moodle |
| `{версия}-r{N}` | `5.1.4-r1` | + N-я ревизия наших правок |

CI/CD собирает и пушит образ автоматически при изменении `moodle/` или `deploy.yml`.

**Ручная пересборка** (если нужно обновить entrypoint/тему без смены версии):

```bash
docker build -t andreysagurov/geocore-moodle:5.1.4 \
             -t andreysagurov/geocore-moodle:5.1.4-r2 \
             /opt/geocore/moodle/
docker push andreysagurov/geocore-moodle:5.1.4
docker push andreysagurov/geocore-moodle:5.1.4-r2
```

---

## Аккаунты студентов — создание через биллинг

После подтверждения оплаты в админке (`/frontend/admin.html`) система автоматически:
1. Создаёт учётные записи в Moodle через Web Services API
2. Зачисляет на курс (поиск по названию из заявки)
3. Отправляет логины/пароли клиенту на email

### Настройка Web Services токена (нужна для реальной интеграции)

1. **Администрирование → Плагины → Web services → Включить веб-сервисы**
2. **Управление протоколами → REST → Включить**
3. **Управление внешними сервисами → Добавить сервис**, добавить функции:
   - `core_user_create_users`
   - `enrol_manual_enrol_users`
   - `core_course_get_courses`
4. **Управление токенами → Создать токен** → скопировать в `.env`:
   ```
   MOODLE_TOKEN=<токен>
   ```

> Если `MOODLE_TOKEN` не задан — аккаунты не создаются, но статус оплаты, PDF и email-уведомление работают.

### Формат логинов и паролей

- Логин: `gc_{request_id}_{N}` (например `gc_5_1`, `gc_5_2`)
- Пароль: случайный 12-символьный (`aB3#kLm9xZ1!`)
- Срок доступа: `access_expiry_date` из заявки (по умолчанию +30 дней от оплаты)

### Поиск курса Moodle

Зачисление происходит на курс, `fullname` которого содержит название из заявки (без учёта регистра).  
Пример: заявка «Введение в геологию» → курс Moodle с `fullname` «Введение в геологию».

### Повторная отправка аккаунтов

В модальном окне заявки → кнопка **«Отправить клиенту ✉»**. Использовать если:
- Клиент не получил письмо (попало в спам)
- Первая отправка упала по ошибке SMTP

---

## Быстрые команды

```bash
# Тест: запустить с новой версией
MOODLE_TEST_VERSION=5.1.4 docker compose -f docker-compose.test.yml up --build

# Тест: остановить (сохранить данные)
docker compose -f docker-compose.test.yml down

# Тест: остановить и удалить данные (чистый старт)
docker compose -f docker-compose.test.yml down -v

# Логи тестового Moodle
docker logs geocore_moodle_test

# Логи продового Moodle
docker logs geocore_moodle --tail 50

# Зайти внутрь контейнера
docker exec -it geocore_moodle bash

# Статус контейнеров
docker ps
```

---

## Важные замечания

> **`down -v` — только тестовое окружение.** На проде эта команда уничтожит БД и moodledata без возможности восстановления (без бэкапа).

> **При смене major-версии** (5.1 → 5.2) — сначала бэкап через бота, потом тест.

> **Пароль тестового admin:** `Admin1234!` — захардкожен в `docker-compose.test.yml`.

> **Секреты не коммитить** — `.env` в `.gitignore`. На VPS создаётся из `.env.example`.
