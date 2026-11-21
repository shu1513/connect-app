"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { sendRefusedNoticesAgain } from "@/legal/notices";
import { queueEmail } from "@/lib/email";
import { withNotice } from "@/lib/notice";
import { requireAdmin } from "@/lib/session";

/** Writes a test email to the admin's own address. At most one a minute, through the outbox like everything else. */
export async function sendTestEmail() {
  const admin = await requireAdmin();
  const minute = Math.floor(Date.now() / 60_000);
  await db.transaction((tx) =>
    queueEmail(tx, { to: admin.email, subject: "Test email from Connect", text: `Hi ${admin.name},\n\nThis is a test email. If you can read it, sending works.`, key: `test:${admin.id}:${minute}` }),
  );
  redirect(withNotice("/admin/outbox", "A test email was written to the outbox. If sending is on, it goes out within a minute."));
}

/**
 * Puts back in the queue the notices of a coming version that the sending service refused outright (plans/46,
 * part 2). Only those: a refusal certainly did not go out, so a second try cannot send twice.
 */
export async function sendRefusedAgain() {
  await requireAdmin();
  const back = await sendRefusedNoticesAgain(new Date());
  redirect(
    withNotice(
      "/admin/outbox",
      back > 0
        ? `${back} ${back === 1 ? "notice was" : "notices were"} put back in the queue. If sending is on, ${back === 1 ? "it goes" : "they go"} out within a few minutes.`
        : "Nothing was put back: no notice of a coming version was refused outright by the sending service. One whose outcome is not known is not sent again by itself; look at it at the sending service.",
    ),
  );
}
