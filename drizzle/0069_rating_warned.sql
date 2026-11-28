ALTER TABLE "user" ADD COLUMN "rating_warned_at" timestamp with time zone;--> statement-breakpoint
-- A pause that a person lifted before this existed is a fresh start too (plans/52, decision 8): the moment of the
-- last "pause lifted" in the admins' record becomes the account's auto_pause_from, so that nothing reported or
-- rated before a person looked can pause the account by itself. (The earlier "Lift the pause" also wrote such a
-- line when it was pressed on an account that was not paused. Such a line can only make the fresh start later
-- than it really was, which leaves out more, never less: the safe side for a pause nobody decides.)
UPDATE "user" u SET "auto_pause_from" = l.at
FROM (SELECT "target_user_id", max("created_at") AS at FROM "admin_actions" WHERE "action" = 'pause lifted' AND "target_user_id" IS NOT NULL GROUP BY "target_user_id") l
WHERE u."id" = l."target_user_id" AND (u."auto_pause_from" IS NULL OR u."auto_pause_from" < l.at);
