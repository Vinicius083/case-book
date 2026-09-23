# SigNoz (dev)

O SigNoz descontinuou os arquivos `deploy/docker/*.yaml` e o `install.sh`; o
caminho suportado hoje é o [Foundry](https://signoz.io/docs/install/docker/),
que gera os manifests a partir de um `casting.yaml`.

- `casting.yaml` — **fonte da verdade**. Patches aplicados sobre o que o Foundry gera:
  versões fixas das imagens, UI em `3301`, rede `casebook`, heap menor do ZooKeeper,
  healthcheck no ingester e `depends_on` entre migrator/ClickHouse/ingester.
- `pours/deployment/` — **gerado**, versionado para que `docker compose up` funcione sem
  o `foundryctl` instalado. Não edite à mão.

## Regenerar

```bash
curl -fsSL https://signoz.io/foundry.sh | bash   # instala o foundryctl em ~/.local/bin
cd infra/dev/signoz
foundryctl forge -f casting.yaml
git diff pours/                                  # revise antes de commitar
```

Para atualizar o SigNoz, troque as tags de imagem no `casting.yaml` e regenere.

## Bootstrap (`signoz-init`)

O collector (`ingester`) recebe a config dos pipelines do próprio SigNoz via OpAMP, e o
SigNoz só envia a config real depois que existe uma organização. Antes disso o collector
roda com receivers `nop` e **as portas 4317/4318 ficam fechadas**. O serviço `signoz-init`
(em `docker-compose.dev.yml`) cria o admin de dev e espera o OTLP responder.

Enquanto a org não existe, o ingester loga `cannot create agent without orgId` — esperado.
