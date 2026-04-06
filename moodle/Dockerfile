FROM php:8.3-apache

ARG MOODLE_VERSION=5.1.2

# Системные зависимости и PHP-расширения
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl zip unzip \
    libicu-dev libzip-dev libpng-dev libxml2-dev \
    default-mysql-client \
    && docker-php-ext-install intl mysqli zip gd xml soap opcache \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Включаем модуль mod_rewrite для .htaccess
RUN a2enmod rewrite

# Клонируем конкретный тег Moodle (shallow clone — только последний коммит)
RUN git clone --depth 1 --branch v${MOODLE_VERSION} \
    https://github.com/moodle/moodle.git /var/www/moodle \
    && mkdir -p /var/moodledata \
    && chown -R www-data:www-data /var/www/moodle /var/moodledata

# Настройка Apache VirtualHost
# Moodle 5.x использует /public как DocumentRoot, в 4.x — корень
RUN MAJOR=$(echo "${MOODLE_VERSION}" | cut -d. -f1) && \
    if [ "${MAJOR}" -ge "5" ]; then \
        DOCROOT="/var/www/moodle/public"; \
    else \
        DOCROOT="/var/www/moodle"; \
    fi && \
    printf '<VirtualHost *:80>\n\tDocumentRoot %s\n\t<Directory %s>\n\t\tOptions FollowSymLinks\n\t\tAllowOverride All\n\t\tRequire all granted\n\t</Directory>\n\tErrorLog ${APACHE_LOG_DIR}/error.log\n\tCustomLog ${APACHE_LOG_DIR}/access.log combined\n</VirtualHost>\n' \
        "${DOCROOT}" "${DOCROOT}" > /etc/apache2/sites-available/000-default.conf && \
    echo "ServerName localhost" >> /etc/apache2/apache2.conf

COPY php.ini /usr/local/etc/php/conf.d/moodle.ini
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
