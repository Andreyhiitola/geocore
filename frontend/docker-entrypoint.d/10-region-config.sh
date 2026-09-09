#!/bin/sh
# Региональная подстановка в статику при старте контейнера.
#
# Домен зашит в статику целиком (courses.*, api.*, mailto:*), поэтому одной
# заменой базового домена переключается весь регион. RU-продд ничего не задаёт
# и работает как раньше; KZ-зеркало передаёт SITE_DOMAIN через docker-compose.
#
# CONTACT_EMAIL — необязательный отдельный override, если почта живёт не на
# том же домене, что сайт.
set -e

DEFAULT_DOMAIN="geocore-academy.ru"
SITE_DOMAIN="${SITE_DOMAIN:-$DEFAULT_DOMAIN}"
ROOT="/usr/share/nginx/html"

subst() {
    find "$ROOT" -type f \
        \( -name '*.html' -o -name '*.js' -o -name '*.json' \) \
        -exec sed -i "s#$1#$2#g" {} +
}

if [ "$SITE_DOMAIN" != "$DEFAULT_DOMAIN" ]; then
    subst "${DEFAULT_DOMAIN}" "${SITE_DOMAIN}"
    echo "[region-config] domain -> ${SITE_DOMAIN}"
fi

if [ -n "$CONTACT_EMAIL" ] && [ "$CONTACT_EMAIL" != "info@${SITE_DOMAIN}" ]; then
    subst "info@${SITE_DOMAIN}" "${CONTACT_EMAIL}"
    echo "[region-config] contact email -> ${CONTACT_EMAIL}"
fi

# Рыночный текст (не домен) — на KZ-зеркале правим упоминания рынка/страны на
# сайте с дефолта "RU" на "KZ". Точные фразы, чтобы не задеть факт. упоминания
# вроде "ГКЗ (Россия)" в статьях про регуляторику.
if [ "$SITE_DOMAIN" != "$DEFAULT_DOMAIN" ]; then
    subst "Россия, СНГ и международный рынок" "Казахстан, СНГ и международный рынок"
    echo "[region-config] market text -> KZ"
fi

# Закон о персональных данных в privacy.html — РФ 152-ФЗ по умолчанию,
# на KZ-зеркале подменяется на закон РК №94-V. Домен в тексте закона уже
# заменён предыдущим subst (geocore-academy.ru -> .kz), эту фразу трогаем
# отдельно, т.к. номер и название закона не совпадают между юрисдикциями.
if [ "$SITE_DOMAIN" != "$DEFAULT_DOMAIN" ]; then
    subst "Федеральным законом от 27\.07\.2006 №152-ФЗ «О персональных данных»" \
          "Законом Республики Казахстан от 21.05.2013 №94-V «О персональных данных и их защите»"
    echo "[region-config] privacy law reference -> KZ 94-V"
fi
