ALTER TABLE "site_switches" ALTER COLUMN "memberships" SET DEFAULT 'everyone';--> statement-breakpoint
-- The founder's decision (18 November 2026): memberships are on for everyone. Until now the switch had only ever been "off"
-- because that was its default, never because the founder chose it, so a saved "off" is turned on here, once. A list of
-- named hosts is left as it is. From now on an "off" the founder saves stays off.
UPDATE "site_switches" SET "memberships" = 'everyone', "updated_at" = now() WHERE "memberships" = 'off';
