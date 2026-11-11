-- Emails queued before delivery existed were never meant to be sent later (they were read on the
-- admin outbox page). Close them, so switching delivery on does not send a backlog, and drop the
-- login links they held.
UPDATE "email_outbox"
SET "status" = 'failed',
    "last_error" = 'written before delivery existed; not sent',
    "lease_until" = NULL,
    "body" = CASE WHEN "kind" IN ('confirm', 'reset') THEN '' ELSE "body" END
WHERE "status" = 'queued';
