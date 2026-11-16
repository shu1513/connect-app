CREATE TABLE "bio_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text
);
--> statement-breakpoint
ALTER TABLE "bio_checks" ADD CONSTRAINT "bio_checks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bio_checks_user_idx" ON "bio_checks" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "bio_checks_network_idx" ON "bio_checks" USING btree ("network","started_at");