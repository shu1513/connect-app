-- Memberships, part one (plans/19-memberships.md is the rulebook; plans/20 says how this part is built).
-- New: the membership tables. Changed: a payment gets a kind and may belong to a month instead of a
-- call; a money action and a line of the money record may be owned by a month instead of a payment;
-- the founder's switch for memberships. Every existing row satisfies every new check: all payments
-- are of the kind "card" with a call, and every action and line has a payment.
CREATE TABLE "booking_cards" (
	"stripe_payment_method_id" text PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "membership_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"offer_version" integer NOT NULL,
	"price_per_15_cents" integer NOT NULL,
	"minutes" integer NOT NULL,
	"card_wording_version" text,
	"first_month_number" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "membership_agreements_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "membership_agreements_kind" CHECK ("membership_agreements"."kind" in ('joined', 'resumed', 'less_time', 'price_lowered'))
);
--> statement-breakpoint
CREATE TABLE "membership_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "membership_cards_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "membership_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"invite_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"outcome" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "membership_invitations_invite_id_unique" UNIQUE("invite_id")
);
--> statement-breakpoint
CREATE TABLE "membership_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"period" integer NOT NULL,
	"number" integer NOT NULL,
	"agreement_id" uuid NOT NULL,
	"origin_key" text NOT NULL,
	"price_per_15_cents" integer NOT NULL,
	"included_minutes" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"fee_percent_bps" integer NOT NULL,
	"fee_fixed_cents" integer NOT NULL,
	"fee_foreign_card_bps" integer NOT NULL,
	"status" text DEFAULT 'to_pay' NOT NULL,
	"ended_how" text,
	"problem" text,
	"card_step_expires_at" timestamp with time zone,
	"intent_requested_at" timestamp with time zone,
	"intent_request" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"card_id" uuid,
	"card_country" text,
	"authorised_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"take_at" timestamp with time zone,
	"taken_at" timestamp with time zone,
	"taken_cents" integer,
	"try" integer DEFAULT 1 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"next_try_at" timestamp with time zone,
	"give_up_at" timestamp with time zone,
	"needs_action" boolean DEFAULT false NOT NULL,
	"free_cents" integer DEFAULT 0 NOT NULL,
	"set_aside_cents" integer DEFAULT 0 NOT NULL,
	"used_cents" integer DEFAULT 0 NOT NULL,
	"expired_cents" integer DEFAULT 0 NOT NULL,
	"to_pay_back_cents" integer DEFAULT 0 NOT NULL,
	"paid_back_cents" integer DEFAULT 0 NOT NULL,
	"host_caused_cents" integer DEFAULT 0 NOT NULL,
	"fixed_fee_placed" boolean DEFAULT false NOT NULL,
	"dispute" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_months_origin_key_unique" UNIQUE("origin_key"),
	CONSTRAINT "membership_months_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "membership_months_status" CHECK ("membership_months"."status" in ('to_pay', 'held', 'running', 'closed', 'finished', 'given_up')),
	CONSTRAINT "membership_months_dispute" CHECK ("membership_months"."dispute" in ('none', 'open', 'won', 'lost')),
	CONSTRAINT "membership_months_given_up_why" CHECK ("membership_months"."status" <> 'given_up' or "membership_months"."ended_how" is not null),
	CONSTRAINT "membership_months_not_negative" CHECK ("membership_months"."free_cents" >= 0 and "membership_months"."set_aside_cents" >= 0 and "membership_months"."used_cents" >= 0 and "membership_months"."expired_cents" >= 0 and "membership_months"."to_pay_back_cents" >= 0 and "membership_months"."paid_back_cents" >= 0 and "membership_months"."host_caused_cents" >= 0 and "membership_months"."total_cents" > 0),
	CONSTRAINT "membership_months_places_add_up" CHECK (("membership_months"."status" in ('running', 'closed', 'finished') and "membership_months"."free_cents" + "membership_months"."set_aside_cents" + "membership_months"."used_cents" + "membership_months"."expired_cents" + "membership_months"."to_pay_back_cents" + "membership_months"."paid_back_cents" = "membership_months"."total_cents")
        or ("membership_months"."status" in ('to_pay', 'held', 'given_up') and "membership_months"."free_cents" + "membership_months"."set_aside_cents" + "membership_months"."used_cents" + "membership_months"."expired_cents" + "membership_months"."to_pay_back_cents" + "membership_months"."paid_back_cents" = 0)),
	CONSTRAINT "membership_months_host_caused_in_free" CHECK ("membership_months"."host_caused_cents" <= "membership_months"."free_cents")
);
--> statement-breakpoint
CREATE TABLE "membership_offers" (
	"host_id" text PRIMARY KEY NOT NULL,
	"on" boolean DEFAULT false NOT NULL,
	"price_per_15_cents" integer NOT NULL,
	"included_minutes" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_offers_price" CHECK ("membership_offers"."price_per_15_cents" >= 500),
	CONSTRAINT "membership_offers_minutes" CHECK ("membership_offers"."included_minutes" between 30 and 6000 and "membership_offers"."included_minutes" % 30 = 0)
);
--> statement-breakpoint
CREATE TABLE "membership_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"payment_id" uuid,
	"status" text DEFAULT 'owed' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"stripe_refund_id" text,
	"last_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "membership_refunds_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "membership_refunds_status" CHECK ("membership_refunds"."status" in ('owed', 'at_stripe', 'done')),
	CONSTRAINT "membership_refunds_amount" CHECK ("membership_refunds"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text NOT NULL,
	"period" integer DEFAULT 0 NOT NULL,
	"current_month_id" uuid,
	"since" timestamp with time zone,
	"own_price_per_15_cents" integer,
	"own_minutes" integer,
	"agreement_id" uuid,
	"member_stopped_at" timestamp with time zone,
	"host_stopped_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"ended_reason" text,
	"cleanup_done_at" timestamp with time zone,
	"invite_id" uuid,
	"invited_at" timestamp with time zone,
	"invite_expires_at" timestamp with time zone,
	"invite_offer_version" integer,
	"invite_minutes" integer,
	"offer_id" uuid,
	"offer_month_id" uuid,
	"offered_minutes" integer,
	"offered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_status" CHECK ("memberships"."status" in ('invited', 'joining', 'active', 'unpaid', 'paused', 'ended'))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "money_operations" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "call_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "month_id" uuid;--> statement-breakpoint
ALTER TABLE "money_operations" ADD COLUMN "month_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "month_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "host_caused_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "memberships" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "memberships_hosts" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_cards" ADD CONSTRAINT "booking_cards_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_agreements" ADD CONSTRAINT "membership_agreements_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_cards" ADD CONSTRAINT "membership_cards_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_months" ADD CONSTRAINT "membership_months_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_months" ADD CONSTRAINT "membership_months_agreement_id_membership_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."membership_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_months" ADD CONSTRAINT "membership_months_card_id_membership_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."membership_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_offers" ADD CONSTRAINT "membership_offers_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_refunds" ADD CONSTRAINT "membership_refunds_month_id_membership_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."membership_months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_refunds" ADD CONSTRAINT "membership_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_agreements_membership_idx" ON "membership_agreements" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_cards_in_use_uq" ON "membership_cards" USING btree ("membership_id") WHERE "membership_cards"."retired_at" is null;--> statement-breakpoint
CREATE INDEX "membership_invitations_pair_idx" ON "membership_invitations" USING btree ("host_id","customer_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_months_number_uq" ON "membership_months" USING btree ("membership_id","number");--> statement-breakpoint
CREATE INDEX "membership_months_membership_idx" ON "membership_months" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "membership_months_status_idx" ON "membership_months" USING btree ("status");--> statement-breakpoint
CREATE INDEX "membership_refunds_status_idx" ON "membership_refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "membership_refunds_month_idx" ON "membership_refunds" USING btree ("month_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_live_pair_uq" ON "memberships" USING btree ("host_id","customer_id") WHERE "memberships"."status" <> 'ended';--> statement-breakpoint
CREATE INDEX "memberships_customer_idx" ON "memberships" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "memberships_host_status_idx" ON "memberships" USING btree ("host_id","status");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_month_id_membership_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."membership_months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_month_id_membership_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."membership_months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_month_id_membership_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."membership_months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_month_idx" ON "ledger_entries" USING btree ("month_id");--> statement-breakpoint
CREATE INDEX "money_operations_month_idx" ON "money_operations" USING btree ("month_id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_operations_payment_started_uq" ON "money_operations" USING btree ("payment_id") WHERE "money_operations"."status" = 'started' and "money_operations"."payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "money_operations_month_started_uq" ON "money_operations" USING btree ("month_id") WHERE "money_operations"."status" = 'started' and "money_operations"."month_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_month_idx" ON "payments" USING btree ("month_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_expired_month_uq" ON "payments" USING btree ("month_id") WHERE "payments"."kind" = 'member_expired';--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_one_owner" CHECK (("ledger_entries"."payment_id" is null) <> ("ledger_entries"."month_id" is null));--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_one_owner" CHECK (("money_operations"."payment_id" is null) <> ("money_operations"."month_id" is null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_shape" CHECK (("payments"."kind" = 'card' and "payments"."call_id" is not null and "payments"."month_id" is null)
        or ("payments"."kind" = 'member_call' and "payments"."call_id" is not null and "payments"."month_id" is not null)
        or ("payments"."kind" = 'member_expired' and "payments"."call_id" is null and "payments"."month_id" is not null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_host_caused_range" CHECK ("payments"."host_caused_cents" >= 0);