# Casebook — Design do MVP

**Status:** Proposta para revisão
**Data:** 2026-09-11

---

## 1. Escopo

### Loop central do MVP

```
cadastrar → subir mídia → montar portfólio em blocos → preview → publicar → página pública
```

Tudo que não serve esse loop fica fora.

### Dentro

| Módulo                  | Entrega                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| Identidade              | signup/login (email+senha), sessão, perfil público com handle                  |
| Upload                  | direto pro object storage via presigned multipart, sem bytes passando pela API |
| Processamento de imagem | AVIF + WebP + JPEG fallback, derivativos responsivos, paleta de cores          |
| Processamento de vídeo  | HLS multi-bitrate, poster automático, duração/dimensões                        |
| Biblioteca de mídia     | listar, filtrar, renomear, deletar assets do usuário                           |
| Builder                 | blocos reordenáveis, 9 tipos, ordenação fracionária, autosave                  |
| Publish                 | snapshot imutável versionado, página pública server-rendered                   |
| Observabilidade         | OpenTelemetry ponta a ponta (API → fila → worker → storage)                    |

### Fora (Fase 2+)

Discovery/busca, feed, social (follow, like, comentário), moderação, showreel automático, simulação de rede mobile no preview, domínio customizado, analytics de visitas, colaboração/revisão estilo Frame.io, marketplace.

Justificativa: discovery e transparência de moderação são a diferenciação de produto, mas não fazem sentido antes de existir conteúdo publicado na plataforma. São Fase 2 obrigatória, não opcional.

---

## 2. Requisitos funcionais

Notação: `RF-<módulo>-<n>`.

### Identidade (AUTH)

- **RF-AUTH-1** — Cadastro com email + senha (Argon2id). Email único, case-insensitive.
- **RF-AUTH-2** — Login retornando access token (JWT, 15min) + refresh token (rotativo, httpOnly cookie, 30d).
- **RF-AUTH-3** — Handle único no cadastro (`/u/:handle`), imutável no MVP, validado contra lista de reservados.
- **RF-AUTH-4** — Perfil editável: nome de exibição, bio, avatar, links externos, papéis na produção (multi-select).
- **RF-AUTH-5** — Verificação de email assíncrona. Conta não verificada pode montar portfólio mas não publicar.

### Upload (UP)

- **RF-UP-1** — Cliente pede intenção de upload informando `filename`, `mime`, `size_bytes`, `sha256`. API valida tipo/tamanho e devolve `media_asset` em `pending` + URLs presigned de multipart.
- **RF-UP-2** — Cliente sobe as partes direto no storage e chama `complete` com os ETags. API completa o multipart e enfileira o job.
- **RF-UP-3** — Deduplicação por `sha256` dentro do escopo do usuário — reupload do mesmo arquivo reaproveita os derivativos existentes.
- **RF-UP-4** — Limites do MVP: imagem até 50 MB, vídeo até 2 GB e 10 min. Formatos aceitos: JPEG, PNG, HEIC, TIFF, WebP, AVIF / MP4, MOV, MKV, WebM.
- **RF-UP-5** — Progresso e estado do processamento consultáveis por polling (`GET /media/:id`) e por SSE (`GET /media/events`).
- **RF-UP-6** — Upload abandonado (`pending` há mais de 24h) é limpo por job agendado, incluindo o multipart pendente no storage.

### Processamento de mídia (MP)

- **RF-MP-1** — Imagem: gerar derivativos AVIF e WebP nas larguras 320/640/1024/1600/2400/3840 (nunca fazer upscale), mais um JPEG de fallback em 1600.
- **RF-MP-2** — Qualidade guiada por métrica: buscar o menor arquivo cujo SSIM contra o original fique ≥ 0.985, por busca binária no parâmetro de qualidade (limites 50–95, máx. 6 iterações). O resultado real (`ssim`, `quality`) é persistido por derivativo.
- **RF-MP-3** — Preservar o original intacto. Downloads e o bloco `fullbleed` em telas grandes servem a maior derivativa; o original nunca é descartado.
- **RF-MP-4** — Extrair paleta: 5 cores dominantes via k-means em OKLab, com contraste WCAG calculado contra branco e preto, guardadas como JSONB no asset.
- **RF-MP-5** — Vídeo: gerar HLS com ladder adaptativa (ver §7, decisão aberta), áudio AAC 128k, segmentos de 4s, playlist master + variantes.
- **RF-MP-6** — Poster automático: frame extraído a 10% da duração, com fallback pro frame 0 se o primeiro vier abaixo do limiar de variância (evita frame preto). Usuário pode trocar por qualquer frame depois.
- **RF-MP-7** — Metadados extraídos e persistidos: dimensões, duração, fps, codec, bitrate, EXIF relevante (câmera, lente, ISO, abertura — alimenta o discovery da Fase 2).
- **RF-MP-8** — Falha de job: até 3 tentativas com backoff exponencial; depois disso o asset vai pra `failed` com mensagem legível e opção de reprocessar.

