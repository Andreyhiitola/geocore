FROM php:8.3-apache

ARG MOODLE_VERSION=5.1.2

# System dependencies + PHP extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl zip unzip \
    libicu-dev libzip-dev libpng-dev libxml2-dev \
    default-mysql-client \
    && docker-php-ext-install intl mysqli zip gd xml soap opcache \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN a2enmod rewrite

# Download Moodle (specific version tag)
RUN git clone --depth 1 --branch v${MOODLE_VERSION} \
    https://github.com/moodle/moodle.git /var/www/moodle \
    && mkdir -p /var/moodledata \
    && chown -R www-data:www-data /var/www/moodle /var/moodledata

# Apache VirtualHost: Moodle 5.x uses /public subdir as DocumentRoot
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
