ALTER TABLE "site_switches" ADD COLUMN "app_memberships" text DEFAULT 'on' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "app_tips" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "app_available_now" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "app_oldest_version" text DEFAULT '' NOT NULL;