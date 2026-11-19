ALTER TABLE "contribution_payments" DROP CONSTRAINT "contribution_payments_taken_shape";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_kind_shape";--> statement-breakpoint
ALTER TABLE "contribution_payments" ADD CONSTRAINT "contribution_payments_taken_shape" CHECK (("contribution_payments"."status" = 'taken') = ("contribution_payments"."taken_at" is not null) and ("contribution_payments"."taken_at" is null) = ("contribution_payments"."taken_cents" is null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_shape" CHECK (("payments"."kind" = 'card' and "payments"."call_id" is not null and "payments"."month_id" is null and "payments"."contribution_payment_id" is null)
        or ("payments"."kind" = 'member_call' and "payments"."call_id" is not null and "payments"."month_id" is not null and "payments"."contribution_payment_id" is null)
        or ("payments"."kind" = 'member_expired' and "payments"."call_id" is null and "payments"."month_id" is not null and "payments"."contribution_payment_id" is null)
        or ("payments"."kind" = 'contribution' and "payments"."call_id" is null and "payments"."month_id" is null and "payments"."extension_id" is null and "payments"."contribution_payment_id" is not null
          and "payments"."stripe_payment_intent_id" is null and "payments"."price_per_15_cents" = 0 and "payments"."covers_from" = "payments"."covers_until"
          and "payments"."status" = 'charged' and "payments"."charged_cents" is not null and "payments"."charged_cents" = "payments"."booked_cents" and "payments"."charged_at" is not null
          and "payments"."covers_from" = "payments"."charged_at" and "payments"."original_fee_cents" is not null and "payments"."original_host_share_cents" is not null
          and "payments"."original_fee_cents" + "payments"."original_host_share_cents" = "payments"."charged_cents" and "payments"."stripe_charge_id" is not null));