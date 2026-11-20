CREATE TABLE "suggestion_days" (
	"viewer_id" text NOT NULL,
	"day" text NOT NULL,
	"rule_version" integer NOT NULL,
	"made_at" timestamp with time zone NOT NULL,
	CONSTRAINT "suggestion_days_viewer_id_day_pk" PRIMARY KEY("viewer_id","day"),
	CONSTRAINT "suggestion_days_day" CHECK ("suggestion_days"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "suggestion_hides" (
	"viewer_id" text NOT NULL,
	"host_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_hides_viewer_id_host_id_pk" PRIMARY KEY("viewer_id","host_id"),
	CONSTRAINT "suggestion_hides_not_self" CHECK ("suggestion_hides"."viewer_id" <> "suggestion_hides"."host_id")
);
--> statement-breakpoint
CREATE TABLE "suggestion_shows" (
	"viewer_id" text NOT NULL,
	"day" text NOT NULL,
	"place" integer NOT NULL,
	"host_id" text NOT NULL,
	"kept" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "suggestion_shows_viewer_id_day_place_pk" PRIMARY KEY("viewer_id","day","place"),
	CONSTRAINT "suggestion_shows_place" CHECK ("suggestion_shows"."place" between 1 and 6)
);
--> statement-breakpoint
ALTER TABLE "suggestion_days" ADD CONSTRAINT "suggestion_days_viewer_id_user_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_hides" ADD CONSTRAINT "suggestion_hides_viewer_id_user_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_hides" ADD CONSTRAINT "suggestion_hides_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_shows" ADD CONSTRAINT "suggestion_shows_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_shows" ADD CONSTRAINT "suggestion_shows_day_fk" FOREIGN KEY ("viewer_id","day") REFERENCES "public"."suggestion_days"("viewer_id","day") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_shows_host_uq" ON "suggestion_shows" USING btree ("viewer_id","day","host_id");--> statement-breakpoint
CREATE INDEX "suggestion_shows_seen_idx" ON "suggestion_shows" USING btree ("host_id","seen_at") WHERE "suggestion_shows"."seen_at" is not null;