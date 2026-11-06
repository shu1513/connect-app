import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { suppressAddress } from "@/lib/notifications/delivery";

/**
 * Resend's messages about emails we sent: delivered, bounced, complained.
 * Each is checked for authenticity (Resend signs them the Svix way) before
 * anything is recorded. A bounce or a complaint means we stop writing to
 * that address.
 */
function verified(request: Request, raw: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatures = request.headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // older than 5 minutes
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return signatures.split(" ").some((part) => {
    const given = part.split(",")[1] ?? "";
    return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verified(request, raw)) return new Response("not verified", { status: 400 });
  const event = JSON.parse(raw) as { type: string; data: { email_id?: string; to?: string[]; bounce?: { type?: string; subType?: string } } };
  const address = event.data.to?.[0];
  // Only a bounce the receiving side calls permanent (no such mailbox) stops us writing to an address.
  // A full mailbox or an undetermined bounce is temporary: the next email is tried as usual.
  if (event.type === "email.bounced" && address) {
    if (event.data.bounce?.type === "Permanent") await suppressAddress(address, `bounced (${event.data.bounce.subType ?? "permanent"})`);
    else console.warn(`[email] temporary bounce for ${address}: ${event.data.bounce?.type ?? "unknown"} ${event.data.bounce?.subType ?? ""}`);
  }
  if (event.type === "email.complained" && address) await suppressAddress(address, "complained");
  if (event.type === "email.delivered" && event.data.email_id) {
    await db.update(schema.emailOutbox).set({ lastError: null }).where(eq(schema.emailOutbox.providerId, event.data.email_id));
  }
  return new Response("ok");
}
