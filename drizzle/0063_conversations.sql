CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"send_key" text NOT NULL,
	"woke" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_messages_body" CHECK (char_length("conversation_messages"."body") between 1 and 2000),
	CONSTRAINT "conversation_messages_number" CHECK ("conversation_messages"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"host_shown_number" integer DEFAULT 0 NOT NULL,
	"customer_shown_number" integer DEFAULT 0 NOT NULL,
	"host_last_wrote_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"customer_muted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_two_people" CHECK ("conversations"."host_id" <> "conversations"."customer_id")
);
--> statement-breakpoint
ALTER TABLE "site_switches" ADD COLUMN "conversations_off" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_number_uq" ON "conversation_messages" USING btree ("conversation_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_key_uq" ON "conversation_messages" USING btree ("conversation_id","sender_id","send_key");--> statement-breakpoint
CREATE INDEX "conversation_messages_sender_idx" ON "conversation_messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_pair_uq" ON "conversations" USING btree ("host_id","customer_id");--> statement-breakpoint
CREATE INDEX "conversations_customer_idx" ON "conversations" USING btree ("customer_id");