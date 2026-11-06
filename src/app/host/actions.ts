"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ensurePayoutAccount, getHostSettings, payoutSetupLink, publicAppUrl } from "@/lib/payments/hosts";
import { FREE_CANCEL_CHOICES_MINUTES } from "@/lib/payments/rules";
import { requireUser } from "@/lib/session";

/** Sends the host to Stripe's own form to set up (or finish setting up) their payout account. */
export async function startPayoutSetup() {
  const user = await requireUser();
  let url: string;
  try {
    const accountId = await ensurePayoutAccount(user);
    const base = publicAppUrl();
    url = await payoutSetupLink(accountId, {
      returnUrl: `${base}/host/payouts-return`,
      refreshUrl: `${base}/host/payouts-return?again=1`,
    });
  } catch (error) {
    console.error("[payments] could not start payout setup", error);
    redirect(`/host?notice=${encodeURIComponent("Payout setup could not be started. Please try again.")}`);
  }
  redirect(url);
}

/** The host chooses how long before the start cancelling is free. Applies to calls created from now on. */
export async function saveCancelRule(formData: FormData) {
  const user = await requireUser();
  const minutes = Number(formData.get("freeCancelMinutes"));
  if (!(FREE_CANCEL_CHOICES_MINUTES as readonly number[]).includes(minutes)) {
    redirect(`/host?notice=${encodeURIComponent("Choose one of the listed cancelling rules.")}`);
  }
  await getHostSettings(user.id);
  await db
    .update(schema.hostSettings)
    .set({ freeCancelMinutes: minutes, updatedAt: new Date() })
    .where(eq(schema.hostSettings.userId, user.id));
  redirect(`/host?notice=${encodeURIComponent("Your cancelling rule was saved. It applies to calls created from now on.")}`);
}
