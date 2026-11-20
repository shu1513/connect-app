/**
 * Writing down that a person accepted legal documents (plans/46-agreements-live.md, decisions 5 to 7).
 * One place for it: the website's welcome step, applying to host, the box on the Hosting page, the
 * identity step, and the phone app's own address all come here, so an acceptance is always the same
 * thing: the versions the person was SHOWN are the ones due at that moment, and one line is
 * written for each document, once.
 *
 * It never writes anything for a request that does not say which versions it showed.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { agreementsToAccept, currentVersion, generalStamp, GENERAL_DOCUMENTS, isDocumentName, type DocumentName, type Occasion } from "./versions";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Refused for a reason a person can read. Nothing was written. */
export class AgreementError extends Error {}

export const STALE_AGREEMENTS = "These documents have changed since this page was opened. Please read them again.";

/** What a form sends back: for each document it showed, the version it showed. */
export type Shown = Partial<Record<DocumentName, string>>;

/** Reads what a form sent ("terms-of-service@2026-11-20|payment-terms@2026-11-20"), ignoring anything that is not a document. */
export function readShown(sent: unknown): Shown {
  const shown: Shown = {};
  for (const part of String(sent ?? "").split("|")) {
    const [name, version] = part.split("@");
    if (name && version && isDocumentName(name)) shown[name] = version;
  }
  return shown;
}

/** What a form carries so that it can say what it showed. The opposite of readShown. */
export function shownValue(agreements: { name: DocumentName; version: string }[]): string {
  return agreements.map((a) => `${a.name}@${a.version}`).join("|");
}

/** Whether what was shown is exactly what is due now: every document, in its current version. */
export function shownIsCurrent(occasion: Occasion, shown: Shown, now: Date): boolean {
  return agreementsToAccept(occasion, now).every((due) => shown[due.name] === due.version);
}

export type AcceptanceOccasion = "sign_up" | "new_version" | "host_application" | "host_new_version" | "identity_check";

/**
 * Writes one line for each document that has none yet for this person and version. Lines that are
 * there stay as they are (their first moment is the proof), so pressing twice writes nothing.
 * The caller has checked that the versions are the ones due.
 */
async function writeLines(tx: Tx, userId: string, documents: { name: DocumentName; version: string }[], occasion: AcceptanceOccasion, now: Date): Promise<void> {
  for (const document of documents) {
    await tx.insert(schema.agreementAcceptances).values({ userId, document: document.name, version: document.version, occasion, acceptedAt: now }).onConflictDoNothing();
  }
}

/**
 * Finishing sign-up, or accepting a new version of the general documents: the tick for "18 or
 * older", the three documents in the versions shown, and the person's time zone, in one database
 * step with one moment. Only for a person whose email address is confirmed and whose account is
 * not closed. Throws AgreementError when the versions shown are no longer the ones due.
 */
export async function acceptGeneralAgreements(input: { userId: string; shown: Shown; timeZone: string; now: Date }): Promise<void> {
  const { userId, now } = input;
  if (!shownIsCurrent("sign_up", input.shown, now)) throw new AgreementError(STALE_AGREEMENTS);
  await db.transaction(async (tx) => {
    const [person] = await tx.select().from(schema.user).where(eq(schema.user.id, userId)).for("update");
    if (!person || person.closedAt || !person.emailVerified) throw new AgreementError("This account cannot accept the terms right now.");
    // A person who has accepted general documents before is accepting a new version now.
    const occasion: AcceptanceOccasion = person.termsAcceptedAt ? "new_version" : "sign_up";
    await writeLines(tx, userId, agreementsToAccept("sign_up", now), occasion, now);
    await tx
      .update(schema.user)
      // The day they first said "18 or older" stays; it is said again with every acceptance, and the first one is the proof.
      .set({ adultConfirmedAt: person.adultConfirmedAt ?? now, termsAcceptedAt: now, termsVersion: generalStamp(now), timeZone: input.timeZone, updatedAt: now })
      .where(eq(schema.user.id, userId));
  });
}

/** The Host Agreement, accepted inside the step that makes a host profile or answers the box on the Hosting page. */
export async function acceptHostAgreementIn(tx: Tx, input: { userId: string; shown: Shown; occasion: "host_application" | "host_new_version"; now: Date }): Promise<void> {
  if (!shownIsCurrent("hosting", input.shown, input.now)) throw new AgreementError(STALE_AGREEMENTS);
  await writeLines(tx, input.userId, agreementsToAccept("hosting", input.now), input.occasion, input.now);
}

/** What a form that shows the Host Agreement in effect now sends back. Also for check scripts that apply to host. */
export function hostAgreementShown(now: Date): Shown {
  return Object.fromEntries(agreementsToAccept("hosting", now).map((a) => [a.name, a.version]));
}

/** Whether this host holds the Host Agreement in the version in effect now. */
export async function holdsHostAgreement(userId: string, now: Date, reader: Pick<typeof db, "select"> = db): Promise<boolean> {
  const due = currentVersion("host-agreement", now).version;
  const [line] = await reader
    .select({ id: schema.agreementAcceptances.id })
    .from(schema.agreementAcceptances)
    .where(and(eq(schema.agreementAcceptances.userId, userId), eq(schema.agreementAcceptances.document, "host-agreement"), eq(schema.agreementAcceptances.version, due)));
  return Boolean(line);
}

/**
 * Agreeing to the Identity Check Notice, before an identity check is asked of Stripe. Returns the
 * version agreed to, which the check's own line keeps. Throws when the notice shown is not the
 * current one.
 */
export async function acceptIdentityNotice(input: { userId: string; shown: Shown; now: Date }): Promise<string> {
  const due = currentVersion("identity-check-notice", input.now).version;
  if (input.shown["identity-check-notice"] !== due) throw new AgreementError(STALE_AGREEMENTS);
  await db.transaction((tx) => writeLines(tx, input.userId, [{ name: "identity-check-notice", version: due }], "identity_check", input.now));
  return due;
}

/** For a page: the three general documents are the ones in the stamp. */
export const GENERAL = GENERAL_DOCUMENTS;