### Biblioteca (LIB)

- **RF-LIB-1** — Listar assets do usuário paginados por cursor, com filtro por tipo, estado e busca por nome.
- **RF-LIB-2** — Renomear e editar `alt_text` do asset.
- **RF-LIB-3** — Deletar asset. Se estiver em uso em algum projeto publicado, exige confirmação e faz soft delete — o snapshot publicado continua íntegro.
- **RF-LIB-4** — Visualizar detalhes técnicos do asset (derivativos gerados, tamanhos, SSIM atingido, paleta).

### Projetos e builder (BLD)

- **RF-BLD-1** — CRUD de projeto: título, slug (único por usuário), descrição, tags, capa, visibilidade (`draft` / `published` / `unlisted`).
- **RF-BLD-2** — Nove tipos de bloco: `cover`, `text`, `image`, `gallery_grid`, `fullbleed`, `split`, `carousel`, `video`, `spacer`. Contratos em §5.
- **RF-BLD-3** — Adicionar, remover, duplicar e reordenar blocos. Ordenação por rank fracionário (string base62 tipo LexoRank) — mover 1 bloco = 1 UPDATE.
- **RF-BLD-4** — Autosave com debounce de 2s e controle de concorrência otimista via `version` no projeto (409 em conflito).
- **RF-BLD-5** — Preview renderiza o rascunho exatamente com o mesmo componente da página pública.
- **RF-BLD-6** — Publicar cria um `project_version` imutável com o JSONB completo do documento (blocos + referências resolvidas de mídia + paleta). Publicar de novo cria uma nova versão; a anterior é mantida.
- **RF-BLD-7** — Bloquear publish se algum bloco referenciar asset que não esteja em `ready`.
- **RF-BLD-8** — Reverter para uma versão anterior (copia o snapshot de volta pro rascunho).

### Página pública (PUB)

- **RF-PUB-1** — `/u/:handle` lista os projetos publicados do usuário em grid.
- **RF-PUB-2** — `/u/:handle/:slug` renderiza o snapshot publicado. Server-rendered, com cache imutável (a URL carrega o `version_id` no ETag).
- **RF-PUB-3** — `<img>` com `srcset`/`sizes` e `<picture>` em AVIF → WebP → JPEG; `loading="lazy"` fora da primeira dobra; `fetchpriority="high"` no bloco de capa.
- **RF-PUB-4** — Vídeo com player HLS (hls.js onde não houver suporte nativo), poster, sem autoplay com som.
- **RF-PUB-5** — Fundo e acentos derivados da paleta extraída, com override manual pelo usuário.
- **RF-PUB-6** — Meta tags OG/Twitter geradas por projeto usando a capa.

---

## 3. Requisitos não funcionais

