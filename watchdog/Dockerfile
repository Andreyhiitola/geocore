FROM alpine:3.19

# curl — HTTP-проверки, docker-cli — проверка контейнеров, bash — скрипт
RUN apk add --no-cache bash curl docker-cli

COPY scripts/healthcheck.sh /scripts/healthcheck.sh
RUN chmod +x /scripts/healthcheck.sh

# Запуск каждые 5 минут через busybox crond
RUN echo "*/5 * * * * /scripts/healthcheck.sh >> /var/log/healthcheck.log 2>&1" \
    >> /etc/crontabs/root

CMD ["crond", "-f"]
