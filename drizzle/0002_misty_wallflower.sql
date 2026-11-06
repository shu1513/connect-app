CREATE TABLE "admins" (
	"user_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_account_id" text,
	"payouts_ready" boolean DEFAULT false NOT NULL,
	"payouts_checked_at" timestamp with time zone,
	"free_cancel_minutes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_settings_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"stripe_ref" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"params" text NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"stripe_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "money_operations_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"price_per_15_cents" integer NOT NULL,
	"booked_cents" integer NOT NULL,
	"fee_percent_bps" integer NOT NULL,
	"fee_fixed_cents" integer NOT NULL,
	"fee_foreign_card_bps" integer NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"flagged_after_charge" boolean DEFAULT false NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"held_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone,
	"card_country" text,
	"frozen_host_seconds" integer,
	"frozen_customer_seconds" integer,
	"frozen_together_seconds" integer,
	"charged_cents" integer,
	"charge_reason" text,
	"charged_at" timestamp with time zone,
	"original_fee_cents" integer,
	"original_host_share_cents" integer,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"transfer_status" text DEFAULT 'not_due' NOT NULL,
	"transfer_due_at" timestamp with time zone,
	"transfer_cents" integer,
	"payout_fee_cents" integer,
	"stripe_transfer_id" text,
	"transferred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_call_id_unique" UNIQUE("call_id"),
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"decided_by" text NOT NULL,
	"decided_as" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"stripe_refund_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stripe_customers" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "price_per_15_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "free_cancel_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_settings" ADD CONSTRAINT "host_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_payment_idx" ON "ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "money_operations_payment_idx" ON "money_operations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "money_operations_status_idx" ON "money_operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_transfer_idx" ON "payments" USING btree ("transfer_status");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");