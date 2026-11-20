import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { shownValue } from "@/legal/accept";
import { LegalText } from "@/legal/legal-text";
import { parse } from "@/legal/parse";
import { currentVersion, linkFor, textOf, versionHref } from "@/legal/registry";
import { readNotice } from "@/lib/notice";
import { returnPath } from "@/lib/safe-next";
import { identityState, IDENTITY_TRIES, refreshIdentity } from "@/lib/safety/identity";
import { IDENTITY_WORDS } from "@/lib/safety/identity-words";
import { requireUser } from "@/lib/session";
import { startIdentity } from "./actions";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Confirm who you are" };

/**
 * "Confirm who you are": the identity check. Needed to host, before a first free call, and by
 * hosts who only take people who have passed it; anyone may also do it by choice.
 */
export default async function IdentityPage(props: PageProps<"/identity">) {
  const query = await props.searchParams;
  // The page the person was on (a booking they had started), to go back to once the check is passed.
  const next = returnPath(query.next);
  const user = await requireUser(next ? `/identity?next=${encodeURIComponent(next)}` : undefined);
  const notice = readNotice("/identity", query);
  let state = await identityState(user.id);
  if (!state.passed && (state.pending || state.triesLeft < IDENTITY_TRIES)) state = await refreshIdentity(user.id).catch(() => state);
  // A result of "under 18" pauses the account, and this page may be the one that just read it (`user.paused` was
  // read before). A paused person is shown why, not "Start the check".
  const [now] = await db.select({ pausedAt: schema.user.pausedAt }).from(schema.user).where(eq(schema.user.id, user.id));
  if (now?.pausedAt) redirect("/paused");
  // The Identity Check Notice in effect, shown in full above the button: pressing the button agrees to it (plans/46, decision 9).
  const notice1 = currentVersion("identity-check-notice", new Date());
  const noticeBlocks = parse(textOf("identity-check-notice", notice1.version) ?? "", linkFor).blocks;

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={next ?? "/account"} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {next ? "Back to where you were" : "Your account"}
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">{IDENTITY_WORDS.title}</h1>
      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}
      {state.passed ? (
        <>
          <p className="mt-4 text-sm text-green-700">{IDENTITY_WORDS.passed}</p>
          {next && (
            <p className="mt-4 text-sm">
              <Link href={next} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                Continue where you were
              </Link>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-4 text-sm">{IDENTITY_WORDS.what}</p>
          {state.pending && <p className="mt-3 text-sm">{IDENTITY_WORDS.pending} Reload this page to see the result.</p>}
          {state.triesLeft === 0 ? (
            <p className="mt-3 text-sm">{IDENTITY_WORDS.noTries}</p>
          ) : (
            <form action={startIdentity} className="mt-4">
              {next && <input type="hidden" name="next" value={next} />}
              <input type="hidden" name="shown" value={shownValue([{ name: "identity-check-notice", version: notice1.version }])} />
              <section aria-label="Identity Check Notice" className="max-h-80 overflow-y-auto rounded border border-neutral-400 p-3" data-identity-notice={notice1.version}>
                <p className="text-sm font-bold">
                  Identity Check Notice{notice1.draft ? " (draft, not in force yet)" : ""}{" "}
                  <Link href={versionHref("identity-check-notice", notice1.version)} target="_blank" className="font-normal underline underline-offset-2">
                    open it on its own page
                  </Link>
                </p>
                <LegalText blocks={noticeBlocks} />
              </section>
              <p className="mt-3 text-sm">
                {IDENTITY_WORDS.agree}
              </p>
              <button type="submit" className="mt-3 rounded bg-blue-600 px-4 py-2 font-medium text-white">
                {IDENTITY_WORDS.button(state.pending)}
              </button>
              <span className="ml-3 text-sm opacity-70">
                {IDENTITY_WORDS.tries(state.triesLeft)}
              </span>
            </form>
          )}
        </>
      )}
      <p className="mt-6 text-sm opacity-70">
        {IDENTITY_WORDS.small}
      </p>
    </SitePage>
  );
}
