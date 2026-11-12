ALTER TABLE "calls" ADD COLUMN "billing" text DEFAULT 'host' NOT NULL;--> statement-breakpoint
ALTER TABLE "host_calendars" ADD COLUMN "available_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_calendars" ADD COLUMN "available_seen_at" timestamp with time zone;