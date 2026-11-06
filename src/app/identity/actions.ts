"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { publicAppUrl } from "@/lib/payments/hosts";
import { IdentityError, startIdentityCheck } from "@/lib/safety/identity";
import { requireUser } from "@/lib/session";

/** Sends the person to Stripe's identity pages. */
export async function startIdentity() {
  const user = await requireUser();
  let url: string;
  try {
    url = await startIdentityCheck(user, `${publicAppUrl()}/identity/return`);
  } catch (error) {
    const message = error instanceof IdentityError ? error.message : "The check could not be started. Please try again.";
    if (!(error instanceof IdentityError)) console.error("[identity] could not start", error);
    redirect(withNotice("/identity", message));
  }
  redirect(url);
}