| ID     | Requisito                         | Alvo                                        | Como medir                                    |
| ------ | --------------------------------- | ------------------------------------------- | --------------------------------------------- |
| RNF-1  | Latência da API (leitura)         | p95 < 200ms                                 | histograma OTel por rota                      |
| RNF-2  | LCP da página pública             | < 2.0s em 4G simulado                       | Lighthouse CI no pipeline                     |
| RNF-3  | Tempo de processamento de imagem  | p95 < 20s do complete ao `ready`            | span do worker                                |
| RNF-4  | Tempo de processamento de vídeo   | < 2× a duração do vídeo                     | span do worker                                |
| RNF-5  | Fidelidade visual                 | SSIM ≥ 0.985 em 99% dos derivativos         | métrica persistida + agregação                |
| RNF-6  | Durabilidade do enfileiramento    | zero job perdido em queda do Redis          | outbox transacional + relay                   |
| RNF-7  | Idempotência                      | job reprocessado não duplica derivativo     | chave única `(media_id, kind, width, format)` |
| RNF-8  | Disponibilidade da página pública | independe da API estar de pé                | snapshot servido do cache/CDN                 |
| RNF-9  | Isolamento multi-tenant           | nenhuma rota devolve mídia de outro usuário | teste de autorização por rota no CI           |
| RNF-10 | Custo de storage                  | derivativos ≤ 2.5× o tamanho do original    | job de auditoria semanal                      |
| RNF-11 | Rastreabilidade                   | trace único do request HTTP até o worker    | propagação de contexto OTel na fila           |
| RNF-12 | Escala do MVP                     | 50 usuários, 5k assets, 500 GB              | dimensionamento inicial, não meta de carga    |

---

## 4. Modelo de dados

### Relacionamentos

```
users 1──1 profiles
users 1──N media_assets
      1──N projects

media_assets 1──0..1 video_assets        (só quando kind='video')
             1──N   media_derivatives
             1──N   media_jobs

projects 1──N project_versions           (snapshots imutáveis)
         1──N blocks                     (rascunho vivo)

blocks N──N media_assets  via  block_media  (com role + position)

outbox_events  → relay → BullMQ
audit_log      → append-only
```

O ponto que costuma confundir: **`blocks` é rascunho, `project_versions` é publicado.** A página pública nunca faz JOIN em `blocks`; ela lê um JSONB de `project_versions`. É isso que dá o RNF-8.

### DDL (PostgreSQL 16)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE media_kind      AS ENUM ('image','video');
CREATE TYPE media_state     AS ENUM ('pending','uploaded','processing','ready','failed');
CREATE TYPE job_state       AS ENUM ('queued','running','succeeded','failed','dead');
CREATE TYPE project_status  AS ENUM ('draft','published','unlisted');
CREATE TYPE block_type      AS ENUM (
  'cover','text','image','gallery_grid','fullbleed','split','carousel','video','spacer'
);

-- ─────────────────────────── identidade

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  handle          citext NOT NULL UNIQUE,
  email_verified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT handle_format CHECK (handle ~ '^[a-z0-9][a-z0-9-]{2,29}$')
);

CREATE TABLE profiles (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  bio           text CHECK (length(bio) <= 500),
  avatar_media_id uuid,                       -- FK adiada, ver abaixo
  roles         text[] NOT NULL DEFAULT '{}', -- 'editor','colorist','director'...
  links         jsonb NOT NULL DEFAULT '[]',  -- [{label,url}]
  theme         jsonb NOT NULL DEFAULT '{}',  -- override manual da paleta
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────── mídia

CREATE TABLE media_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           media_kind NOT NULL,
  state          media_state NOT NULL DEFAULT 'pending',
  original_key   text NOT NULL,               -- chave no object storage
  original_bytes bigint,
  sha256         bytea NOT NULL,
  mime           text NOT NULL,
  filename       text NOT NULL,
  alt_text       text,
  width          int,
  height         int,
  palette        jsonb,                       -- ver §6
  exif           jsonb,
  upload_id      text,                        -- multipart em aberto
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT dims_when_ready CHECK (
    state <> 'ready' OR (width IS NOT NULL AND height IS NOT NULL)
  )
);

CREATE UNIQUE INDEX media_dedupe
  ON media_assets (user_id, sha256) WHERE deleted_at IS NULL;
