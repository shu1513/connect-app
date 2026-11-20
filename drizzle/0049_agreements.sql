CREATE TABLE "agreement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"occasion" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreement_acceptances_occasion" CHECK ("agreement_acceptances"."occasion" in ('sign_up', 'new_version', 'host_application', 'host_new_version', 'identity_check'))
);
--> statement-breakpoint
ALTER TABLE "host_profiles" ADD COLUMN "decided_reason" text;--> statement-breakpoint
ALTER TABLE "host_profiles" ADD COLUMN "seller_kind" text;--> statement-breakpoint
ALTER TABLE "identity_checks" ADD COLUMN "notice_version" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_acceptances_one_uq" ON "agreement_acceptances" USING btree ("user_id","document","version");