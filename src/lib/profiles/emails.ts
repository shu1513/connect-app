/**
 * The email a host gets when the founder decides about their profile. Written in the same
 * database step as the decision (see queueEmail), so a host is told exactly when it happens.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/terms";

type Writer = Pick<typeof db, "insert" | "select">;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** What each decision's email says. Kept apart from the sending so the words can be read (and tested) on their own. */
export function profileDecisionEmail(decision: "approved" | "declined" | "suspended", host: { name: string; handle: string }, url: string): { subject: string; text: string } {
  const hosting = `${url}/host`;
  const said = {
    approved: {
      subject: "Your Connect page is approved",
      lines: [
        `Your host page is approved and public: ${url}/h/${host.handle}`,
        "",
        "People can ask you for a call once your hours are set on your calendar and, if you charge for calls, once your payouts are set up. Your Hosting page shows what is left to do:",
        hosting,
      ],
    },
    declined: {
      subject: "Your Connect host profile was not approved",
      lines: [
        "We looked at your host profile and could not approve it as it is. Your page is not public.",
        "",
        "You can change your profile on your Hosting page, and we will look at it again:",
        hosting,
      ],
    },
    suspended: {
      subject: "Your Connect host page has been suspended",
      lines: [
        "Your host page has been suspended and is no longer public. Requests that were waiting for your answer have ended, and your upcoming calls are being cancelled at no charge to your customers.",
        "",
        `If you think this is a mistake, write to ${SUPPORT_EMAIL}.`,
      ],
    },
  }[decision];
  return { subject: said.subject, text: [`Hi ${host.name},`, "", ...said.lines, "", `—\nConnect · questions: ${SUPPORT_EMAIL}`].join("\n") };
}

/** Queues the email for one decision. `decidedAt` is part of its name, so a later decision about the same profile gets its own email. */
export async function queueProfileDecisionEmail(tx: Writer, input: { userId: string; decision: "approved" | "declined" | "suspended"; decidedAt: Date }): Promise<void> {
  const [host] = await tx
    .select({ name: schema.user.name, email: schema.user.email, closedAt: schema.user.closedAt, handle: schema.hostProfiles.handle })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .where(eq(schema.hostProfiles.userId, input.userId));
  // A closed account is not written to.
  if (!host || host.closedAt) return;
  const { subject, text } = profileDecisionEmail(input.decision, host, appUrl());
  await queueEmail(tx, { to: host.email, subject, text, key: `profile_${input.decision}:${input.userId}:${input.decidedAt.toISOString()}` });
}
