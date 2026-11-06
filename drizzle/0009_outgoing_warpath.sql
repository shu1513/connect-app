CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"length_minutes" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"price_per_15_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"free_cancel_minutes" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"stage" text NOT NULL,
	"source" text DEFAULT 'customer' NOT NULL,
	"request_key" text NOT NULL,
	"requested_at" timestamp with time zone,
	"respond_by" timestamp with time zone,
	"pay_by" timestamp with time zone,
	"card_consent_version" text,
	"card_consent_at" timestamp with time zone,
	"stripe_setup_intent_id" text,
	"stripe_payment_method_id" text,
	"call_id" uuid,
	"host_notified_at" timestamp with time zone,
	"hold_tried_at" timestamp with time zone,
	"hold_failed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"ended_reason" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "bookings_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
CREATE TABLE "busy_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_calendars" (
	"user_id" text PRIMARY KEY NOT NULL,
	"time_zone" text NOT NULL,
	"lengths" text DEFAULT '30' NOT NULL,
	"notice_hours" integer DEFAULT 24 NOT NULL,
	"horizon_weeks" integer DEFAULT 4 NOT NULL,
	"break_minutes" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busy_entries" ADD CONSTRAINT "busy_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busy_entries" ADD CONSTRAINT "busy_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_calendars" ADD CONSTRAINT "host_calendars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_hours" ADD CONSTRAINT "weekly_hours_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_host_idx" ON "bookings" USING btree ("host_id","stage");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id","stage");--> statement-breakpoint
CREATE INDEX "bookings_stage_idx" ON "bookings" USING btree ("stage");--> statement-breakpoint
CREATE UNIQUE INDEX "busy_entries_booking_user_uq" ON "busy_entries" USING btree ("booking_id","user_id");--> statement-breakpoint
CREATE INDEX "time_off_host_idx" ON "time_off" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "weekly_hours_host_idx" ON "weekly_hours" USING btree ("host_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_dedupe_key_unique" UNIQUE("dedupe_key");