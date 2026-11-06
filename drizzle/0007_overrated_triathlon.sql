CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"handle_key" text NOT NULL,
	"display_name" text NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"price_per_15_cents" integer NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"us_confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_profiles_handle_unique" UNIQUE("handle"),
	CONSTRAINT "host_profiles_handle_key_unique" UNIQUE("handle_key")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"name_typed" text NOT NULL,
	"name_key" text NOT NULL,
	"url" text NOT NULL,
	"code" text NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "adult_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_to_idx" ON "email_outbox" USING btree ("to","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_user_network_uq" ON "social_accounts" USING btree ("user_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_confirmed_uq" ON "social_accounts" USING btree ("network","name_key") WHERE "social_accounts"."confirmed_at" is not null;