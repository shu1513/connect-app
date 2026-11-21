ALTER TABLE "host_debts" DROP CONSTRAINT "host_debts_status";--> statement-breakpoint
DROP INDEX "host_debts_due_idx";--> statement-breakpoint
ALTER TABLE "host_debts" ALTER COLUMN "due_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "first_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "notice_email_id" uuid;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "notice_problem_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "objected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "objection" text;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "answer_email_id" uuid;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "answered_by" text;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_notice_email_id_email_outbox_id_fk" FOREIGN KEY ("notice_email_id") REFERENCES "public"."email_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_answer_email_id_email_outbox_id_fk" FOREIGN KEY ("answer_email_id") REFERENCES "public"."email_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_debts_due_idx" ON "host_debts" USING btree ("due_at") WHERE "host_debts"."status" in ('told', 'answered');--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_status" CHECK ("host_debts"."status" in ('told', 'objected', 'answered', 'cancelled', 'taking', 'taken', 'nothing'));--> statement-breakpoint
-- The debts there are keep the due day their notice named. They learn which email carried that notice (by the key
-- the notice was written under), and keep the day as the first due day.
UPDATE "host_debts" d SET "first_due_at" = d."due_at", "notice_email_id" = (SELECT e."id" FROM "email_outbox" e WHERE e."dedupe_key" = 'takeback:' || d."id"::text || ':owed:host:' || d."host_id");
