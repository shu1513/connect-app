CREATE TABLE "call_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"old_ends_at" timestamp with time zone NOT NULL,
	"new_ends_at" timestamp with time zone NOT NULL,
	"price_cents" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_call_id_unique";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "extension_id" uuid;--> statement-breakpoint
-- Written by hand: every payment so far is its call's own payment and pays for the whole call,
-- so the two new fields are filled in from the call before they are made required.
ALTER TABLE "payments" ADD COLUMN "covers_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "covers_until" timestamp with time zone;--> statement-breakpoint
UPDATE "payments" SET "covers_from" = "calls"."starts_at", "covers_until" = "calls"."ends_at" FROM "calls" WHERE "calls"."id" = "payments"."call_id";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "covers_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "covers_until" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "call_extensions" ADD CONSTRAINT "call_extensions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_extensions_call_idx" ON "call_extensions" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_extensions_one_open_uq" ON "call_extensions" USING btree ("call_id") WHERE "call_extensions"."status" = 'open';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_extension_id_call_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."call_extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_call_idx" ON "payments" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_own_call_uq" ON "payments" USING btree ("call_id") WHERE "payments"."extension_id" is null;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_extension_id_unique" UNIQUE("extension_id");