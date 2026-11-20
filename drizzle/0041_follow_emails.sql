ALTER TABLE "follows" ADD COLUMN "tell_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "follows" ADD COLUMN "tell_posts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "follows" ADD COLUMN "hours_from" integer;--> statement-breakpoint
ALTER TABLE "follows" ADD COLUMN "hours_to" integer;--> statement-breakpoint
ALTER TABLE "follows" ADD COLUMN "told_online_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follows" ADD COLUMN "told_post_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_calendars" ADD COLUMN "announce_at" timestamp with time zone;--> statement-breakpoint
-- Posts from before these emails existed are never announced: each is marked as dealt with. Done with a
-- default that is taken away again, so the table is not rewritten line by line while it is locked.
ALTER TABLE "project_posts" ADD COLUMN "announced_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "project_posts" ALTER COLUMN "announced_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "follow_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "follows_host_idx" ON "follows" USING btree ("host_id") WHERE "follows"."unfollowed_at" is null;--> statement-breakpoint
CREATE INDEX "project_posts_to_announce_idx" ON "project_posts" USING btree ("created_at") WHERE "project_posts"."announced_at" is null;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_hours" CHECK (("follows"."hours_from" is null) = ("follows"."hours_to" is null));