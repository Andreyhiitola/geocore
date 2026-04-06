#!/bin/bash
set -e

MOODLE_ROOT="/var/www/moodle"
MOODLE_DATA="/var/moodledata"
DB_HOST="${MOODLE_DB_HOST:-mariadb}"
DB_NAME="${MOODLE_DB_NAME:-moodle}"
DB_USER="${MOODLE_DB_USER:-moodle}"
DB_PASS="${MOODLE_DB_PASSWORD}"
WWWROOT="${MOODLE_WWWROOT:-http://localhost}"

# --- Generate config.php from environment variables ---
echo "==> Generating config.php (wwwroot=${WWWROOT})..."
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

# --- Wait for database ---
echo "==> Waiting for MariaDB at ${DB_HOST}..."
until mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" -e "SELECT 1" 2>/dev/null; do
    echo "   database not ready, retrying in 3s..."
    sleep 3
done
echo "==> Database is ready."

# --- First-time install ---
if [ ! -f "${MOODLE_DATA}/.installed" ]; then
    echo "==> Running Moodle CLI installer (this takes ~5 minutes)..."
    su -s /bin/bash www-data -c "php ${MOODLE_ROOT}/admin/cli/install_database.php \
        --lang=${MOODLE_LANG:-ru} \
        --adminuser=${MOODLE_ADMIN_USER:-admin} \
        --adminpass='${MOODLE_ADMIN_PASS}' \
        --adminemail='${MOODLE_ADMIN_EMAIL:-admin@localhost}' \
        --fullname='${MOODLE_SITE_NAME:-GeoCore Academy}' \
        --shortname='${MOODLE_SITE_SHORTNAME:-geocore}' \
        --agree-license"
    touch "${MOODLE_DATA}/.installed"
    echo "==> Moodle installed successfully!"
else
    echo "==> Moodle already installed, skipping installer."
fi

echo "==> Starting Apache..."
exec apache2-foreground
