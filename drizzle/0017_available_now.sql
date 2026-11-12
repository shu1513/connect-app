ALTER TABLE "calls" ADD COLUMN "continues_call_id" uuid;--> statement-breakpoint
ALTER TABLE "host_profiles" ADD COLUMN "available_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_continues_call_id_calls_id_fk" FOREIGN KEY ("continues_call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_next_part_uq" ON "calls" USING btree ("continues_call_id") WHERE "calls"."cancelled_at" is null;