ALTER TABLE "calls" ADD COLUMN "ended_now_by" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "end_report_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "end_report_effect" text;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_ended_now_by" CHECK ("calls"."ended_now_by" is null or ("calls"."ended_now_by" in ('host', 'customer', 'customer_untold') and "calls"."safety_ended_at" is not null and "calls"."safety_ended_by" is not null));--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_end_report" CHECK (("calls"."end_report_effect" is null and "calls"."end_report_at" is null)
        or ("calls"."end_report_effect" in ('minutes', 'minutes_uncounted', 'whole') and "calls"."end_report_at" is not null and "calls"."ended_now_by" = 'customer'));