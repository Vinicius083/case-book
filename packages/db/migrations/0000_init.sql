-- Ajuste manual: o drizzle-kit não gera CREATE EXTENSION.
-- citext: email, handle e slug. pgcrypto: já criada pelo init.sql do compose de
-- dev, repetida aqui para que a migration funcione em qualquer banco (prod, CI).
-- gen_random_uuid() é nativa desde o PG 13, mas o DDL de referência declara pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_state" AS ENUM('pending', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'published', 'unlisted');--> statement-breakpoint
CREATE TYPE "public"."block_type" AS ENUM('cover', 'text', 'image', 'gallery_grid', 'fullbleed', 'split', 'carousel', 'video', 'spacer');--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_media_id" uuid,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"links" jsonb DEFAULT '[]' NOT NULL,
	"theme" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_bio_check" CHECK (length("profiles"."bio") <= 500)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"handle" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_handle_unique" UNIQUE("handle"),
	CONSTRAINT "handle_format" CHECK ("users"."handle" ~ '^[a-z0-9][a-z0-9-]{2,29}$')
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"state" "media_state" DEFAULT 'pending' NOT NULL,
	"original_key" text NOT NULL,
	"original_bytes" bigint,
	"sha256" "bytea" NOT NULL,
	"mime" text NOT NULL,
	"filename" text NOT NULL,
	"alt_text" text,
	"width" integer,
	"height" integer,
	"palette" jsonb,
	"exif" jsonb,
	"upload_id" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dims_when_ready" CHECK ("media_assets"."state" <> 'ready' OR ("media_assets"."width" IS NOT NULL AND "media_assets"."height" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "media_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"ssim" numeric(6, 5),
	"quality" integer,
	"bitrate_bps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"state" "job_state" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"trace_id" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "video_assets" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"duration_ms" integer NOT NULL,
	"fps" numeric(6, 3),
	"video_codec" text,
	"audio_codec" text,
	"bitrate_bps" bigint,
	"has_audio" boolean DEFAULT true NOT NULL,
	"hls_master_key" text,
	"poster_key" text,
	"poster_frame_ms" integer
);
--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_versions_project_id_version_no_key" UNIQUE("project_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" "citext" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"cover_media_id" uuid,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"published_version_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "slug_format" CHECK ("projects"."slug" ~ '^[a-z0-9][a-z0-9-]{1,79}$')
);
--> statement-breakpoint
CREATE TABLE "block_media" (
	"block_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"crop" jsonb,
	CONSTRAINT "block_media_pkey" PRIMARY KEY("block_id","media_id","role","position")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "block_type" NOT NULL,
	"rank" text NOT NULL,
	"props" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"aggregate" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivatives" ADD CONSTRAINT "media_derivatives_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cover_media_id_media_assets_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_published_version_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."project_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_media" ADD CONSTRAINT "block_media_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_media" ADD CONSTRAINT "block_media_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_dedupe" ON "media_assets" USING btree ("user_id","sha256") WHERE "media_assets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "media_by_user" ON "media_assets" USING btree ("user_id","created_at" DESC NULLS FIRST) WHERE "media_assets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "media_pending_gc" ON "media_assets" USING btree ("created_at") WHERE "media_assets"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "derivative_unique" ON "media_derivatives" USING btree ("media_id","kind","format",COALESCE("width", -1));--> statement-breakpoint
CREATE INDEX "jobs_by_media" ON "media_jobs" USING btree ("media_id","queued_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "project_slug_per_user" ON "projects" USING btree ("user_id","slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "block_media_by_media" ON "block_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "blocks_ordered" ON "blocks" USING btree ("project_id","rank");--> statement-breakpoint
CREATE INDEX "outbox_unpublished" ON "outbox_events" USING btree ("id") WHERE "outbox_events"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_by_entity" ON "audit_log" USING btree ("entity","entity_id","created_at" DESC NULLS FIRST);