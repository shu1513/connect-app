ALTER TABLE "host_debts" DROP CONSTRAINT "host_debts_status";--> statement-breakpoint
ALTER TABLE "host_debts" ALTER COLUMN "dispute_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "refund_id" uuid;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "repaid_cents" integer;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "settled_note" text;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "charge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "agreement_version" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "after_collection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "share_before_cents" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "share_after_cents" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "fee_before_cents" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "fee_after_cents" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "host_owes_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "debt_looked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_debts_refund_payment_uq" ON "host_debts" USING btree ("refund_id","payment_id");--> statement-breakpoint
CREATE INDEX "refunds_debt_look_idx" ON "refunds" USING btree ("finished_at") WHERE "refunds"."after_collection" and "refunds"."debt_looked_at" is null;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_one_cause" CHECK (num_nonnulls("host_debts"."dispute_id", "host_debts"."refund_id") = 1);--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_status" CHECK ("host_debts"."status" in ('told', 'objected', 'answered', 'cancelled', 'taking', 'taken', 'nothing', 'waiting', 'settled'));