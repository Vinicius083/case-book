# Casebook — Stack e Justificativas

> Documento de referência das escolhas tecnológicas do projeto.
> Cada seção traz a decisão, o motivo e o que foi descartado.

---

## Visão geral

| Camada | Escolha | Descartado |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Nx |
| Front | Next.js 15 (App Router) | Vite SPA |
| API | NestJS + Fastify adapter | Laravel, FastAPI |
| Acesso a dados | Drizzle ORM | Prisma, TypeORM, MikroORM |
| Worker de imagem | Node + sharp (libvips) | Python |
| Worker de vídeo | Python + PyAV/FFmpeg | Go, Node |
| Banco | PostgreSQL 16 (único) | + MongoDB |
| Fila / cache | Redis 7 | RabbitMQ |
| Storage | Cloudflare R2 (MinIO em dev) | S3 + CloudFront |
| Reverse proxy | Caddy | Traefik, Nginx |
| Deploy | VPS Hetzner + Docker Compose | Render, Railway, Kubernetes |
| Observabilidade | OTel → SigNoz self-hosted | Grafana LGTM |

---

## Contexto que dita as escolhas

O Casebook não é um CRUD com upload. O peso arquitetural está em quatro pontos,
e eles são o critério de avaliação de qualquer decisão de stack:

1. **Contrato de blocos compartilhado.** Os 9 tipos de bloco têm `props`
   validados no builder e na API. O snapshot publicado é imutável — divergência
   entre as duas validações corrompe páginas publicadas sem rollback.
2. **Pipeline de mídia assíncrono.** Upload direto → outbox transacional →
   fila → worker → derivativos. A fronteira API↔worker é a peça arquitetural
   central.
3. **JSONB pesado.** `props`, `document` (snapshot) e `palette`.
4. **SSE** para estado de processamento de mídia em tempo real.

---

## Front — Next.js 15 (App Router)

**Por quê.** A página pública é server-rendered a partir de um snapshot
imutável, com `ETag = version_id`. Isso é literalmente o caso de uso de RSC +
cache tag: HTML gerado no servidor, `<picture>` com `srcset` montado a partir
de `media_derivatives`, zero hidratação fora do bloco de vídeo.

O builder é client-heavy e vive em outra rota — a mesma app cobre os dois
regimes sem SPA separada.

**Descartado.** Vite SPA: perderia SSR da página pública, que é o produto final
que o usuário compartilha. SEO, OG tags e performance de primeira dobra são
requisito, não bônus.

**Libs:**
- `dnd-kit` — reordenação de blocos. Escolhido sobre `react-beautiful-dnd`
  (descontinuado). Fornece o índice de destino, o LexoRank é calculado no
  client e enviado como um único UPDATE.
- `zustand` — documento em edição + histórico undo/redo. Não é cache de
  servidor, então não vai para o TanStack Query.
- `@tanstack/react-query` — biblioteca de mídia, lista de projetos.
- `zod` — mesmo schema de `packages/contracts` usado no back.
- Tailwind + shadcn/ui com design tokens em CSS custom properties.

---

## API — NestJS + Fastify

**Por quê.**

1. **Contrato único.** `packages/contracts` com Zod valida os `props` no
   builder e na API a partir da mesma fonte. Elimina a classe inteira de bug
   mais cara do projeto.
2. **Mesma fila do worker.** BullMQ nativo dos dois lados, payload de job
   tipado, contexto OTel propagado sem tradução de protocolo.
3. **SSE trivial** — `@Sse()` + Observable do RxJS.
4. **Arquitetura imposta** — módulos, DI, guards, interceptors, pipes. Para
   seis bounded contexts (`auth`, `media`, `projects`, `blocks`, `publishing`,
   `public`) isso é estrutura de graça.

Fastify adapter em vez de Express pelo overhead em SSE e throughput geral.

**Descartado — Laravel.** Laravel 11 é excelente para CRUD + auth + upload, e
Horizon é melhor que qualquer dashboard de BullMQ. Mas:
- Laravel Queue usa formato de payload próprio, incompatível com BullMQ. Ou se
  reescreve o worker em PHP (perdendo sharp/libvips e o ecossistema de encode),
  ou se mantém dois sistemas de fila no mesmo Redis sem se enxergarem.
- Contrato de blocos duplicado (Form Requests + Zod), sobre o artefato mais
  sensível do sistema.
- SSE exige segurar um worker PHP-FPM por conexão, ou subir Reverb/Soketi.
- JSONB vira `array` PHP sem tipagem.

**Descartado — FastAPI.** Pydantic v2 é o melhor sistema de
validação/serialização de qualquer framework, e o OpenAPI gerado é correto. Mas
o ganho real do Python está no **processamento de mídia**, não na API — e esse
ganho foi capturado colocando o worker de vídeo em Python. Como API: sem
arquitetura imposta para seis contextos (`Depends` é injeção de função, não
container), contrato ainda duplicado, e SQLAlchemy 2.0 async + Alembic é curva
maior que Drizzle.

