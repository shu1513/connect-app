CREATE TABLE "host_notes" (
	"host_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_notes_host_id_customer_id_pk" PRIMARY KEY("host_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"rater_id" text NOT NULL,
	"rated_id" text NOT NULL,
	"rated_as" text NOT NULL,
	"stars" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_stars_range" CHECK ("ratings"."stars" between 1 and 5),
	CONSTRAINT "ratings_rated_as" CHECK ("ratings"."rated_as" in ('host', 'customer'))
);
--> statement-breakpoint
ALTER TABLE "host_notes" ADD CONSTRAINT "host_notes_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_notes" ADD CONSTRAINT "host_notes_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_user_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rated_id_user_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_call_rater_uq" ON "ratings" USING btree ("call_id","rater_id");--> statement-breakpoint
CREATE INDEX "ratings_rated_idx" ON "ratings" USING btree ("rated_id","rated_as");