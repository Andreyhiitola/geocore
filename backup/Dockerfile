FROM alpine:3.19

RUN apk add --no-cache bash curl mariadb-client aws-cli

COPY scripts/backup.sh /scripts/backup.sh
COPY backup/entrypoint.sh /entrypoint.sh
RUN chmod +x /scripts/backup.sh /entrypoint.sh

RUN echo "0 2 * * * . /tmp/docker_env.sh && /scripts/backup.sh >> /var/log/backup.log 2>&1" \
    >> /etc/crontabs/root

CMD ["/entrypoint.sh"]
