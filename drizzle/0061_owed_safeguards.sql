CREATE TABLE "hand_reversal_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_reversal_id" text NOT NULL,
	"stripe_transfer_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"debt_id" uuid,
	"cents" integer NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hand_reversal_counts_kind" CHECK ("hand_reversal_counts"."kind" in ('paid', 'twice', 'other')),
	CONSTRAINT "hand_reversal_counts_cents" CHECK ("hand_reversal_counts"."cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "cost_booked_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "by_hand_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "overpaid_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "hand_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "after_collection_no" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failed_late_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "undo_pending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hand_reversal_counts" ADD CONSTRAINT "hand_reversal_counts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_reversal_counts" ADD CONSTRAINT "hand_reversal_counts_debt_id_host_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."host_debts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_reversal_counts" ADD CONSTRAINT "hand_reversal_counts_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hand_reversal_counts_reversal_idx" ON "hand_reversal_counts" USING btree ("stripe_reversal_id");--> statement-breakpoint
CREATE INDEX "hand_reversal_counts_payment_idx" ON "hand_reversal_counts" USING btree ("payment_id");--> statement-breakpoint
-- Rows written before these columns existed (by the first build of this part): the refunds a payment had after its
-- share was sent get their places, in the order they were confirmed; and a cost of Connect's that a waiver or a
-- settlement of a refund's take-back had already booked is written on its row. A lost dispute's take-back that was
-- called off before this change never booked a cost, so it stays at nothing.
UPDATE "refunds" r SET "after_collection_no" = s.n
FROM (SELECT "id", row_number() OVER (PARTITION BY "payment_id" ORDER BY "finished_at", "id") AS n FROM "refunds" WHERE "after_collection" AND "status" = 'done') s
WHERE r."id" = s."id" AND r."after_collection_no" IS NULL;--> statement-breakpoint
UPDATE "host_debts" SET "cost_booked_cents" = "amount_cents" WHERE "refund_id" IS NOT NULL AND "status" = 'cancelled' AND "cancelled_by" IS NOT NULL AND "cost_booked_cents" = 0;--> statement-breakpoint
UPDATE "host_debts" SET "cost_booked_cents" = "amount_cents" - coalesce("repaid_cents", 0) WHERE "refund_id" IS NOT NULL AND "status" = 'settled' AND "cost_booked_cents" = 0;
