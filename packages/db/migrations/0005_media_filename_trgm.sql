-- Ajuste manual: o drizzle-kit não gera CREATE EXTENSION. pg_trgm já vem do init.sql
-- do compose de dev; repetida aqui para valer em qualquer banco (prod, CI).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Busca por nome na biblioteca (RF-LIB-1): torna indexável o `filename ILIKE '%q%'`.
CREATE INDEX "media_filename_trgm" ON "media_assets" USING gin ("filename" gin_trgm_ops) WHERE "media_assets"."deleted_at" IS NULL;
