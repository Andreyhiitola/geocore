# GeoCore Academy
**Сайт:** https://andreyhiitola.github.io/geocore/

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Three.js](https://img.shields.io/badge/Three.js-r128-green)](https://threejs.org/)
[![Docker](https://img.shields.io/badge/Docker-20.10+-blue)](https://docker.com)

Образовательная платформа по оценке месторождений. Включает:
- 3D-песочницу для визуализации скважин и блочных моделей
- Лабораторию данных для подготовки файлов для Datamine
- Moodle для онлайн-курсов и SCORM-пакетов
- FastAPI бэкенд для обработки геоданных

**Сайт:** https://andreyhiitola.github.io/geocore/

---

## 🖥️ Статический фронтенд (песочница)

### Структура проекта
geocore/
├── index.html ← главная страница (только разметка + CSS)
├── script.js ← весь JavaScript (ES-модуль)
├── articles/ ← статьи блога
├── data/
│ ├── gold_demo.csv ← демо-данные: золото (Au), 12 скважин
│ ├── copper_demo.csv ← демо-данные: медь (Cu), 10 скважин
│ ├── coal_demo.csv ← демо-данные: уголь (Coal_m), 13 скважин
│ └── ore_body.obj ← 3D-каркас рудного тела (Wavefront OBJ)
└── README.md

text

### Локальный запуск фронтенда

```bash
cd geocore
python3 -m http.server 8080
# Открыть http://localhost:8080
Форматы файлов
CSV (скважины)
text
HoleID,From,To,Au_gpt
Au-01,0,2,0.8
Au-01,2,4,1.2
Поддерживаются поля: Au_gpt, Cu_pct, Coal_m

OBJ (каркас рудного тела)
Стандартный Wavefront OBJ: вершины (v) и грани (f).

Функции песочницы
Загрузка CSV и OBJ

Три шаблона: Золото, Медь, Уголь

Блочная модель: IDW, Kriging, Nearest Neighbour

Классификация JORC: Measured / Indicated / Inferred

Экспериментальная вариограмма

Экспорт: CSV блоков + .mac скрипт для Datamine

🐳 Docker-стек (Moodle + FastAPI)
Требования
Docker 20.10+

Docker Compose 2.0+

2 GB RAM (рекомендуется 4 GB)

Быстрый запуск
bash
git clone https://github.com/Andreyhiitola/geocore.git
cd geocore
cp .env.example .env
# Отредактируйте .env (пароли базы данных)
docker compose up -d
Доступ
Moodle: http://localhost:8080

API: http://localhost:8000/health

Первый вход в Moodle
Логин: admin

Пароль: указан в .env (MOODLE_ADMIN_PASSWORD)

Docker образы
Образ Moodle доступен на Docker Hub:

bash
docker pull andreysagurov/geocore-moodle:latest
Структура Docker-проекта
text
geocore/
├── docker-compose.yml
├── .env.example
├── moodle/
│   ├── Dockerfile
│   └── php.ini
├── backend/
│   └── Dockerfile
└── README.md
🔧 Переменные окружения
Создайте .env из .env.example:

env
DB_ROOT_PASSWORD=your_root_password
DB_PASSWORD=your_db_password
MOODLE_ADMIN_PASSWORD=your_admin_password
📦 Перенос на другой VPS
Способ 1: Через Docker Hub (рекомендуется)
bash
git clone https://github.com/Andreyhiitola/geocore.git
cd geocore
docker compose up -d
Способ 2: Через файлы
bash
# Сохраните образ
docker save geocore-moodle:latest -o geocore-moodle.tar
# Скопируйте на новый VPS
scp geocore-moodle.tar root@новый_vps:/opt/
# Загрузите
docker load -i /opt/geocore-moodle.tar
Чек-лист для переноса
Что переносить	Как
Код	git clone
Docker-образ	Docker Hub или docker save
Конфигурация	docker-compose.yml, .env
База данных	docker exec geocore_db mysqldump -u root -p moodle > moodle.sql
Файлы Moodle	docker cp geocore_moodle:/var/moodledata ./moodledata_backup
🛠️ Технологии
Компонент	Технология
3D-графика	Three.js r128
Бэкенд	FastAPI (Python 3.11)
LMS	Moodle 5.2beta
База данных	MariaDB 10.11
Контейнеризация	Docker + Docker Compose
Фронтенд (статический)	GitHub Pages
📄 Зависимости (CDN)
Three.js r128

IBM Plex fonts (Google Fonts)

📄 Лицензия
MIT
EOF

text

---

## ✅ Проверьте

```bash
cat README.md | head -30
