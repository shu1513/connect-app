"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { membershipFor } from "@/lib/membership/access";
import { payNow } from "@/lib/membership/charge";
import { join, resume } from "@/lib/membership/join";
import { MembershipError } from "@/lib/membership/rules";
import { withNotice } from "@/lib/notice";
import { handleProblem, tidyHandle } from "@/lib/profiles/handles";
import { requireActiveUser } from "@/lib/session";

/**
 * "Join", "Resume" and "Continue to the card step". These, and "Pay now", are the only things that
 * may start a month's payment; opening or reloading a page never does. Every action asks the
 * library, which checks again who is asking: a form is never trusted because the page that drew it
 * was allowed.
 */

function problem(error: unknown): string {
  if (error instanceof MembershipError) return error.message;
  console.error("[membership] a member's action failed", error);
  return "Something went wrong. Nothing was charged. Please try again.";
}

/** The page of a host's membership. The handle comes from a form, so it is tidied before it becomes part of an address. */
function pageOf(typedHandle: unknown): string {
  const handle = tidyHandle(String(typedHandle ?? ""));
  return handleProblem(handle) ? "/" : `/h/${handle}/membership`;
}

/**
 * The month's one payment is made ready here, by the action, so that the page that follows only has
 * to read it. If Stripe cannot be reached now, the joining still stands: the page offers
 * "Continue to the card step" for the 30 minutes the card step has.
 */
async function makeReady(monthId: string, memberId: string): Promise<void> {
  await payNow({ monthId, memberId }).catch((error) => console.error(`[membership] could not make month ${monthId}'s payment ready yet`, error));
}

/** "Join": the invited person, with the box ticked. A second press of the same form joins once (the request id was made when the page was drawn). */
export async function joinAction(formData: FormData) {
  const user = await requireActiveUser();
  const page = pageOf(formData.get("handle"));
  const inviteId = String(formData.get("invite") ?? "");
  let to: string;
  try {
    const started = await join({ customerId: user.id, inviteId, requestId: String(formData.get("request") ?? ""), agreed: formData.get("agreed") === "on", wordingVersion: String(formData.get("wording") ?? ""), now: new Date() });
    await makeReady(started.monthId, user.id);
    to = page;
  } catch (error) {
    to = withNotice(`${page}?invite=${encodeURIComponent(inviteId)}`, problem(error));
  }
  redirect(to);
}

/** "Resume membership": like joining, without an invitation, on the host's membership as the page showed it. */
export async function resumeAction(formData: FormData) {
  const user = await requireActiveUser();
  const page = pageOf(formData.get("handle"));
  let to: string;
  try {
    const started = await resume({
      customerId: user.id,
      membershipId: String(formData.get("membership") ?? ""),
      requestId: String(formData.get("request") ?? ""),
      agreed: formData.get("agreed") === "on",
      offerVersion: Number(formData.get("offerVersion")),
      wordingVersion: String(formData.get("wording") ?? ""),
      now: new Date(),
    });
    await makeReady(started.monthId, user.id);
    to = page;
  } catch (error) {
    to = withNotice(page, problem(error));
  }
  redirect(to);
}

/**
 * "Continue to the card step" and "Pay now": makes the current month's payment ready to be paid by
 * hand, for its member only, and goes back to the page that asked (the joining page, or the page
 * for a failed payment).
 */
export async function payNowAction(formData: FormData) {
  const user = await requireActiveUser();
  const found = await membershipFor(user.id, String(formData.get("membership") ?? ""));
  if (!found) redirect("/account");
  const { membership } = found;
  let back = `/memberships/${membership.id}/pay`;
  if (formData.get("from") === "join") {
    const [profile] = await db.select({ handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, membership.hostId));
    back = profile ? `/h/${profile.handle}/membership` : `/memberships/${membership.id}`;
  }
  let to = back;
  try {
    const ready = membership.currentMonthId ? await payNow({ monthId: membership.currentMonthId, memberId: user.id }) : null;
    if (!ready) to = withNotice(back, "There is nothing to pay at the moment. This page shows how your payment stands.");
  } catch (error) {
    to = withNotice(back, problem(error));
  }
  redirect(to);
}
