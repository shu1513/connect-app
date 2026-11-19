CREATE TABLE "contribution_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"version" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"agreed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "contribution_cards_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "contribution_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"origin_key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_percent_bps" integer NOT NULL,
	"fee_fixed_cents" integer NOT NULL,
	"fee_foreign_card_bps" integer NOT NULL,
	"intent_requested_at" timestamp with time zone,
	"intent_request" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"status" text DEFAULT 'to_pay' NOT NULL,
	"ended_how" text,
	"authorised_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone,
	"take_at" timestamp with time zone,
	"take_by" timestamp with time zone,
	"taken_at" timestamp with time zone,
	"taken_cents" integer,
	"card_step_expires_at" timestamp with time zone,
	"try" integer DEFAULT 1 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"next_try_at" timestamp with time zone,
	"give_up_at" timestamp with time zone,
	"needs_action" boolean DEFAULT false NOT NULL,
	"card_id" uuid,
	"card_country" text,
	"thirty_day_mark" boolean DEFAULT false NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"dispute" text DEFAULT 'none' NOT NULL,
	"founder_hold" text DEFAULT 'none' NOT NULL,
	"founder_by" text,
	"founder_at" timestamp with time zone,
	"founder_note" text,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_payments_origin_key_unique" UNIQUE("origin_key"),
	CONSTRAINT "contribution_payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "contribution_payments_status" CHECK ("contribution_payments"."status" in ('to_pay', 'held', 'taken', 'given_up')),
	CONSTRAINT "contribution_payments_dispute" CHECK ("contribution_payments"."dispute" in ('none', 'open', 'won', 'lost')),
	CONSTRAINT "contribution_payments_founder_hold" CHECK ("contribution_payments"."founder_hold" in ('none', 'held', 'released')),
	CONSTRAINT "contribution_payments_given_up_why" CHECK ("contribution_payments"."status" <> 'given_up' or "contribution_payments"."ended_how" is not null),
	CONSTRAINT "contribution_payments_taken_shape" CHECK (("contribution_payments"."status" = 'taken') = ("contribution_payments"."taken_at" is not null)),
	CONSTRAINT "contribution_payments_amounts" CHECK ("contribution_payments"."amount_cents" between 500 and 10000000 and "contribution_payments"."refunded_cents" >= 0 and "contribution_payments"."refunded_cents" <= coalesce("contribution_payments"."taken_cents", 0))
);
--> statement-breakpoint
CREATE TABLE "contribution_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_payment_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"decided_by" text NOT NULL,
	"decider_id" text,
	"reason" text NOT NULL,
	"connects_own" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'owed' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"stripe_refund_id" text,
	"last_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "contribution_refunds_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "contribution_refunds_status" CHECK ("contribution_refunds"."status" in ('owed', 'at_stripe', 'done')),
	CONSTRAINT "contribution_refunds_amount" CHECK ("contribution_refunds"."amount_cents" > 0),
	CONSTRAINT "contribution_refunds_decided_by" CHECK ("contribution_refunds"."decided_by" in ('host', 'founder', 'app'))
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"host_id" text NOT NULL,
	"contributor_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'card_step' NOT NULL,
	"request_key" text NOT NULL,
	"first_hold_at" timestamp with time zone,
	"last_written_month" integer DEFAULT 0 NOT NULL,
	"skipped_months" text DEFAULT '[]' NOT NULL,
	"switch_off_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_how" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributions_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "contributions_kind" CHECK ("contributions"."kind" in ('once', 'monthly')),
	CONSTRAINT "contributions_status" CHECK ("contributions"."status" in ('card_step', 'running', 'ended')),
	CONSTRAINT "contributions_amount" CHECK ("contributions"."amount_cents" between 500 and 10000000),
	CONSTRAINT "contributions_ended_shape" CHECK (("contributions"."status" = 'ended') = ("contributions"."ended_at" is not null)),
	CONSTRAINT "contributions_not_own" CHECK ("contributions"."host_id" <> "contributions"."contributor_id")
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_one_owner";--> statement-breakpoint
ALTER TABLE "money_operations" DROP CONSTRAINT "money_operations_one_owner";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_kind_shape";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "contribution_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "money_operations" ADD COLUMN "contribution_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "contribution_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "contribution_agreements" ADD CONSTRAINT "contribution_agreements_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_cards" ADD CONSTRAINT "contribution_cards_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payments" ADD CONSTRAINT "contribution_payments_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payments" ADD CONSTRAINT "contribution_payments_card_id_contribution_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."contribution_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payments" ADD CONSTRAINT "contribution_payments_founder_by_user_id_fk" FOREIGN KEY ("founder_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_refunds" ADD CONSTRAINT "contribution_refunds_contribution_payment_id_contribution_payments_id_fk" FOREIGN KEY ("contribution_payment_id") REFERENCES "public"."contribution_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_refunds" ADD CONSTRAINT "contribution_refunds_decider_id_user_id_fk" FOREIGN KEY ("decider_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_contributor_id_user_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_cards_in_use_uq" ON "contribution_cards" USING btree ("contribution_id") WHERE "contribution_cards"."retired_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_payments_number_uq" ON "contribution_payments" USING btree ("contribution_id","number");--> statement-breakpoint
CREATE INDEX "contribution_payments_status_idx" ON "contribution_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contribution_refunds_status_idx" ON "contribution_refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contribution_refunds_payment_idx" ON "contribution_refunds" USING btree ("contribution_payment_id");--> statement-breakpoint
CREATE INDEX "contributions_project_idx" ON "contributions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "contributions_host_idx" ON "contributions" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "contributions_contributor_idx" ON "contributions" USING btree ("contributor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_one_monthly_uq" ON "contributions" USING btree ("contributor_id","project_id") WHERE "contributions"."kind" = 'monthly' and "contributions"."status" <> 'ended';--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contribution_payment_id_contribution_payments_id_fk" FOREIGN KEY ("contribution_payment_id") REFERENCES "public"."contribution_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_contribution_payment_id_contribution_payments_id_fk" FOREIGN KEY ("contribution_payment_id") REFERENCES "public"."contribution_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contribution_payment_id_contribution_payments_id_fk" FOREIGN KEY ("contribution_payment_id") REFERENCES "public"."contribution_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_contribution_payment_idx" ON "ledger_entries" USING btree ("contribution_payment_id");--> statement-breakpoint
CREATE INDEX "money_operations_contribution_payment_idx" ON "money_operations" USING btree ("contribution_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_operations_contribution_payment_started_uq" ON "money_operations" USING btree ("contribution_payment_id") WHERE "money_operations"."status" = 'started' and "money_operations"."contribution_payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_contribution_payment_uq" ON "payments" USING btree ("contribution_payment_id") WHERE "payments"."contribution_payment_id" is not null;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_one_owner" CHECK (num_nonnulls("ledger_entries"."payment_id", "ledger_entries"."month_id", "ledger_entries"."contribution_payment_id") = 1);--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_one_owner" CHECK (num_nonnulls("money_operations"."payment_id", "money_operations"."month_id", "money_operations"."contribution_payment_id") = 1);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_shape" CHECK (("payments"."kind" = 'card' and "payments"."call_id" is not null and "payments"."month_id" is null and "payments"."contribution_payment_id" is null)
        or ("payments"."kind" = 'member_call' and "payments"."call_id" is not null and "payments"."month_id" is not null and "payments"."contribution_payment_id" is null)
        or ("payments"."kind" = 'member_expired' and "payments"."call_id" is null and "payments"."month_id" is not null and "payments"."contribution_payment_id" is null)
        or ("payments"."kind" = 'contribution' and "payments"."call_id" is null and "payments"."month_id" is null and "payments"."extension_id" is null and "payments"."contribution_payment_id" is not null
          and "payments"."stripe_payment_intent_id" is null and "payments"."price_per_15_cents" = 0 and "payments"."covers_from" = "payments"."covers_until"
          and "payments"."status" = 'charged' and "payments"."charged_cents" is not null and "payments"."charged_cents" = "payments"."booked_cents" and "payments"."charged_at" is not null));