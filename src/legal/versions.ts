/**
 * The legal documents of the site and their versions (plans/46-agreements-live.md).
 *
 * Every version is a file of its own under ./documents and is named here with the day it takes
 * effect. A version that people have been shown is never edited and never taken out: a change is
 * a new version. So the text someone accepted last year can always be shown again.
 *
 * Two kinds of version:
 *   - a DRAFT may still hold blanks ("[COMPANY NAME]"). Every page that shows one says "Draft. Not
 *     in force yet." Accepting a draft proves only that the draft was accepted.
 *   - a PUBLISHED version holds no blank (a test refuses one that does): names and addresses are
 *     written into its text. Its text is frozen, so nothing set later can change what an earlier
 *     acceptance was an acceptance of.
 *
 * A version whose day has not come is "coming": it can be read at its own address, the page of
 * the current version announces it, and people are emailed (part 2 of the plan). A published
 * version that follows a published one must be added here at least 30 days before its day,
 * unless it says why it is urgent; registry.test.ts keeps watch over that.
 *
 * This file holds the list without the texts, so that code which only needs to know WHICH version
 * is in effect (the gate of every page, the app's door) does not carry seven long documents with
 * it. The texts are in registry.ts.
 *
 * No database and no network here.
 */
export const DOCUMENT_NAMES = ["terms-of-service", "payment-terms", "community-rules", "host-agreement", "privacy-policy", "copyright-policy", "identity-check-notice"] as const;
export type DocumentName = (typeof DOCUMENT_NAMES)[number];

export type DocumentVersion = {
  /** The version's name: the day it was written, as "2026-11-20". Never reused. */
  version: string;
  /** The day it takes effect, at the start of that day in UTC. */
  effectiveFrom: string;
  /** The day it was added to this list, which is the day people could first read it. */
  addedOn: string;
  /** A draft may hold blanks and is not in force. */
  draft: boolean;
  /** What changed against the version before, in a sentence or two, for the notice and the email. Empty for a first version. */
  summary: string;
  /** Why a published version takes effect less than 30 days after it was added: the law, or an urgent risk. */
  urgent?: string;
};

/** How long before its day a new published version has to be readable (the Terms, section 23.2; the Host Agreement, 19.2). */
export const NOTICE_DAYS = 30;

const first = (): DocumentVersion[] => [{ version: "2026-11-20", effectiveFrom: "2026-11-20", addedOn: "2026-11-20", draft: true, summary: "" }];

export const DOCUMENTS: Record<DocumentName, { title: string; path: string; versions: DocumentVersion[] }> = {
  "terms-of-service": { title: "Terms of Service", path: "/terms", versions: first() },
  "payment-terms": { title: "Payment Terms", path: "/payment-terms", versions: first() },
  "community-rules": { title: "Community Rules", path: "/rules", versions: first() },
  "host-agreement": { title: "Host Agreement", path: "/host-agreement", versions: first() },
  "privacy-policy": { title: "Privacy Policy", path: "/privacy", versions: first() },
  "copyright-policy": { title: "Copyright and Content Complaints Policy", path: "/copyright", versions: first() },
  "identity-check-notice": { title: "Identity Check Notice", path: "/identity-notice", versions: first() },
};

export function isDocumentName(name: string): name is DocumentName {
  return (DOCUMENT_NAMES as readonly string[]).includes(name);
}

/** The start of a version's day, as a moment. */
export const dayOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** The versions of a document, oldest first. */
export function versionsOf(name: DocumentName): DocumentVersion[] {
  return [...DOCUMENTS[name].versions].sort((a, b) => dayOf(a.effectiveFrom).getTime() - dayOf(b.effectiveFrom).getTime());
}

export function findVersion(name: DocumentName, version: string): DocumentVersion | null {
  return DOCUMENTS[name].versions.find((v) => v.version === version) ?? null;
}

/** The version in effect at this moment: the newest whose day has come. */
export function currentVersion(name: DocumentName, now: Date): DocumentVersion {
  const due = versionsOf(name).filter((v) => dayOf(v.effectiveFrom).getTime() <= now.getTime());
  // Every document's first version is in effect from the day the document exists.
  return due[due.length - 1] ?? versionsOf(name)[0];
}

/** The next version whose day has not come, or null. */
export function comingVersion(name: DocumentName, now: Date): DocumentVersion | null {
  return versionsOf(name).find((v) => dayOf(v.effectiveFrom).getTime() > now.getTime()) ?? null;
}

/** The three documents everyone accepts when finishing sign-up. Their versions make up the stamp on a person's line. */
export const GENERAL_DOCUMENTS = ["terms-of-service", "payment-terms", "community-rules"] as const satisfies readonly DocumentName[];
/** What a host accepts on top. */
export const HOSTING_DOCUMENTS = ["host-agreement"] as const satisfies readonly DocumentName[];

export type Occasion = "sign_up" | "hosting";
export type AgreementToAccept = { name: DocumentName; title: string; version: string; draft: boolean; /** The address of exactly this version. */ href: string };

/** The address of one version of a document, so that a link beside a button leads to the text that button accepts. */
export function versionHref(name: DocumentName, version: string): string {
  return `${DOCUMENTS[name].path}?version=${encodeURIComponent(version)}`;
}

/**
 * Which documents, in which versions, a person is asked to accept at this moment. The website
 * and the phone app both ask this one function, so they can never ask for different things.
 */
export function agreementsToAccept(occasion: Occasion, now: Date): AgreementToAccept[] {
  const names: readonly DocumentName[] = occasion === "sign_up" ? GENERAL_DOCUMENTS : HOSTING_DOCUMENTS;
  return names.map((name) => {
    const v = currentVersion(name, now);
    return { name, title: DOCUMENTS[name].title, version: v.version, draft: v.draft, href: versionHref(name, v.version) };
  });
}

/**
 * The short stamp kept on a person's own line (`user.termsVersion`): the versions of the three
 * general documents they hold. The gate compares it with this, as it compared a constant before.
 * Only these three are in it: a new Host Agreement or privacy policy sends nobody back to the
 * welcome step.
 */
export function generalStamp(now: Date): string {
  return GENERAL_DOCUMENTS.map((name) => `${name}@${currentVersion(name, now).version}`).join("|");
}