**Auth própria** (argon2id + JWT curto + refresh opaco rotativo com detecção de
reuso), não NextAuth/Clerk. Auth é parte do que o projeto demonstra.

---

## Acesso a dados — Drizzle

**Por quê.** O schema tem índice parcial (`WHERE deleted_at IS NULL`), enum
nativo (`block_type`), `ON DELETE RESTRICT` intencional em `block_media`, PK
composta, JSONB tipado e `pg_notify`. Drizzle expressa tudo isso sem cair em
raw query, gera migrations SQL legíveis e editáveis, e o `$type<BlockProps>()`
tipa o JSONB com o mesmo union do Zod que o front usa.

No Docker é trivial: sem binário, sem generate, sem libssl.

**Descartado — Prisma.** Má experiência prévia com Prisma + Docker + NestJS, e
a causa é conhecida: `binaryTargets` / query engine que não bate entre a imagem
de build e a de runtime (glibc vs musl), somado ao `prisma generate` obrigatório
no build e ao ciclo de vida do client que não encaixa no Nest sem hooks manuais.
Além disso, trata índice parcial, enum nativo e JSONB tipado como cidadãos de
segunda classe.

**Descartado — TypeORM.** É o ORM "oficial" do Nest e o DI fica limpo, mas:
- `migration:generate` não entende índice parcial — gera drift a cada deploy.
- Tipagem é nominal: `select` não estreita o tipo, relações são sempre
  opcionais.
- QueryBuilder por string mágica (`'project.userId = :uid'`), erro só em
  runtime.
- Manutenção em modo sobrevivência desde a saída do mantenedor principal.

**Descartado — MikroORM.** Tecnicamente é o TypeORM feito direito (Unit of Work,
JSONB tipado, índice parcial). Ficou de fora pelo risco do `EntityManager`
request-scoped vazar contexto entre jobs em worker fora do ciclo HTTP.

**Integração com o Nest** — provider simples, sem perder o DI:

```ts
export const DB = Symbol('DB');
export type Database = ReturnType<typeof drizzle<typeof schema>>;

@Global()
@Module({
  providers: [{
    provide: DB,
    useFactory: () => drizzle(new Pool({
      connectionString: process.env.DATABASE_URL, max: 20,
    }), { schema }),
  }],
  exports: [DB],
})
export class DatabaseModule {}
```

---

## Workers — dois runtimes, por domínio

### Worker de imagem — Node + sharp

`sharp` (libvips) roda in-process, é rápido, e a imagem Docker fica leve
(~150MB). Gera derivativos AVIF/WebP/JPEG em 5 larguras e extrai a paleta.
Concorrência 4.

Paleta: k-means próprio sobre resize de 100px, porque o output precisa de
`ratio` e `contrast_white`/`contrast_black` (WCAG) — nenhuma lib pronta entrega
isso. `node-vibrant` está abandonado.

### Worker de vídeo — Python

**Por quê.** O trabalho se divide em ~97% FFmpeg (processo separado, satura os
cores sozinho) e ~2% análise de frame. A velocidade da linguagem é irrelevante
para o wall-clock; o que decide é o ferramental desse 2%.

- **`bullmq` tem port oficial em Python**, mantido pelo mesmo time do original.
  Mesmos scripts Lua, mesma estrutura de chaves. O worker consome a fila que a
  API Nest produz, sem relay de tradução.
- **PyAV** é binding direto na libav: frames como `ndarray`, sem passar por
  disco nem parsear stdout.
- **scikit-image** para SSIM/MS-SSIM real, que alimenta a busca de CRF por
  alvo de qualidade.
- **PySceneDetect** resolve o showreel automático da Fase 2.

**Descartado — Go.** Vantagens reais: binário estático (~120MB de imagem vs
~1.2GB do Python), ~15MB de RAM idle vs ~250MB, goroutines para paralelismo.
Mas:
- Não existe cliente BullMQ maduro. As alternativas (`asynq`, `river`) são
  boas, porém com protocolo próprio — exigiria um relay traduzindo
  BullMQ → asynq, ou trocar a fila da aplicação inteira. Regressão
  arquitetural para economizar 1GB de imagem.
- Não existe binding maduro de libav (`goav` abandonado). SSIM viraria parsing
  do stdout do FFmpeg — perdendo exatamente o controle que justificava a
  escolha.
- k-means e detecção de cena teriam que ser escritos do zero.
- O argumento "Go é mais rápido" não se sustenta quando 97% do tempo é FFmpeg.

**Stack do worker de vídeo:**
```
Python 3.12-slim-bookworm   (não Alpine — musl quebra wheels)
bullmq                      consumo da fila
PyAV                        probe, extração de frames
scikit-image                métrica SSIM
numpy                       paleta, contraste WCAG
boto3                       R2
asyncpg                     estado e derivativos
opentelemetry-sdk           propaga trace_id vindo do payload do job
uv                          gerenciador de dependências
```

