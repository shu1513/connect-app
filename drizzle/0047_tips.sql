ALTER TABLE "contribution_payments" DROP CONSTRAINT "contribution_payments_amounts";--> statement-breakpoint
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_kind";--> statement-breakpoint
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_amount";--> statement-breakpoint
ALTER TABLE "contributions" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "call_id" uuid;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "tip_cents" integer;--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "tips_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributions_call_idx" ON "contributions" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_one_tip_uq" ON "contributions" USING btree ("call_id") WHERE "contributions"."kind" = 'tip' and ("contributions"."status" <> 'ended' or "contributions"."ended_how" = 'paid');--> statement-breakpoint
ALTER TABLE "contribution_payments" ADD CONSTRAINT "contribution_payments_amounts" CHECK ("contribution_payments"."amount_cents" between 200 and 10000000 and "contribution_payments"."refunded_cents" >= 0 and "contribution_payments"."refunded_cents" <= coalesce("contribution_payments"."taken_cents", 0));--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_tip_shape" CHECK (("contributions"."kind" = 'tip') = ("contributions"."call_id" is not null) and ("contributions"."kind" = 'tip') = ("contributions"."tip_cents" is not null) and ("contributions"."kind" = 'tip') = ("contributions"."project_id" is null));--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_kind" CHECK ("contributions"."kind" in ('once', 'monthly', 'tip'));--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_amount" CHECK ("contributions"."amount_cents" <= 10000000 and (("contributions"."kind" = 'tip' and "contributions"."tip_cents" >= 200 and "contributions"."amount_cents" > "contributions"."tip_cents") or ("contributions"."kind" <> 'tip' and "contributions"."amount_cents" >= 500)));