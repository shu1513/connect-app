CREATE TABLE "spent_request_keys" (
	"customer_id" text NOT NULL,
	"request_key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spent_request_keys_customer_id_request_key_pk" PRIMARY KEY("customer_id","request_key")
);
--> statement-breakpoint
ALTER TABLE "spent_request_keys" ADD CONSTRAINT "spent_request_keys_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;