CREATE INDEX media_by_user
  ON media_assets (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX media_pending_gc
  ON media_assets (created_at) WHERE state = 'pending';

ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_fk
  FOREIGN KEY (avatar_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;

-- atributos exclusivos de vídeo, fora da tabela quente (ADR-2)
CREATE TABLE video_assets (
  media_id       uuid PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  duration_ms    int NOT NULL,
  fps            numeric(6,3),
  video_codec    text,
  audio_codec    text,
  bitrate_bps    bigint,
  has_audio      boolean NOT NULL DEFAULT true,
  hls_master_key text,
  poster_key     text,
  poster_frame_ms int
);

CREATE TABLE media_derivatives (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id    uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  kind        text NOT NULL,        -- 'image' | 'hls_variant' | 'poster'
  format      text NOT NULL,        -- 'avif' | 'webp' | 'jpeg' | 'm3u8'
  width       int,
  height      int,
  bytes       bigint NOT NULL,
  storage_key text NOT NULL,
  ssim        numeric(6,5),
  quality     int,
  bitrate_bps int,                  -- variantes HLS
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- idempotência de reprocessamento (RNF-7)
CREATE UNIQUE INDEX derivative_unique
  ON media_derivatives (media_id, kind, format, COALESCE(width, -1));

CREATE TABLE media_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id     uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  job_type     text NOT NULL,       -- 'image.process' | 'video.transcode'
  state        job_state NOT NULL DEFAULT 'queued',
  attempts     int NOT NULL DEFAULT 0,
  trace_id     text,                -- amarra o job ao trace HTTP (RNF-11)
  queued_at    timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text
);

CREATE INDEX jobs_by_media ON media_jobs (media_id, queued_at DESC);

-- ─────────────────────────── outbox (ADR-4)

CREATE TABLE outbox_events (
  id           bigserial PRIMARY KEY,
  aggregate    text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type   text NOT NULL,
  payload      jsonb NOT NULL,
  trace_id     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX outbox_unpublished
  ON outbox_events (id) WHERE published_at IS NULL;

-- ─────────────────────────── projetos

CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          citext NOT NULL,
  title         text NOT NULL,
  description   text,
  tags          text[] NOT NULL DEFAULT '{}',
  cover_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  status        project_status NOT NULL DEFAULT 'draft',
  version       int NOT NULL DEFAULT 0,      -- lock otimista do rascunho
  published_version_id uuid,                 -- FK adiada
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$')
);

CREATE UNIQUE INDEX project_slug_per_user
  ON projects (user_id, slug) WHERE deleted_at IS NULL;

CREATE TABLE project_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_no   int NOT NULL,
  document     jsonb NOT NULL,     -- snapshot completo, self-contained
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_no)
);

ALTER TABLE projects ADD CONSTRAINT projects_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES project_versions(id);

CREATE TABLE blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type       block_type NOT NULL,
  rank       text NOT NULL,        -- LexoRank; ordenação por (rank, id)
  props      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blocks_ordered ON blocks (project_id, rank);

CREATE TABLE block_media (
  block_id   uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  role       text NOT NULL DEFAULT 'primary',
  position   int  NOT NULL DEFAULT 0,
  crop       jsonb,                -- {x,y,w,h} normalizado 0..1
  PRIMARY KEY (block_id, media_id, role, position)
);

CREATE INDEX block_media_by_media ON block_media (media_id);

-- ─────────────────────────── auditoria

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  metadata   jsonb NOT NULL DEFAULT '{}',
  trace_id   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_by_entity ON audit_log (entity, entity_id, created_at DESC);
```

Nota sobre `ON DELETE RESTRICT` em `block_media.media_id`: é intencional. Deletar mídia em uso deve falhar no banco e ser tratado como soft delete na aplicação (RF-LIB-3), nunca cascatear e furar um bloco silenciosamente.

---

## 5. Contratos de `props` por tipo de bloco

Esse era o item mais urgente em aberto. Como o snapshot é imutável, mudar contrato depois do primeiro publish quebra páginas publicadas — então cada `props` carrega `schema_version` e o renderer despacha por versão.

Todos os blocos herdam:

```ts
type BaseProps = {
  schema_version: 1;
  spacing?: "tight" | "normal" | "loose"; // default 'normal'
  background?: "default" | "inverted" | "palette";
};
```

```ts
// cover — abre o projeto; 1 mídia (role='primary')
type CoverProps = BaseProps & {
  headline: string; // ≤ 120 chars
  subhead?: string; // ≤ 240
  overlay: "none" | "scrim" | "gradient"; // default 'scrim'
  text_position: "center" | "bottom-left" | "bottom-right";
  height: "viewport" | "large" | "medium";
};

