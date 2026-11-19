CREATE TABLE "project_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"text" text NOT NULL,
	"links" text DEFAULT '' NOT NULL,
	"removed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" text,
	"hidden_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_status" CHECK ("projects"."status" in ('running', 'ended')),
	CONSTRAINT "projects_ended_shape" CHECK (("projects"."status" = 'running') = ("projects"."ended_at" is null))
);
--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "projects" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "projects_hosts" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_posts" ADD CONSTRAINT "project_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_posts" ADD CONSTRAINT "project_posts_hidden_by_user_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_posts_project_idx" ON "project_posts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_one_running_uq" ON "projects" USING btree ("host_id") WHERE "projects"."status" = 'running';--> statement-breakpoint
CREATE INDEX "projects_host_idx" ON "projects" USING btree ("host_id","started_at");