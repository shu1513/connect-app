ALTER TABLE "contribution_refunds" DROP CONSTRAINT "contribution_refunds_status";--> statement-breakpoint
ALTER TABLE "contribution_refunds" ADD COLUMN "after_collection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_refunds" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "contribution_refund_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_contribution_refund_id_contribution_refunds_id_fk" FOREIGN KEY ("contribution_refund_id") REFERENCES "public"."contribution_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_contribution_refund_idx" ON "refunds" USING btree ("contribution_refund_id") WHERE "refunds"."contribution_refund_id" is not null;--> statement-breakpoint
ALTER TABLE "contribution_refunds" ADD CONSTRAINT "contribution_refunds_one_way" CHECK (not ("contribution_refunds"."connects_own" and "contribution_refunds"."after_collection"));--> statement-breakpoint
ALTER TABLE "contribution_refunds" ADD CONSTRAINT "contribution_refunds_failed_shape" CHECK (("contribution_refunds"."status" = 'failed') = ("contribution_refunds"."failed_at" is not null));--> statement-breakpoint
ALTER TABLE "contribution_refunds" ADD CONSTRAINT "contribution_refunds_status" CHECK ("contribution_refunds"."status" in ('owed', 'at_stripe', 'done', 'failed'));