// text — sem mídia
type TextProps = BaseProps & {
  variant: "body" | "lead" | "quote" | "caption";
  content: string; // markdown restrito: **, _, link, quebra
  align: "left" | "center";
  max_width: "narrow" | "wide"; // 'narrow' = ~65ch
};

// image — 1 mídia
type ImageProps = BaseProps & {
  caption?: string;
  size: "contained" | "wide"; // 'wide' estoura a coluna de texto
  aspect?: "1:1" | "4:3" | "3:2" | "16:9" | "original";
};

// gallery_grid — 2..12 mídias (position define a ordem)
type GalleryGridProps = BaseProps & {
  columns: 2 | 3 | 4;
  gap: "none" | "small" | "medium";
  aspect: "1:1" | "4:3" | "3:2" | "masonry";
  caption?: string;
};

// fullbleed — 1 mídia, 100vw, serve a maior derivativa
type FullbleedProps = BaseProps & {
  height: "auto" | "viewport";
  caption?: string;
  parallax: boolean; // default false
};

// split — 1 mídia + texto lado a lado
type SplitProps = BaseProps & {
  media_side: "left" | "right";
  ratio: "1:1" | "2:3" | "3:2";
  headline?: string;
  content?: string; // mesmo markdown restrito
  vertical_align: "top" | "center";
};

// carousel — 2..20 mídias
type CarouselProps = BaseProps & {
  aspect: "1:1" | "4:3" | "3:2" | "16:9";
  show_arrows: boolean;
  show_dots: boolean;
  peek: boolean; // mostra fatia do próximo slide
  caption?: string;
};

// video — 1 mídia kind='video'; poster override opcional (role='poster')
type VideoProps = BaseProps & {
  size: "contained" | "wide" | "fullbleed";
  autoplay_muted: boolean; // default false
  loop: boolean;
  controls: boolean; // default true
  caption?: string;
};

// spacer — sem mídia
type SpacerProps = BaseProps & {
  size: "small" | "medium" | "large";
  divider: boolean;
};
```

**Regras de cardinalidade de mídia** (validadas no servidor no PUT do bloco e de novo no publish):

| Tipo         | role    | mín | máx |
| ------------ | ------- | --- | --- |
| cover        | primary | 1   | 1   |
| image        | primary | 1   | 1   |
| gallery_grid | primary | 2   | 12  |
| fullbleed    | primary | 1   | 1   |
| split        | primary | 1   | 1   |
| carousel     | primary | 2   | 20  |
| video        | primary | 1   | 1   |
| video        | poster  | 0   | 1   |
| text, spacer | —       | 0   | 0   |

Validação com Zod compartilhado entre API e front, discriminado por `type`. O snapshot de publish serializa `props` já validado — o renderer público nunca revalida, só despacha por `schema_version`.

### Formato do snapshot (`project_versions.document`)

```jsonc
{
  "schema_version": 1,
  "project": { "title": "...", "description": "...", "tags": [...] },
  "theme": { "bg": "#0b0b0c", "accent": "#c8ff3d", "source": "palette" },
  "blocks": [
    {
      "type": "gallery_grid",
      "props": { "schema_version": 1, "columns": 3, "aspect": "3:2", "gap": "small" },
      "media": [
        {
          "role": "primary", "position": 0,
          "width": 4000, "height": 2667, "alt": "...",
          "palette": ["#1c1c1e", "..."],
          "sources": [
            { "format": "avif", "width": 1600, "url": "https://cdn/.../x_1600.avif" },
            { "format": "webp", "width": 1600, "url": "https://cdn/.../x_1600.webp" }
          ]
        }
      ]
    }
  ]
}
```

Auto-contido de propósito: URLs já resolvidas, dimensões já embutidas. Renderizar a página pública é 1 SELECT.

---

## 6. Máquina de estados do upload

```
pending ──complete()──▶ uploaded ──relay/enqueue──▶ processing ──▶ ready
   │                                                    │
   │ 24h sem complete                                   │ 3 falhas
   ▼                                                    ▼
 (GC: aborta multipart, deleta linha)                 failed ──retry()──▶ processing
