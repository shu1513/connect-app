CREATE TABLE "picture_checkers" (
	"service" text PRIMARY KEY NOT NULL,
	"last_good_at" timestamp with time zone,
	"last_good_key" text,
	"out_until" timestamp with time zone,
	"fault_since" timestamp with time zone,
	"fault_detail" text,
	"fault_told_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_picture_files" (
	"picture_id" uuid PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_pictures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"host_id" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"level" text,
	"checked_by" text,
	"checked_at" timestamp with time zone,
	"rules_version" text,
	"check_detail" text,
	"refused_by_checker" boolean DEFAULT false NOT NULL,
	"child_check" text DEFAULT 'not_set_up' NOT NULL,
	"suspected_by_founder" boolean DEFAULT false NOT NULL,
	"suspected_by_report" boolean DEFAULT false NOT NULL,
	"claim_id" uuid,
	"claimed_until" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"report_made_at" timestamp with time zone,
	"locked_post" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_pictures_state" CHECK ("project_pictures"."state" in ('waiting', 'shown', 'refused', 'removed', 'locked')),
	CONSTRAINT "project_pictures_level" CHECK ("project_pictures"."level" is null or "project_pictures"."level" in ('full', 'nudity_only')),
	CONSTRAINT "project_pictures_shown_has_level" CHECK ("project_pictures"."state" <> 'shown' or "project_pictures"."level" is not null),
	CONSTRAINT "project_pictures_child_check" CHECK ("project_pictures"."child_check" in ('not_set_up', 'waiting', 'clear', 'match')),
	CONSTRAINT "project_pictures_locked_shape" CHECK (("project_pictures"."state" = 'locked') = ("project_pictures"."locked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "child_check_on_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_picture_files" ADD CONSTRAINT "project_picture_files_picture_id_project_pictures_id_fk" FOREIGN KEY ("picture_id") REFERENCES "public"."project_pictures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pictures" ADD CONSTRAINT "project_pictures_post_id_project_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."project_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pictures" ADD CONSTRAINT "project_pictures_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pictures" ADD CONSTRAINT "project_pictures_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_pictures_post_idx" ON "project_pictures" USING btree ("post_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "project_pictures_host_day_idx" ON "project_pictures" USING btree ("host_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "project_pictures_queue_idx" ON "project_pictures" USING btree ("state","next_try_at");--> statement-breakpoint
CREATE INDEX "project_pictures_bytes_idx" ON "project_pictures" USING btree ("host_id","sha256");