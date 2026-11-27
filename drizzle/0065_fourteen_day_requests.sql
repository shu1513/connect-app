ALTER TABLE "memberships" ADD COLUMN "fourteen_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "fourteen_month_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "fourteen_admin_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "fourteen_request_day" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_fourteen_request" CHECK (("memberships"."fourteen_asked_at" is null) = ("memberships"."fourteen_month_id" is null) and ("memberships"."fourteen_admin_id" is null) = ("memberships"."fourteen_request_day" is null) and ("memberships"."fourteen_admin_id" is null or "memberships"."fourteen_asked_at" is not null));