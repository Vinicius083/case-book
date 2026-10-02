CREATE TABLE "handle_reservations" (
	"handle" "citext" PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "handle_reservations_handle_format" CHECK ("handle_reservations"."handle"::text ~ '^[a-z0-9][a-z0-9-]{2,29}$')
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "handle_reservations" ADD CONSTRAINT "handle_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_location_check" CHECK (char_length("profiles"."location") <= 80);