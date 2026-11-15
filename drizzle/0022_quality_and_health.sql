CREATE TABLE "helper_beats" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"call_id" uuid NOT NULL,
	"reporter_id" text NOT NULL,
	"about_id" text NOT NULL,
	"grade" text NOT NULL,
	"connection_id" text NOT NULL,
	"seq" integer NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quality_notes" ADD CONSTRAINT "quality_notes_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_notes" ADD CONSTRAINT "quality_notes_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_notes" ADD CONSTRAINT "quality_notes_about_id_user_id_fk" FOREIGN KEY ("about_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quality_notes_once_uq" ON "quality_notes" USING btree ("call_id","reporter_id","connection_id","seq");