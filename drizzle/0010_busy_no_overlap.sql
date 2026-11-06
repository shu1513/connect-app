-- The rule behind "never two calls at once": the database itself refuses two
-- busy entries for the same person whose times overlap. A stretch includes its
-- start and not its end, so one call may start the moment another ends.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "busy_entries" ADD CONSTRAINT "busy_entries_positive" CHECK ("ends_at" > "starts_at");--> statement-breakpoint
ALTER TABLE "busy_entries" ADD CONSTRAINT "busy_entries_no_overlap"
  EXCLUDE USING gist ("user_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_positive" CHECK ("ends_at" > "starts_at");
