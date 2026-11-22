CREATE INDEX "email_outbox_provider_idx" ON "email_outbox" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "host_debts_notice_email_idx" ON "host_debts" USING btree ("notice_email_id");--> statement-breakpoint
CREATE INDEX "host_debts_answer_email_idx" ON "host_debts" USING btree ("answer_email_id");