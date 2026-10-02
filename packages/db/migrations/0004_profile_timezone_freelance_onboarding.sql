ALTER TABLE "profiles" ADD COLUMN "work_timezone" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "available_for_freelance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
-- Contas criadas antes do onboarding já passaram pelo cadastro completo de então:
-- não devem ser mandadas de volta para os passos de papel e perfil.
UPDATE "profiles" SET "onboarding_completed_at" = now();
