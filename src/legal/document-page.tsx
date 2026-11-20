import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { LegalText } from "./legal-text";
import { parse, type LinkFor } from "./parse";
import { comingVersion, currentVersion, dayOf, DOCUMENTS, findVersion, isDocumentName, linkFor, textOf, versionHref, versionsOf, type DocumentName } from "./registry";

/** A day as people read it: "20 November 2026". The same for everyone, so a version's day is one day. */
export function dayWords(day: string): string {
  return dayOf(day).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The page of one legal document (plans/46-agreements-live.md, part 1): the version in effect, or
 * the one asked for with `?version=`. It says plainly which version this is, whether it is a draft,
 * whether another one is in effect or coming, and lists the earlier ones. A version that does not
 * exist is "not found": nothing is ever shown under a version's name but that version's own text.
 */
export async function LegalDocumentPage({ name, searchParams }: { name: DocumentName; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const asked = (await searchParams).version;
  const now = new Date();
  const current = currentVersion(name, now);
  // No version asked for: the one in effect. Asked for twice, or one that does not exist: not found, never today's text under another name.
  const shown = asked === undefined ? current : typeof asked === "string" ? findVersion(name, asked) : null;
  const text = shown ? textOf(name, shown.version) : null;
  if (!shown || text === null) notFound();
  const coming = comingVersion(name, now);
  const { title, path } = DOCUMENTS[name];
  const isCurrent = shown.version === current.version;
  const isComing = dayOf(shown.effectiveFrom).getTime() > now.getTime();
  // A link to another document leads, from the version in effect, to that document as it is in effect; from any
  // other version, earlier or coming, to the other document as it stands on the day this one takes effect. So
  // nobody reading an old agreement lands on today's words.
  const links: LinkFor = (target) => {
    const plain = linkFor(target);
    const other = target.replace(/\.md$/, "");
    if (!plain || plain.outside || isCurrent || !isDocumentName(other)) return plain;
    const then = currentVersion(other, dayOf(shown.effectiveFrom));
    return { href: versionHref(other, then.version), outside: false };
  };
  const { blocks } = parse(text, links);
  const others = versionsOf(name).filter((v) => v.version !== shown.version);
  const note = "mt-4 rounded border border-neutral-400 p-3 text-sm";

  return (
    <SitePage className={warm.document}>
      <h1 className={warm.title}>{title}</h1>
      <p className="mt-2 text-sm opacity-70" data-legal-version={shown.version}>
        Version of {dayWords(shown.version)}
        {isComing ? `, in effect from ${dayWords(shown.effectiveFrom)}` : shown.effectiveFrom !== shown.version ? `, in effect since ${dayWords(shown.effectiveFrom)}` : ""}
      </p>
      {shown.draft && (
        <p role="note" className={note} data-legal-draft>
          <strong>Draft. Not in force yet.</strong> This text is being prepared, and the marked places are still to be filled in. Until it is published, Connect is for
          testing only.
        </p>
      )}
      {!isCurrent && !isComing && (
        <p role="note" className={note}>
          This is an earlier version. It is no longer the one in effect.{" "}
          <Link href={path} className="underline underline-offset-2">
            Read the current version
          </Link>
          .
        </p>
      )}
      {isComing && (
        <p role="note" className={note}>
          This version is not in effect yet. It takes effect on {dayWords(shown.effectiveFrom)}. {shown.summary}{" "}
          <Link href={path} className="underline underline-offset-2">
            Read the version in effect today
          </Link>
          .
        </p>
      )}
      {isCurrent && coming && (
        <p role="note" className={note} data-legal-coming={coming.version}>
          <strong>A new version takes effect on {dayWords(coming.effectiveFrom)}.</strong> {coming.summary}{" "}
          <Link href={versionHref(name, coming.version)} className="underline underline-offset-2">
            Read the new version
          </Link>
          .
        </p>
      )}
      <LegalText blocks={blocks} />
      {others.length > 0 && (
        <section className="mt-10 text-sm">
          <h2 className="font-bold">Other versions</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {others.map((v) => (
              <li key={v.version}>
                <Link href={versionHref(name, v.version)} className="underline underline-offset-2">
                  Version of {dayWords(v.version)}
                </Link>
                {v.version === current.version ? " (in effect)" : dayOf(v.effectiveFrom).getTime() > now.getTime() ? ` (from ${dayWords(v.effectiveFrom)})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </SitePage>
  );
}
