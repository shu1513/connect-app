"use server";

import { redirect } from "next/navigation";
import { acceptIdentityNotice, AgreementError, readShown } from "@/legal/accept";
import { withNotice } from "@/lib/notice";
import { publicAppUrl } from "@/lib/payments/hosts";
import { returnPath } from "@/lib/safe-next";
import { IdentityError, startIdentityCheck } from "@/lib/safety/identity";
import { requireUser } from "@/lib/session";

/**
 * Sends the person to Stripe's identity pages. The page to go back to afterwards travels along, checked at every step.
 *
 * Pressing the button is the person's agreement to the Identity Check Notice shown above it (plans/46,
 * decision 9). That is written down first, in the version the page showed; only then is Stripe asked for a
 * check. A page that showed an older version of the notice is shown again.
 */
export async function startIdentity(formData: FormData) {
  const user = await requireUser();
  const next = returnPath(formData.get("next"));
  const carry = next ? `?next=${encodeURIComponent(next)}` : "";
  let url: string;
  try {
    const noticeVersion = await acceptIdentityNotice({ userId: user.id, shown: readShown(formData.get("shown")), now: new Date() });
    url = await startIdentityCheck(user, `${publicAppUrl()}/identity/return${carry}`, noticeVersion);
  } catch (error) {
    const known = error instanceof IdentityError || error instanceof AgreementError;
    const message = known ? error.message : "The check could not be started. Please try again.";
    if (!known) console.error("[identity] could not start", error);
    redirect(withNotice(`/identity${carry}`, message));
  }
  redirect(url);
}
