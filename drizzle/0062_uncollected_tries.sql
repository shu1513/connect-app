CREATE TABLE "uncollected_tries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"uncollected_since" timestamp with time zone NOT NULL,
	"outcome" text,
	"reason" text,
	"ended_at" timestamp with time zone,
	"told_at" timestamp with time zone,
	CONSTRAINT "uncollected_tries_outcome" CHECK ("uncollected_tries"."outcome" is null or "uncollected_tries"."outcome" in ('collected', 'nothing'))
);
--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "started_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "started_as" text GENERATED ALWAYS AS (case when started_by is null then 'helper' when started_by = host_id then 'host' else 'founder' end) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "uncollected_tries" ADD CONSTRAINT "uncollected_tries_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uncollected_tries_host_idx" ON "uncollected_tries" USING btree ("host_id","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uncollected_tries_open_idx" ON "uncollected_tries" USING btree ("host_id") WHERE "uncollected_tries"."outcome" is null;--> statement-breakpoint
CREATE INDEX "uncollected_tries_untold_idx" ON "uncollected_tries" USING btree ("claimed_at") WHERE "uncollected_tries"."outcome" = 'collected' and "uncollected_tries"."told_at" is null;