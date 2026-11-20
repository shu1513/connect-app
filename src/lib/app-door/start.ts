/**
 * What the phone app is told when it opens (plans/45-phone-apps/01-the-door.md): whether this copy
 * must update, what is switched on for the apps, and who is logged in.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Switches } from "@/lib/safety/switches";
import type { SignedIn } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/terms";
import { isTooOld, type AppClient } from "./rules";
import type { AppStart, AppSwitches } from "./types";

/**
 * What is on for the apps, as the app is told it. The website's own switches rule first: a thing
 * the founder has switched off for everyone is off in the apps whatever the apps' switch says.
 *
 * Tips: there are no tips on `main` yet (plans/44). Until there are, and until the website's own
 * tip switch is read here beside the apps', tips are off for the apps whatever is saved.
 */
export function switchesForApps(all: Switches): AppSwitches {
  return {
    memberships: all.memberships === "off" ? "off" : all.appMemberships,
    tips: false,
    availableNow: all.appAvailableNow && !all.requestsOff,
  };
}

/** The answer of GET /api/app/start. `person` is whoever is logged in; a closed account counts as nobody. */
export async function startFor(client: AppClient, person: SignedIn | null, all: Switches): Promise<AppStart> {
  const base = { updateNeeded: isTooOld(client.version, all.appOldestVersion), switches: switchesForApps(all), termsVersion: TERMS_VERSION };
  if (!person) return { ...base, me: null };
  const [profile] = await db
    .select({ status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden })
    .from(schema.hostProfiles)
    .where(eq(schema.hostProfiles.userId, person.id));
  return {
    ...base,
    me: {
      id: person.id,
      name: person.name,
      email: person.email,
      timeZone: person.timeZone,
      paused: person.paused,
      next: person.welcomed ? null : "welcome",
      host: profile ? { status: profile.status, hidden: profile.hidden } : null,
    },
  };
}
