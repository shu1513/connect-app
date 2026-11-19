CREATE TABLE "host_photo_tries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"entry_name_key" text NOT NULL,
	"entry_account_id" text,
	"result" text,
	"sha256" text,
	"checked_by" text,
	"detail" text,
	"ended_at" timestamp with time zone,
	CONSTRAINT "host_photo_tries_network" CHECK ("host_photo_tries"."network" in ('instagram', 'tiktok')),
	CONSTRAINT "host_photo_tries_result" CHECK ("host_photo_tries"."result" is null or "host_photo_tries"."result" in ('shown', 'not_accepted', 'refused_before', 'no_picture', 'not_fetched', 'unusable', 'not_checked', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "host_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"network" text NOT NULL,
	"source_name_key" text NOT NULL,
	"source_account_id" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"checked_by" text NOT NULL,
	"rules_version" text NOT NULL,
	"check_detail" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"report_made_at" timestamp with time zone,
	"locked_context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_photos_network" CHECK ("host_photos"."network" in ('instagram', 'tiktok'))
);
--> statement-breakpoint
ALTER TABLE "host_photo_tries" ADD CONSTRAINT "host_photo_tries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_photos" ADD CONSTRAINT "host_photos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_photos" ADD CONSTRAINT "host_photos_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_photo_tries_user_idx" ON "host_photo_tries" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "host_photo_tries_bytes_idx" ON "host_photo_tries" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "host_photo_tries_network_idx" ON "host_photo_tries" USING btree ("network","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_photos_current_uq" ON "host_photos" USING btree ("user_id") WHERE "host_photos"."locked_at" is null;--> statement-breakpoint
CREATE INDEX "host_photos_user_idx" ON "host_photos" USING btree ("user_id");