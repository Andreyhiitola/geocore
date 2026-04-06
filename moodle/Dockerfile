FROM php:8.3-apache

ARG MOODLE_VERSION=5.1.3

# Системные зависимости и PHP-расширения
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl zip unzip \
    libicu-dev libzip-dev libpng-dev libxml2-dev \
    default-mysql-client \
    && docker-php-ext-install intl mysqli zip gd xml soap opcache \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Включаем mod_rewrite для .htaccess Moodle
RUN a2enmod rewrite

# Скачиваем Moodle как тарбол с GitHub (надёжнее чем git clone)
RUN curl -fsSL https://github.com/moodle/moodle/archive/refs/tags/v${MOODLE_VERSION}.tar.gz \
    | tar xz -C /var/www \
    && mv /var/www/moodle-${MOODLE_VERSION} /var/www/moodle \
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

# Копируем кастомную тему GeoCore Academy
# В Moodle 5.x темы живут в public/theme/, в 4.x — в theme/
COPY theme/geocore /tmp/geocore_theme
RUN MAJOR=$(echo "${MOODLE_VERSION}" | cut -d. -f1) && \
    if [ "${MAJOR}" -ge "5" ]; then \
        THEME_DIR="/var/www/moodle/public/theme/geocore"; \
    else \
        THEME_DIR="/var/www/moodle/theme/geocore"; \
    fi && \
    cp -r /tmp/geocore_theme "${THEME_DIR}" && \
    chown -R www-data:www-data "${THEME_DIR}" && \
    rm -rf /tmp/geocore_theme

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

# start-period=600s — даём время на установку Moodle при первом запуске (~5 мин)
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
