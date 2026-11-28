/**
 * What the phone app says it showed before a person agreed to legal documents
 * (plans/46-agreements-live.md, decision 7): `agreements: [{ name, version }, ...]`, as the server
 * gave them. Anything else is read as nothing shown, and then nothing is written.
 */
import type { Shown } from "@/legal/accept";
import { comingAtSignUp } from "@/legal/notices";
import { isDocumentName } from "@/legal/versions";
import type { AppComingAgreement } from "./types";

export function shownFrom(sent: unknown): Shown {
  const shown: Shown = {};
  if (!Array.isArray(sent)) return shown;
  for (const one of sent) {
    if (one === null || typeof one !== "object") continue;
    const { name, version } = one as { name?: unknown; version?: unknown };
    if (typeof name === "string" && typeof version === "string" && isDocumentName(name)) shown[name] = version;
  }
  return shown;
}

/**
 * What the app's last step of signing up says about versions that are announced and not yet in
 * effect (plans/45-phone-apps/09a-what-is-built-put-right.md, decision 7), from the list the
 * website's page shows. Built field by field, and never the version's summary: that is free text
 * written for each version, and could speak of something the apps do not have. The app's notice
 * has fixed words; the summary is on the website's page behind the link.
 */
export function comingShown(now: Date): AppComingAgreement[] {
  return comingAtSignUp(now).map((one) => ({
    name: one.name,
    title: one.title,
    version: one.version,
    from: one.effectiveFrom,
    accepted: one.accepted,
    words: one.thenAccept ? `${one.applies} ${one.thenAccept}` : one.applies,
    link: one.read,
    href: one.href,
  }));
}
