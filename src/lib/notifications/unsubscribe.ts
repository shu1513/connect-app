/**
 * Switching reminder emails off from a link in an email, without logging in.
 * The link carries a secret that can do one thing only: switch reminders off
 * for that one person. Opening the link does nothing by itself (link scanners
 * open links); a button on the page, or the one-click header, does.
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SUPPORT_EMAIL } from "@/lib/terms";

type Person = { id: string; unsubscribeToken: string | null };

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** The person's unsubscribe secret, made on first use. Two helpers making it at once both get the one that was kept. */
export async function unsubscribeTokenFor(userId: string): Promise<string> {
  const fresh = randomBytes(24).toString("base64url");
  const [row] = await db
    .update(schema.user)
    .set({ unsubscribeToken: sql`coalesce(${schema.user.unsubscribeToken}, ${fresh})` })
    .where(eq(schema.user.id, userId))
    .returning({ token: schema.user.unsubscribeToken });
  return row?.token ?? fresh;
}

/** The page with the button (for the email's text). */
export function unsubscribeUrl(person: Person): string {
  return `${appUrl()}/unsubscribe?token=${person.unsubscribeToken ?? ""}`;
}

/** The address mail programs POST to for one-click unsubscribe. */
function oneClickUrl(person: Person): string {
  return `${appUrl()}/api/unsubscribe?token=${person.unsubscribeToken ?? ""}`;
}

/** The last lines of every reminder email. */
export function reminderFooter(person: Person): string {
  return `—\nConnect · questions: ${SUPPORT_EMAIL}\nTo stop reminder emails: ${unsubscribeUrl(person)}`;
}

/** The headers that let a mail program offer "unsubscribe" with one click (RFC 8058). */
export function unsubscribeHeaders(person: Person): Record<string, string> {
  return { "List-Unsubscribe": `<${oneClickUrl(person)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/** Switches reminders off for the person the token belongs to. Returns false for an unknown token. */
export async function unsubscribeWithToken(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return false;
  const changed = await db.update(schema.user).set({ reminderEmails: false }).where(eq(schema.user.unsubscribeToken, token)).returning({ id: schema.user.id });
  return changed.length > 0;
}
