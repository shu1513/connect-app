CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"host_id" text NOT NULL,
	"how" text NOT NULL,
	"call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unfollowed_at" timestamp with time zone,
	CONSTRAINT "follows_follower_id_host_id_pk" PRIMARY KEY("follower_id","host_id"),
	CONSTRAINT "follows_how" CHECK ("follows"."how" in ('self', 'call')),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."host_id")
);
--> statement-breakpoint
-- Calls from before following existed are never looked at: each is marked as decided. Done with a
-- default that is taken away again, so the table is not rewritten line by line while it is locked.
ALTER TABLE "calls" ADD COLUMN "follow_checked_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "calls" ALTER COLUMN "follow_checked_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_user_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_follow_due_idx" ON "calls" USING btree ("ends_at") WHERE "calls"."follow_checked_at" is null and "calls"."closed_at" is not null;