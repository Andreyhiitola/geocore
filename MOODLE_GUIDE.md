# Moodle — руководство по обновлению и управлению

---

## Окружения

| Окружение | Файл | Порт | Назначение |
|-----------|------|------|------------|
| Тест | `docker-compose.test.yml` | **8082** | Проверка новых версий локально |
| Прод | `docker-compose.yml` | 8080 (за nginx) | VPS, geocore-academy.ru |

> ⚠️ Порт 8081 занят `pelikan-bot`. Тест всегда на **8082**.

---

## Алгоритм обновления Moodle

> **Обязательный порядок:** сначала локальный тест — только потом прод.  
> Менять `MOODLE_VERSION` в `deploy.yml` без пройденного локального теста запрещено.

### 1. Локальный тест новой версии

```bash
cd ~/Desktop/geocore

# Сносим старые тестовые данные (только тест — volumes с тестовыми данными)
docker compose -f docker-compose.test.yml down -v

# Собираем и запускаем с новой версией
MOODLE_TEST_VERSION=5.1.4 docker compose -f docker-compose.test.yml up --build
```

Установка ~5 минут. Ждём в логах:
```
==> Moodle успешно установлен!
==> Запускаем Apache...
```

### 2. Проверяем на localhost:8082

- [ ] Страница входа открывается
- [ ] Вход работает (`admin` / `Admin1234!`)
- [ ] Курсы отображаются
- [ ] Логи без ошибок: `docker logs geocore_moodle_test`

### 3. Деплой в прод (только после ✅ шага 2)

Меняем одну строку в `deploy.yml`:

```yaml
env:
  MOODLE_VERSION: '5.1.4'   # ← обновить здесь
```

Коммит и пуш:

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: обновление Moodle до 5.1.4"
git push
```

**CI/CD автоматически:**
1. Собирает образ `andreysagurov/geocore-moodle:5.1.4` (~10 мин)
2. Обновляет `MOODLE_VERSION` в `.env` на VPS
3. Делает `docker compose pull moodle && up -d moodle`
4. `upgrade.php` выполняется внутри контейнера — данные сохраняются

### 4. Проверяем на проде

```bash
# Версия в логах
docker logs geocore_moodle 2>&1 | grep -i "обновление\|успешно\|5.1"

# Какой образ запущен
docker inspect geocore_moodle --format='{{.Config.Image}}'
```

---

## Следить за релизами

- GitHub теги: https://github.com/moodle/moodle/tags — ветка **MOODLE\_5\_1\_STABLE**
- Подписаться: **Watch → Custom → Releases** на github.com/moodle/moodle

---

## Важные правила

> **`down -v` — только для тестового окружения.** Эта команда уничтожает volumes с данными.  
> На проде (`docker-compose.yml`) запускать `down -v` запрещено — потеря БД и moodledata невосстановима.

> **При смене major-версии** (например 5.1 → 5.2) — сначала сделать бэкап через бота, потом тест.

> **Пароль тестового admin:** `Admin1234!` — захардкожен в `docker-compose.test.yml`.

> **Секреты не коммитить** — `.env` в `.gitignore`. На VPS создаётся из `.env.example`.

---

## Быстрые команды

```bash
# Тест: запустить
MOODLE_TEST_VERSION=5.1.4 docker compose -f docker-compose.test.yml up --build

# Тест: остановить (сохранить данные)
docker compose -f docker-compose.test.yml down

# Тест: остановить и удалить данные (чистый старт)
docker compose -f docker-compose.test.yml down -v

# Логи тестового Moodle
docker logs geocore_moodle_test

# Логи продового Moodle
docker logs geocore_moodle --tail 50

# Версия запущенного образа
docker inspect geocore_moodle --format='{{.Config.Image}}'

# Зайти внутрь контейнера
docker exec -it geocore_moodle bash
```

---

## Откат

Если после обновления что-то сломалось — откатиться немедленно:

```bash
# На VPS: вернуть прошлую версию в .env
sed -i 's/MOODLE_VERSION=5.1.4/MOODLE_VERSION=5.1.3/' /opt/geocore/.env

# Перезапустить со старым образом (он уже есть на Docker Hub)
docker compose pull moodle
docker compose up -d moodle
```

Данные не теряются — `upgrade.php` не откатывается, но Moodle 5.1.3 нормально работает с обновлённой схемой.
