CREATE TABLE "host_debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"host_id" text NOT NULL,
	"stripe_transfer_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"basis" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'told' NOT NULL,
	"told_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"stripe_reversal_id" text,
	"taken_at" timestamp with time zone,
	"refusal" text,
	"refused_at" timestamp with time zone,
	"first_refused_at" timestamp with time zone,
	"founder_told_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"leftover_told_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_debts_status" CHECK ("host_debts"."status" in ('told', 'cancelled', 'taking', 'taken', 'nothing')),
	CONSTRAINT "host_debts_amount" CHECK ("host_debts"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_debts" ADD CONSTRAINT "host_debts_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_debts_dispute_payment_uq" ON "host_debts" USING btree ("dispute_id","payment_id");--> statement-breakpoint
CREATE INDEX "host_debts_payment_idx" ON "host_debts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "host_debts_host_idx" ON "host_debts" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "host_debts_due_idx" ON "host_debts" USING btree ("due_at") WHERE "host_debts"."status" = 'told';