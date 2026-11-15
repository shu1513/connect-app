CREATE TABLE "collection_items" (
	"collection_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"payout_fee_cents" integer NOT NULL,
	CONSTRAINT "collection_items_collection_id_payment_id_pk" PRIMARY KEY("collection_id","payment_id"),
	CONSTRAINT "collection_items_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"started_by" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_operation_id_money_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."money_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_items_payment_idx" ON "collection_items" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "collections_host_idx" ON "collections" USING btree ("host_id","accepted_at");