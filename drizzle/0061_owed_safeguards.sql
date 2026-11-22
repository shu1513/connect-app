CREATE TABLE "hand_reversals" (
	"stripe_reversal_id" text PRIMARY KEY NOT NULL,
	"stripe_transfer_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"debt_id" uuid,
	"amount_cents" integer NOT NULL,
	"counted_cents" integer DEFAULT 0 NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "cost_booked_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "by_hand_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "host_debts" ADD COLUMN "hand_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "after_collection_no" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failed_late_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hand_reversals" ADD CONSTRAINT "hand_reversals_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_reversals" ADD CONSTRAINT "hand_reversals_debt_id_host_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."host_debts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_reversals" ADD CONSTRAINT "hand_reversals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hand_reversals_transfer_idx" ON "hand_reversals" USING btree ("stripe_transfer_id");--> statement-breakpoint
CREATE INDEX "hand_reversals_payment_idx" ON "hand_reversals" USING btree ("payment_id");