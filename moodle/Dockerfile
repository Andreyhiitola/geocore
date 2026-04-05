FROM php:8.3-apache

RUN apt-get update && apt-get install -y \
    git zip unzip libicu-dev libzip-dev libpng-dev libxml2-dev \
    && docker-php-ext-install intl mysqli zip gd xml soap

RUN a2enmod rewrite

RUN git clone --depth 1 https://github.com/moodle/moodle.git /var/www/moodle \
    && mkdir -p /var/moodledata \
    && chown -R www-data:www-data /var/www/moodle /var/moodledata \
    && chmod -R 755 /var/www/moodle /var/moodledata

RUN echo "DocumentRoot /var/www/moodle" > /etc/apache2/sites-available/000-default.conf

EXPOSE 80
