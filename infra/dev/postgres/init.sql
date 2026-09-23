-- Executado uma única vez, na criação do volume (docker-entrypoint-initdb.d).
-- Para reaplicar: pnpm infra:reset && pnpm infra:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- busca por similaridade (índices GIN trigram)
