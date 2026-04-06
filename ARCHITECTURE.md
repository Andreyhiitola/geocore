
Ты абсолютно прав! Это полная архитектура проекта, которую мы должны сохранить как эталон. Даже если сейчас мы упростили локальную разработку, для продакшена на VPS нам понадобятся все эти компоненты.

📁 Сохраняем как ARCHITECTURE.md
bash
cat > ARCHITECTURE.md << 'EOF'
# Архитектура GeoCore Academy

## 📁 Полная структура проекта
geocore/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── docker-compose.test.yml
├── README.md
├── ARCHITECTURE.md
├── nginx/
│ └── geocore.conf
├── moodle/
│ ├── Dockerfile
│ └── php.ini
├── backend/
│ ├── Dockerfile
│ ├── requirements.txt
│ ├── main.py
│ └── processing/
│ └── init.py
├── frontend/ # статика (опционально)
└── .github/
└── workflows/
└── deploy.yml

text

---

## 🐳 Docker Compose (production)

```yaml
version: '3.8'

services:
  mariadb:
    image: mariadb:10.11
    container_name: geocore_db
    restart: unless-stopped
    volumes:
      - ./mariadb_data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: moodle
      MYSQL_USER: ${MOODLE_DB_USER}
      MYSQL_PASSWORD: ${MOODLE_DB_PASSWORD}
    networks:
      - geocore_net

  moodle:
    build: ./moodle
    container_name: geocore_moodle
    restart: unless-stopped
    depends_on:
      - mariadb
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./moodle_data:/bitnami/moodle
      - ./moodledata_data:/bitnami/moodledata
    environment:
      - MOODLE_DATABASE_HOST=${MOODLE_DB_HOST}
      - MOODLE_DATABASE_NAME=${MOODLE_DB_NAME}
      - MOODLE_DATABASE_USER=${MOODLE_DB_USER}
      - MOODLE_DATABASE_PASSWORD=${MOODLE_DB_PASSWORD}
      - MOODLE_DATABASE_ROOT_PASSWORD=${DB_ROOT_PASSWORD}
      - MOODLE_WWWROOT=${MOODLE_WWWROOT}
      - MOODLE_SITE_NAME=${MOODLE_SITE_NAME}
      - MOODLE_LANG=${MOODLE_LANG}
      - MOODLE_USERNAME=${MOODLE_ADMIN_USER}
      - MOODLE_PASSWORD=${MOODLE_ADMIN_PASS}
      - MOODLE_EMAIL=${MOODLE_ADMIN_EMAIL}
    networks:
      - geocore_net
    labels:
      - "com.centurylinklabs.watchtower.enable=true"

  backend:
    build: ./backend
    container_name: geocore_api
    restart: unless-stopped
    depends_on:
      - mariadb
    ports:
      - "127.0.0.1:8000:8000"
    environment:
      - DATABASE_URL=mysql://${MOODLE_DB_USER}:${MOODLE_DB_PASSWORD}@${MOODLE_DB_HOST}/geocore_api
      - SECRET_KEY=${API_SECRET_KEY}
    networks:
      - geocore_net
    labels:
      - "com.centurylinklabs.watchtower.enable=true"

  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      WATCHTOWER_CLEANUP: "true"
      WATCHTOWER_INTERVAL: 3600
    command: --label-enable
    networks:
      - geocore_net

networks:
  geocore_net:
    driver: bridge
🧪 Docker Compose (тестовый)
yaml
version: '3.8'

services:
  mariadb-test:
    image: mariadb:10.11
    container_name: geocore_db_test
    environment:
      MYSQL_ROOT_PASSWORD: testpass
      MYSQL_DATABASE: moodletest
    ports:
      - "3307:3306"
    networks:
      - test_net

  moodle-test:
    build: ./moodle
    container_name: geocore_moodle_test
    ports:
      - "8081:8080"
    environment:
      MOODLE_DATABASE_HOST: mariadb-test
      MOODLE_DATABASE_NAME: moodletest
      MOODLE_DATABASE_USER: root
      MOODLE_DATABASE_PASSWORD: testpass
      MOODLE_WWWROOT: "http://localhost:8081"
    depends_on:
      - mariadb-test
    networks:
      - test_net

  backend-test:
    build: ./backend
    container_name: geocore_api_test
    ports:
      - "8001:8000"
    environment:
      DATABASE_URL: mysql://root:testpass@mariadb-test/testdb
    depends_on:
      - mariadb-test
    networks:
      - test_net

networks:
  test_net:
    driver: bridge
🌐 Nginx конфигурация (VPS)
nginx
# HTTP → HTTPS
server {
    listen 80;
    server_name courses.geocore-academy.ru api.geocore-academy.ru;
    return 301 https://$server_name$request_uri;
}

# Moodle
server {
    listen 443 ssl http2;
    server_name courses.geocore-academy.ru;

    ssl_certificate /etc/letsencrypt/live/courses.geocore-academy.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/courses.geocore-academy.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 100M;
}

# API
server {
    listen 443 ssl http2;
    server_name api.geocore-academy.ru;

    ssl_certificate /etc/letsencrypt/live/api.geocore-academy.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.geocore-academy.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
🐳 Moodle Dockerfile
dockerfile
FROM bitnami/moodle:4.5.0

USER root

COPY php.ini /opt/bitnami/php/etc/conf.d/custom.ini

RUN chmod 644 /opt/bitnami/php/etc/conf.d/custom.ini

USER 1001
⚙️ php.ini
ini
memory_limit = 512M
upload_max_filesize = 100M
post_max_size = 110M
max_execution_time = 300
max_input_vars = 5000
🐍 Backend Dockerfile
dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
📦 Backend requirements.txt
txt
fastapi==0.115.0
uvicorn[standard]==0.30.0
sqlalchemy==2.0.35
pymysql==1.1.0
python-dotenv==1.0.0
🚀 Backend main.py
python
from fastapi import FastAPI

app = FastAPI(title="GeoCore API", version="1.0.0")

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/")
async def root():
    return {"message": "GeoCore API is running"}
🔐 .env.example
env
# Database
DB_ROOT_PASSWORD=change_me
MOODLE_DB_HOST=mariadb
MOODLE_DB_NAME=moodle
MOODLE_DB_USER=moodle
MOODLE_DB_PASSWORD=change_me

# Moodle settings
MOODLE_WWWROOT=https://courses.geocore-academy.ru
MOODLE_SITE_NAME=GeoCore Academy
MOODLE_SITE_SHORTNAME=geocore
MOODLE_LANG=ru

# Moodle Admin
MOODLE_ADMIN_USER=admin
MOODLE_ADMIN_PASS=change_me
MOODLE_ADMIN_EMAIL=admin@geocore-academy.ru

# PHP settings
PHP_MEMORY_LIMIT=512M
PHP_UPLOAD_MAX_FILESIZE=100M
PHP_POST_MAX_SIZE=110M
PHP_MAX_EXECUTION_TIME=300
PHP_MAX_INPUT_VARS=5000

# API
API_SECRET_KEY=change_me
🚀 CI/CD (GitHub Actions)
yaml
name: Deploy to VPS

on:
  push:
    branches: [ main ]
    tags: [ 'v*' ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Copy files to VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          source: "."
          target: "/opt/geocore"
          strip_components: 0

      - name: Deploy containers
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/geocore
            cp .env.example .env || true
            docker compose down
            docker compose pull
            docker compose up -d
