FROM nginx:alpine

COPY . /usr/share/nginx/html/

# Скрипт региональной подстановки — в штатный хук nginx:alpine, из веб-корня убрать.
COPY docker-entrypoint.d/10-region-config.sh /docker-entrypoint.d/10-region-config.sh
RUN chmod +x /docker-entrypoint.d/10-region-config.sh \
    && rm -rf /usr/share/nginx/html/docker-entrypoint.d \
              /usr/share/nginx/html/Dockerfile

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s \
    CMD wget -qO- http://localhost/ || exit 1
