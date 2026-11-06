CREATE TABLE "payout_fees" (
	"host_id" text NOT NULL,
	"payday" timestamp with time zone NOT NULL,
	"payment_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "priced_through_event_id" integer;--> statement-breakpoint
ALTER TABLE "payout_fees" ADD CONSTRAINT "payout_fees_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_fees" ADD CONSTRAINT "payout_fees_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_fees_host_payday_uq" ON "payout_fees" USING btree ("host_id","payday");