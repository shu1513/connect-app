CREATE TABLE "connection_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"room_closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "connection_tests" ADD CONSTRAINT "connection_tests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_tests_user_idx" ON "connection_tests" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "connection_tests_open_idx" ON "connection_tests" USING btree ("room_closed_at","started_at");