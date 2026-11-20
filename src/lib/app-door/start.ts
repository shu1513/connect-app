/**
 * What the phone app is told when it opens (plans/45-phone-apps/01-the-door.md): whether this copy
 * must update, what is switched on for the apps, and who is logged in.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Switches } from "@/lib/safety/switches";
import { generalStamp } from "@/legal/versions";
import { SUPPORT_EMAIL } from "@/lib/terms";
import type { AppRequest } from "./gate";
import type { AppStart, AppSwitches } from "./types";

/**
 * What is on for the apps, as the app is told it. The website's own switches rule first: a thing
 * the founder has switched off for everyone is off in the apps whatever the apps' switch says.
 * (Memberships named for certain hosts only are decided host by host, where a host is shown.)
 *
 * Tips reach the apps only when two switches are on: the website's own tip switch (plans/44,
 * decision 12: off there is off everywhere) and the apps' own, which is born off and stays off
 * until a store has said that a tip after a one-to-one call may be paid outside its own payment
 * (plans/44, decision 18). The app is told afresh each time it opens: nothing about tips is
 * built into the app, so either switch works without a new version of it.
 */
export function switchesForApps(all: Switches): AppSwitches {
  return {
    memberships: all.memberships === "off" ? "off" : all.appMemberships,
    tips: !all.tipsOff && all.appTips,
    availableNow: all.appAvailableNow && !all.requestsOff,
  };
}

/** The answer of GET /api/app/start, for whoever the gate let in. */
export async function startFor(asked: AppRequest): Promise<AppStart> {
  const { person } = asked;
  // The stamp of the general documents in effect at this moment (plans/46, decision 5), not the one from when the server started.
  const base = { updateNeeded: asked.updateNeeded, switches: switchesForApps(asked.switches), termsVersion: generalStamp(new Date()), supportEmail: SUPPORT_EMAIL };
  if (!person) return { ...base, me: null };
  const [[profile], [own]] = await Promise.all([
    db.select({ status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, person.id)),
    // Why the account is paused, as the website's own page for a paused person shows it. Asked only for someone who is.
    person.paused ? db.select({ pausedReason: schema.user.pausedReason }).from(schema.user).where(eq(schema.user.id, person.id)) : [],
  ]);
  return {
    ...base,
    me: {
      id: person.id,
      name: person.name,
      email: person.email,
      timeZone: person.timeZone,
      paused: person.paused,
      pausedReason: person.paused ? (own?.pausedReason ?? null) : null,
      next: person.welcomed ? null : "welcome",
      host: profile ? { status: profile.status, hidden: profile.hidden } : null,
    },
  };
}
