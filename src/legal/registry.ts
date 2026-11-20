/**
 * The texts of the legal documents (plans/46-agreements-live.md): one file for each version under
 * ./documents, named here. The list of versions itself, with the days, is in versions.ts; this
 * file adds the words, and the checks that need them.
 */
import type { LinkFor } from "./parse";
import communityRules20261120 from "./documents/community-rules/2026-11-20";
import copyrightPolicy20261120 from "./documents/copyright-policy/2026-11-20";
import hostAgreement20261120 from "./documents/host-agreement/2026-11-20";
import identityCheckNotice20261120 from "./documents/identity-check-notice/2026-11-20";
import paymentTerms20261120 from "./documents/payment-terms/2026-11-20";
import privacyPolicy20261120 from "./documents/privacy-policy/2026-11-20";
import termsOfService20261120 from "./documents/terms-of-service/2026-11-20";

import { dayOf, DOCUMENT_NAMES, DOCUMENTS, isDocumentName, NOTICE_DAYS, versionsOf, type DocumentName } from "./versions";

export * from "./versions";

/** Every version's text. A version named in versions.ts without a text here fails a test. */
export const TEXTS: Record<DocumentName, Record<string, string>> = {
  "terms-of-service": { "2026-11-20": termsOfService20261120 },
  "payment-terms": { "2026-11-20": paymentTerms20261120 },
  "community-rules": { "2026-11-20": communityRules20261120 },
  "host-agreement": { "2026-11-20": hostAgreement20261120 },
  "privacy-policy": { "2026-11-20": privacyPolicy20261120 },
  "copyright-policy": { "2026-11-20": copyrightPolicy20261120 },
  "identity-check-notice": { "2026-11-20": identityCheckNotice20261120 },
};

/** The text of one version, or null when there is no such version. */
export function textOf(name: DocumentName, version: string): string | null {
  return TEXTS[name][version] ?? null;
}

const DAY_MS = 24 * 3_600_000;

/** The blanks still in a text, each once, as written ("[COMPANY NAME]"). */
export function blanksIn(text: string): string[] {
  return [...new Set(text.match(/\[[A-Z][A-Z0-9 ,'-]{1,}(?::[^\]]*)?\]/g) ?? [])];
}

/** Where a link inside a document leads: another document by its file name, a path of the site, or an address outside. */
export const linkFor: LinkFor = (target) => {
  if (/^https?:\/\//.test(target)) return { href: target, outside: true };
  if (target.startsWith("/")) return { href: target, outside: false };
  const name = target.replace(/\.md$/, "");
  return isDocumentName(name) ? { href: DOCUMENTS[name].path, outside: false } : null;
};

/**
 * What is wrong with the list and its texts, in words. Empty when all is well; a test fails otherwise.
 */
export function registryProblems(): string[] {
  const problems: string[] = [];
  for (const name of DOCUMENT_NAMES) {
    const versions = versionsOf(name);
    if (versions.length === 0) problems.push(`${name} has no version`);
    const seen = new Set<string>();
    versions.forEach((v, index) => {
      if (seen.has(v.version)) problems.push(`${name} names the version ${v.version} twice`);
      seen.add(v.version);
      const text = textOf(name, v.version) ?? "";
      if (!text.trim()) problems.push(`${name} ${v.version} has no text`);
      if (Number.isNaN(dayOf(v.effectiveFrom).getTime()) || Number.isNaN(dayOf(v.addedOn).getTime())) problems.push(`${name} ${v.version} has a day that is not a day`);
      if (!v.draft && blanksIn(text).length > 0) problems.push(`${name} ${v.version} is published but still has blanks: ${blanksIn(text).slice(0, 3).join(", ")}`);
      if (index > 0 && !v.summary.trim()) problems.push(`${name} ${v.version} does not say what changed`);
      const before = versions[index - 1];
      // The 30 days are owed to people who hold a version in force. After a draft nothing was in force.
      if (before && !before.draft && !v.urgent && dayOf(v.effectiveFrom).getTime() - dayOf(v.addedOn).getTime() < NOTICE_DAYS * DAY_MS) {
        problems.push(`${name} ${v.version} takes effect less than ${NOTICE_DAYS} days after it was added, and gives no reason for the hurry`);
      }
      if (before && v.draft && !before.draft) problems.push(`${name} ${v.version} is a draft after a published version`);
    });
  }
  return problems;
}