**Concorrência 1** na fila de vídeo. FFmpeg já satura os cores; encodes
paralelos pioram o wall-clock e estouram RAM.

---

## Banco — apenas PostgreSQL 16

Nenhum banco secundário no MVP. Postgres cobre:
- **JSONB** para `props`, `document` e `palette`, com GIN index onde houver
  filtro.
- **Full-text nativo** (`tsvector` + `pg_trgm`) para o discovery da Fase 2.
  Migrar para Meilisearch só se a busca facetada por especialidade/equipamento
  exigir — e aí Meilisearch (1 container, ~50MB) sobre Elasticsearch.
- **`LISTEN/NOTIFY`** para o relay do outbox.

**Descartado — MongoDB.** JSONB resolve o documento do snapshot sem abrir mão
de transação, FK e constraint. Adicionar um segundo banco seria complexidade
sem contrapartida.

### Redis

Serve fila (BullMQ) e cache/rate-limit. Databases lógicas separadas: `db 0`
fila, `db 1` cache. `maxmemory-policy noeviction` — com `allkeys-lru` o Redis
apagaria jobs sob pressão de memória.

**Descartado — RabbitMQ.** Um broker a mais para operar sem ganho, já que
BullMQ sobre Redis cobre retry, backoff, delayed, rate limit e prioridade.

---

## Storage — Cloudflare R2

**Por quê.** Egress zero. Servir HLS 1080p a partir de S3 + CloudFront num
projeto pago do próprio bolso gera conta imprevisível. R2 é S3-compatible, então
o código usa `@aws-sdk/client-s3` igual — sem perder o domínio de S3.

Dois buckets:
- `casebook-originals` — privado, masters, lifecycle para Infrequent Access aos
  30 dias. Presigned multipart.
- `casebook-media` — público via `cdn.casebook.app`, derivativos e HLS. Escrito
  pelos workers.

Dev: MinIO com o mesmo SDK e `forcePathStyle: true`.

---

## Deploy — VPS + Docker Compose

**Por quê VPS e não PaaS.** Render/Railway cobram por CPU-minuto, e
transcodificação é 100% CPU por minutos seguidos — um encode de 6 minutos custa
mais que uma VPS inteira por mês. Somado a: sem controle do build do FFmpeg,
timeout de request, e sem `LISTEN/NOTIFY` persistente.

**Topologia — duas máquinas:**
- `casebook-app` (Hetzner CPX21, 3 vCPU / 4GB): Caddy, Next.js, API, Postgres,
  Redis, outbox relay.
- `casebook-worker` (CPX41, 8 vCPU / 16GB): workers de imagem e vídeo.

Separadas porque encode satura CPU e derrubaria a latência da API. Redis é a
única coisa compartilhada, o que mantém a fronteira limpa e permite escalar as
filas de forma independente.

**Caddy** sobre Traefik/Nginx: TLS automático sem anotação, config de 8 linhas.
Traefik só se paga com muitos serviços dinâmicos.

**CI/CD.** GitHub Actions → build multi-stage → push GHCR → SSH com
`docker compose pull && up -d`.

**Descartado — Kubernetes.** Sobre-engenharia evidente para duas máquinas.
Num projeto de portfólio conta contra, não a favor.

**Backup.** `pg_dump` diário para o R2 com lifecycle de 30 dias. Os originais
em R2 já são a fonte de verdade da mídia.

---

## Observabilidade — OpenTelemetry + SigNoz

SDK do OTel instrumentado desde o primeiro endpoint. SigNoz self-hosted
(ClickHouse embutido) dá traces, métricas e logs correlacionados numa UI só.

**Descartado — stack Grafana (Tempo + Loki + Mimir + Prometheus).** Mais
"padrão de mercado", mas são 5 serviços para configurar — tempo que sai do
produto.

O trace que precisa existir desde o dia 1:

```
upload.complete → outbox.relay → queue.enqueue → worker.transcode → derivative.upload
```

com o mesmo `trace_id` atravessando a fila. BullMQ não propaga contexto
sozinho: o `traceparent` vai no payload do job e o contexto é reconstruído no
worker.

---

## Resumo da narrativa arquitetural

Três serviços, dois runtimes, cada um escolhido por domínio:

- **API em TypeScript** porque o contrato de blocos precisa ser único entre
  front e back, e porque a fronteira com a fila fica sem tradução.
- **Worker de imagem em Node** porque `sharp` é in-process e a imagem fica
  leve.
- **Worker de vídeo em Python** porque PyAV e scikit-image dão análise de frame
  que não existe nas outras opções, e o custo do poliglotismo é contido — a
  fronteira é a fila, então é um Dockerfile a mais.

Não é poliglotismo gratuito: é linguagem escolhida por domínio, com a fronteira
desenhada antes.
