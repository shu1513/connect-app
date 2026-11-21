ALTER TABLE "disputes" ADD COLUMN "stage_began_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "ask_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "choice" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "chosen_as" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "chosen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "answer" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "answer_kind" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "answer_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "answer_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "answer_error" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "proof" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "stage_history" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "paying_allowed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "paying_allowed_by" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_paying_allowed_by_user_id_fk" FOREIGN KEY ("paying_allowed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_choice" CHECK ("disputes"."choice" is null or "disputes"."choice" in ('fight', 'give_back'));--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_answer" CHECK ("disputes"."answer" in ('none', 'sending', 'proof', 'given_in', 'not_ours', 'unknown'));