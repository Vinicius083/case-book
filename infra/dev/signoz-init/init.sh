#!/bin/sh
# Bootstrap do SigNoz de dev. Idempotente.
#
# Por quê: o collector (ingester) recebe a config dos pipelines do SigNoz via
# OpAMP, e o SigNoz só envia a config real depois que existe uma organização.
# Até o primeiro signup, o collector roda com receivers `nop` e as portas
# OTLP 4317/4318 ficam fechadas. Criamos o admin de dev automaticamente para
# que `docker compose up` já entregue um ambiente recebendo telemetria.
set -eu

SIGNOZ=http://signoz-signoz-0:8080

if curl -fsS "$SIGNOZ/api/v1/version" | grep -q '"setupCompleted":true'; then
  echo "signoz-init: organização já existe"
else
  curl -fsS -X POST "$SIGNOZ/api/v1/register" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"Dev\",\"orgName\":\"casebook\",\"orgDisplayName\":\"Casebook\",\"email\":\"$SIGNOZ_ADMIN_EMAIL\",\"password\":\"$SIGNOZ_ADMIN_PASSWORD\"}" \
    >/dev/null
  echo "signoz-init: admin $SIGNOZ_ADMIN_EMAIL criado"
fi

# Espera o collector aplicar a config recebida via OpAMP e abrir o OTLP/HTTP.
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://ingester:4318/v1/traces \
  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}')" = 200 ]; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "signoz-init: OTLP em ingester:4318 não respondeu em 120s" >&2
    exit 1
  fi
  sleep 2
done
echo "signoz-init: OTLP pronto"
