#!/bin/sh
# Provisiona buckets do MinIO de dev. Idempotente: pode rodar a cada `infra:up`.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "local/$S3_BUCKET_ORIGINALS"
mc mb --ignore-existing "local/$S3_BUCKET_MEDIA"

# Originais: privados; só acessíveis via URL pré-assinada.
mc anonymous set none "local/$S3_BUCKET_ORIGINALS"
# Derivados (AVIF/WebP/HLS): leitura anônima, servidos direto ao browser.
mc anonymous set download "local/$S3_BUCKET_MEDIA"

# CORS: o MinIO community não implementa PutBucketCors (responde NotImplemented).
# O CORS é global, configurado no serviço `minio` via MINIO_API_CORS_ALLOW_ORIGIN,
# e o MinIO já expõe ETag por padrão. Em prod (R2) a regra é por bucket, só no
# originals: PUT de WEB_URL, ExposeHeaders [ETag].

echo "minio-init: buckets prontos"
