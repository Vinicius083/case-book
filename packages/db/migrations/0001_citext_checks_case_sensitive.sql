-- Em colunas citext o operador `~` é case-insensitive: os CHECKs de formato da 0000
-- aceitavam maiúsculas ('UPPER' passava em '^[a-z0-9]...'). O cast `::text` força a
-- comparação case-sensitive. Mesmos nomes e mesmas regex da 0000.
-- Pré-condição verificada em dev: nenhuma linha existente viola a regra nova.
ALTER TABLE "users" DROP CONSTRAINT "handle_format";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "slug_format";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "handle_format" CHECK ("users"."handle"::text ~ '^[a-z0-9][a-z0-9-]{2,29}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "slug_format" CHECK ("projects"."slug"::text ~ '^[a-z0-9][a-z0-9-]{1,79}$');