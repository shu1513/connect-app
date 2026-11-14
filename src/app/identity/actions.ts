"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { publicAppUrl } from "@/lib/payments/hosts";
import { returnPath } from "@/lib/safe-next";
import { IdentityError, startIdentityCheck } from "@/lib/safety/identity";
import { requireUser } from "@/lib/session";

/** Sends the person to Stripe's identity pages. The page to go back to afterwards travels along, checked at every step. */
export async function startIdentity(formData: FormData) {
  const user = await requireUser();
  const next = returnPath(formData.get("next"));
  const carry = next ? `?next=${encodeURIComponent(next)}` : "";
  let url: string;
  try {
    url = await startIdentityCheck(user, `${publicAppUrl()}/identity/return${carry}`);
  } catch (error) {
    const message = error instanceof IdentityError ? error.message : "The check could not be started. Please try again.";
    if (!(error instanceof IdentityError)) console.error("[identity] could not start", error);
    redirect(withNotice(`/identity${carry}`, message));
  }
  redirect(url);
}
