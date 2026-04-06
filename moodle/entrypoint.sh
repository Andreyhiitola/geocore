#!/bin/bash
set -e

MOODLE_ROOT="/var/www/moodle"
MOODLE_DATA="/var/moodledata"
DB_HOST="${MOODLE_DB_HOST:-mariadb}"
DB_NAME="${MOODLE_DB_NAME:-moodle}"
DB_USER="${MOODLE_DB_USER:-moodle}"
DB_PASS="${MOODLE_DB_PASSWORD}"
WWWROOT="${MOODLE_WWWROOT:-http://localhost}"

# --- Генерируем config.php из переменных окружения ---
# config.php не хранится в git — создаётся при каждом старте контейнера
echo "==> Генерируем config.php (wwwroot=${WWWROOT})..."
cat > "${MOODLE_ROOT}/config.php" << PHPEOF
<?php
global \$CFG;
\$CFG = new stdClass();
\$CFG->dbtype    = 'mariadb';
\$CFG->dbhost    = '${DB_HOST}';
\$CFG->dbname    = '${DB_NAME}';
\$CFG->dbuser    = '${DB_USER}';
\$CFG->dbpass    = '${DB_PASS}';
\$CFG->prefix    = 'mdl_';
\$CFG->wwwroot   = '${WWWROOT}';
\$CFG->dataroot  = '${MOODLE_DATA}';
\$CFG->directorypermissions = 0777;
require_once(__DIR__ . '/lib/setup.php');
PHPEOF
chown www-data:www-data "${MOODLE_ROOT}/config.php"

# --- Ждём, пока БД поднимется ---
# Используем mysqladmin ping — не требует авторизации, просто проверяет доступность сервера
echo "==> Ожидаем MariaDB на ${DB_HOST}..."
until mysqladmin ping -h"${DB_HOST}" --silent --skip-ssl 2>/dev/null; do
    echo "   БД ещё не готова, повтор через 3 сек..."
    sleep 3
done
# Дополнительная пауза — MariaDB создаёт пользователей после старта
echo "==> Сервер отвечает, ждём инициализации пользователей..."
sleep 8
echo "==> БД готова."

# --- Установка или обновление Moodle ---
if [ ! -f "${MOODLE_DATA}/.installed" ]; then
    # Первый запуск — полная установка
    echo "==> Запускаем CLI-установщик Moodle (~5 минут)..."
    su -s /bin/bash www-data -c "php ${MOODLE_ROOT}/admin/cli/install_database.php \
        --lang=${MOODLE_LANG:-ru} \
        --adminuser=${MOODLE_ADMIN_USER:-admin} \
        --adminpass='${MOODLE_ADMIN_PASS}' \
        --adminemail='${MOODLE_ADMIN_EMAIL:-admin@localhost}' \
        --fullname='${MOODLE_SITE_NAME:-GeoCore Academy}' \
        --shortname='${MOODLE_SITE_SHORTNAME:-geocore}' \
        --agree-license"
    touch "${MOODLE_DATA}/.installed"
    echo "==> Moodle успешно установлен!"
else
    # Повторный запуск — проверяем нужно ли обновление схемы БД
    echo "==> Moodle уже установлен, проверяем обновления БД..."
    su -s /bin/bash www-data -c "php ${MOODLE_ROOT}/admin/cli/upgrade.php --non-interactive" \
        && echo "==> БД актуальна." \
        || echo "==> Обновление БД выполнено."
fi

echo "==> Запускаем Apache..."
exec apache2-foreground
