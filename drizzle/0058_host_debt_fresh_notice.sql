ALTER TABLE "host_debts" ADD COLUMN "notice_problems_told" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Take-backs from before delivery was recorded on each email: whether their notice arrived cannot be shown any more
-- (a bounce was only noted against the address, or only logged). They keep the day their notice named as the
-- earliest day, lose their link to that old email and their due day, and wait for the founder to send the notice
-- again; the app tells the founder so on its next pass. One that is being taken at this very moment is included: if
-- its request never reached Stripe, a late report about its old email must not let the helper send it now. (A
-- reversal Stripe already made is still found and recorded.)
UPDATE "host_debts" SET "notice_email_id" = NULL, "due_at" = NULL WHERE "status" IN ('told', 'objected', 'answered', 'taking');
