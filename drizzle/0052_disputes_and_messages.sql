CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" uuid,
	"month_id" uuid,
	"contribution_payment_id" uuid,
	"host_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"reason" text NOT NULL,
	"compliance" boolean DEFAULT false NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"due_by" timestamp with time zone,
	"no_answer" boolean DEFAULT false NOT NULL,
	"look_again" boolean DEFAULT false NOT NULL,
	"outcome" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_one_owner" CHECK (num_nonnulls("disputes"."payment_id", "disputes"."month_id", "disputes"."contribution_payment_id") = 1),
	CONSTRAINT "disputes_stage" CHECK ("disputes"."stage" in ('question', 'chargeback')),
	CONSTRAINT "disputes_outcome" CHECK ("disputes"."outcome" is null or "disputes"."outcome" in ('won', 'lost', 'closed')),
	CONSTRAINT "disputes_ended_shape" CHECK (("disputes"."outcome" is null) = ("disputes"."ended_at" is null))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"path" text,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "messages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_month_id_membership_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."membership_months"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_contribution_payment_id_contribution_payments_id_fk" FOREIGN KEY ("contribution_payment_id") REFERENCES "public"."contribution_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_payment_idx" ON "disputes" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "disputes_month_idx" ON "disputes" USING btree ("month_id");--> statement-breakpoint
CREATE INDEX "disputes_contribution_payment_idx" ON "disputes" USING btree ("contribution_payment_id");--> statement-breakpoint
CREATE INDEX "disputes_host_idx" ON "disputes" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "disputes_customer_idx" ON "disputes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "disputes_open_idx" ON "disputes" USING btree ("updated_at") WHERE "disputes"."outcome" is null;--> statement-breakpoint
CREATE INDEX "disputes_look_again_idx" ON "disputes" USING btree ("updated_at") WHERE "disputes"."look_again";--> statement-breakpoint
CREATE INDEX "messages_user_idx" ON "messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_unread_idx" ON "messages" USING btree ("user_id") WHERE "messages"."read_at" is null;