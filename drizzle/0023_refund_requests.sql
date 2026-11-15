CREATE TABLE "refund_request_answers" (
	"request_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"choice" text NOT NULL,
	"max_cents" integer,
	CONSTRAINT "refund_request_answers_request_id_payment_id_pk" PRIMARY KEY("request_id","payment_id")
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"summary" text,
	"asked_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'asked' NOT NULL,
	"decided_by" text,
	"decided_as" text,
	"decided_at" timestamp with time zone,
	"message" text,
	CONSTRAINT "refund_requests_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "record_cents" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "lowered_by" text;--> statement-breakpoint
ALTER TABLE "refund_request_answers" ADD CONSTRAINT "refund_request_answers_request_id_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."refund_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request_answers" ADD CONSTRAINT "refund_request_answers_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;