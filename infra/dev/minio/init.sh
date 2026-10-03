#!/bin/sh
# Provisiona buckets do MinIO de dev. Idempotente: pode rodar a cada `infra:up`.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "local/$S3_BUCKET_ORIGINALS"
mc mb --ignore-existing "local/$S3_BUCKET_MEDIA"

# Originais: privados; só acessíveis via URL pré-assinada.
mc anonymous set none "local/$S3_BUCKET_ORIGINALS"
# Derivados (AVIF/WebP/HLS): leitura anônima de objetos, servidos direto ao browser,
# mas sem listagem. O `mc anonymous set download` também libera s3:ListBucket, e aí
# qualquer um enumeraria as chaves — a proteção de um derivativo é a URL não ser
# adivinhável (ADR 0002). Em prod (R2), o equivalente é o domínio público do bucket,
# que não lista.
cat > /tmp/media-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET_MEDIA/*"]
    }
  ]
}
POLICY
mc anonymous set-json /tmp/media-policy.json "local/$S3_BUCKET_MEDIA"

# CORS: o MinIO community não implementa PutBucketCors (responde NotImplemented).
# O CORS é global, configurado no serviço `minio` via MINIO_API_CORS_ALLOW_ORIGIN,
# e o MinIO já expõe ETag por padrão. Em prod (R2) a regra é por bucket, só no
# originals: PUT de WEB_URL, ExposeHeaders [ETag].

echo "minio-init: buckets prontos"
