FROM alpine:3.19

# mariadb-client — mysqldump, awscli — S3, bash — скрипт
RUN apk add --no-cache bash curl mariadb-client aws-cli

COPY scripts/backup.sh /scripts/backup.sh
RUN chmod +x /scripts/backup.sh

# Запуск каждый день в 02:00
RUN echo "0 2 * * * /scripts/backup.sh >> /var/log/backup.log 2>&1" \
    >> /etc/crontabs/root

CMD ["crond", "-f"]
