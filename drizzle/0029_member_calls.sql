ALTER TABLE "bookings" ADD COLUMN "month_id" uuid;--> statement-breakpoint
ALTER TABLE "call_extensions" ADD COLUMN "paid_from" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_hours" ADD COLUMN "members_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_month_id_membership_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."membership_months"("id") ON DELETE no action ON UPDATE no action;