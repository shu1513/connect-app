CREATE TABLE "report_conversations" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reported_number" integer NOT NULL,
	"kept_count" integer NOT NULL,
	"older_left_out" integer DEFAULT 0 NOT NULL,
	"messages" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_switches" ALTER COLUMN "conversations_off" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "report_conversations" ADD CONSTRAINT "report_conversations_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_conversations" ADD CONSTRAINT "report_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Messages between hosts and customers are on from day one (plans/49-messaging.md, decision 31). Part 1 was merged
-- with them off; this turns them on, once. From here on only the founder moves this switch.
UPDATE "site_switches" SET "conversations_off" = false;
