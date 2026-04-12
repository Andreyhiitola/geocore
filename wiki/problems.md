# Решённые проблемы

> Первое место где искать при ошибке.
> Формат: симптом → причина → решение.

---

## ERR_TOO_MANY_REDIRECTS на Moodle

**Симптом:** Moodle за SSL-прокси уходит в бесконечный редирект.  
**Причина:** Moodle не знает что он за HTTPS-прокси и сам пытается редиректить на HTTPS.  
**Решение:** `$CFG->sslproxy = true` в `config.php`.  
**Где:** `moodle/entrypoint.sh` — генерируется автоматически когда `WWWROOT` начинается с `https://`.

---

## "Cookies отключены" на странице входа Moodle

**Симптом:** Форма входа не рендерится, показывает предупреждение про cookies.  
**Причина:** Шаблон `loginform.mustache` оборачивал форму в `{{#cookiesenabled}}`, но PHP никогда не передаёт это поле → форма не рендерилась.  
**Решение:** Убрать обёртку `{{#cookiesenabled}}` из шаблона.  
**Где:** `moodle/theme/geocore/` — кастомный шаблон.

---

## docker cp не работает на VPS

**Симптом:** `docker cp` зависает или выдаёт ошибку.  
**Причина:** Особенность конкретного VPS-провайдера.  
**Решение:** Использовать tar pipe:
```bash
tar -C ./local-dir -cf - . | docker exec -i container_name tar -C /container-path -xf -
```

---

## CI/CD не обновляет контейнер после push

**Симптом:** Образ пересобрался на Docker Hub, но на VPS работает старая версия.  
**Причина:** `docker compose up -d` не перетягивает новый образ если контейнер уже запущен.  
**Решение:** На VPS вручную:
```bash
docker compose pull && docker compose up -d
```
Или через `docker exec sed` + `docker restart` для точечного исправления без пересборки.

---

## Moodle Web Services: опечатка в URL

**Симптом:** `GET /api/courses` возвращает ошибку, Moodle не отвечает.  
**Причина:** Опечатка `/webservices/rest/` → правильно `/webservice/rest/` (без s).  
**Где:** `backend/main.py` — URL вызова Moodle API.

---

## Email: письма уходят от имени Gmail-адреса

**Симптом:** В поле From отображается `9624294@gmail.com` вместо `GeoCore Academy`.  
**Причина:** Gmail SMTP переписывает From на адрес авторизованного аккаунта.  
**Решение:** Явно указать `From: GeoCore Academy <9624294@gmail.com>` + `Reply-To: info@geocore-academy.ru`.  
**Где:** `backend/main.py` — функция отправки email.

---

## Связанные разделы

- [[moodle]] — детали по установке и конфигу
- [[infrastructure]] — Docker и CI/CD
- [[email]] — SMTP настройка
