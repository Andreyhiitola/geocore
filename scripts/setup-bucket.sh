#!/bin/bash
# GeoCore-Academy — настройка бакета S3 для гибридной схемы бэкапов
#
# Включает versioning (нужен для moodledata-mirror/, чтобы случайный --delete
# при синхронизации был обратим) и lifecycle-правило, которое удаляет старые
# версии объектов через NONCURRENT_DAYS дней — иначе versioning сам по себе
# раздувает хранилище (тарифицируются все версии, кроме помеченных Deleted).
#
# Запуск (один раз после создания бакета, безопасно перезапускать):
#   S3_BUCKET=geocore-backups S3_ENDPOINT=https://s3.ru-3.storage.selcloud.ru \
#     bash scripts/setup-bucket.sh

set -euo pipefail

S3_ENDPOINT="${S3_ENDPOINT:?Переменная S3_ENDPOINT не задана}"
S3_BUCKET="${S3_BUCKET:?Переменная S3_BUCKET не задана}"
NONCURRENT_DAYS="${NONCURRENT_DAYS:-14}"

s3api() { aws --endpoint-url "$S3_ENDPOINT" s3api "$@"; }

echo "Бакет:    $S3_BUCKET"
echo "Endpoint: $S3_ENDPOINT"
echo "Хранить старые версии объектов: ${NONCURRENT_DAYS} дн."
echo

echo "Включаю versioning..."
s3api put-bucket-versioning \
    --bucket "$S3_BUCKET" \
    --versioning-configuration Status=Enabled

echo "Применяю lifecycle-правило (старые версии + недозагруженные multipart)..."
s3api put-bucket-lifecycle-configuration \
    --bucket "$S3_BUCKET" \
    --lifecycle-configuration "$(cat <<JSON
{
  "Rules": [
    {
      "ID": "expire-noncurrent-versions",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "NoncurrentVersionExpiration": {"NoncurrentDays": ${NONCURRENT_DAYS}}
    },
    {
      "ID": "abort-incomplete-multipart-uploads",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    }
  ]
}
JSON
)"

echo
echo "Готово. Проверка:"
s3api get-bucket-versioning --bucket "$S3_BUCKET"
s3api get-bucket-lifecycle-configuration --bucket "$S3_BUCKET"
