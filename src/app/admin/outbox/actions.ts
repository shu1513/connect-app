"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
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