```

Transições válidas, tudo o mais é 409:

| De         | Para       | Gatilho                                          |
| ---------- | ---------- | ------------------------------------------------ |
| pending    | uploaded   | `POST /media/:id/complete` com ETags válidos     |
| uploaded   | processing | worker pega o job                                |
| processing | ready      | todos os derivativos gravados na mesma transação |
| processing | failed     | 3 tentativas esgotadas                           |
| failed     | processing | `POST /media/:id/retry`                          |

O enfileiramento nunca acontece direto no handler HTTP. `complete` grava `media_assets.state='uploaded'` **e** insere em `outbox_events` na mesma transação; um relay separado faz o `LISTEN/NOTIFY` + poll e publica no BullMQ. É isso que garante o RNF-6.

Formato da paleta em `media_assets.palette`:

```json
{
  "dominant": "#1c1c1e",
  "colors": [
    {
      "hex": "#1c1c1e",
      "ratio": 0.42,
      "contrast_white": 13.1,
      "contrast_black": 1.6
    }
  ],
  "suggested": { "bg": "#1c1c1e", "fg": "#f5f5f7", "accent": "#c8ff3d" }
}
```

---

## 7. API REST (MVP)

```
POST   /auth/signup
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /me
PATCH  /me/profile

POST   /media/uploads                 → cria asset + presigned parts
POST   /media/:id/complete            → ETags, dispara pipeline
POST   /media/:id/retry
GET    /media                         → cursor, filtros
GET    /media/:id
PATCH  /media/:id                     → filename, alt_text
DELETE /media/:id
GET    /media/events                  → SSE de mudança de estado

GET    /projects
POST   /projects
GET    /projects/:id
PATCH  /projects/:id                  → If-Match: version
DELETE /projects/:id

GET    /projects/:id/blocks
POST   /projects/:id/blocks           → {type, props, after_block_id?, media[]}
PATCH  /blocks/:id                    → props e/ou media
POST   /blocks/:id/move               → {after_block_id | before_block_id}
POST   /blocks/:id/duplicate
DELETE /blocks/:id

POST   /projects/:id/publish          → cria project_version
POST   /projects/:id/unpublish
GET    /projects/:id/versions
POST   /projects/:id/revert/:versionId

GET    /public/u/:handle
GET    /public/u/:handle/:slug        → snapshot; ETag = version_id
```

Erros no formato RFC 9457 (`application/problem+json`). Todo 4xx/5xx carrega `trace_id`.

---

## 8. Decisões que continuam abertas

Preciso da sua escolha nestas três antes de escrever o plano de implementação.

**a) Storage.** Recomendo **Cloudflare R2**: egress zero (o que importa muito num produto que serve vídeo), API S3-compatível, e CDN embutida. Alternativa é S3 + CloudFront, mais "currículo padrão" mas com custo de egress que dói em vídeo. Para dev local, MinIO nos dois casos.

**b) Stack de worker.** Recomendo **Node + BullMQ chamando FFmpeg/libvips por child process**, num serviço separado da API. Mantém uma linguagem só, e a parte pesada é o binário de qualquer jeito. A alternativa (worker em Go ou Python) só se paga se você quiser o poliglotismo como vitrine — o que é um argumento legítimo num projeto de portfólio, mas custa CI e deploy dobrados.

**c) Ladder HLS.** Proposta: 360p@800k, 540p@1400k, 720p@2800k, 1080p@5000k, 1440p@9000k (só se a fonte for ≥1440p), H.264 High + CRF-based two-pass com cap de bitrate. Sem AV1 no MVP — tempo de encode inviabiliza o RNF-4.

---

## 9. Ordem de construção

1. **Fundação + observabilidade** — schema, auth, OTel desde o primeiro endpoint. Instrumentar depois nunca acontece.
2. **Pipeline de imagem ponta a ponta** — upload direto, outbox, worker, derivativos, paleta. É o vertical slice que prova a arquitetura inteira com o caso mais barato de debugar.
3. **Builder** — blocos, rank fracionário, autosave, validação de props.
4. **Publish + página pública** — snapshot, renderer, srcset, cache.
5. **Vídeo** — HLS, poster, player. Por último de propósito: reusa toda a infra dos passos 2 e 4, e é o que mais consome tempo de encode em dev.

Cada etapa termina publicável de ponta a ponta. Depois da 4 você já tem um produto que um amigo consegue usar de verdade — vídeo entra como upgrade, não como pré-requisito.
