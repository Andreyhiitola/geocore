FROM alpine:3.19

RUN apk add --no-cache bash curl mariadb-client aws-cli

COPY scripts/backup.sh /scripts/backup.sh
RUN chmod +x /scripts/backup.sh

RUN echo "0 2 * * * /scripts/backup.sh >> /var/log/backup.log 2>&1" \
    >> /etc/crontabs/root

CMD ["crond", "-f"]
