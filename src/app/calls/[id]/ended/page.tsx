import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { blockAction } from "@/app/report/actions";
import { SitePage } from "@/components/site-page";
import { endedScreenFor } from "@/lib/call-page/ended";
import { END_WORDS } from "@/lib/call-page/end-words";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "The call has ended" };

/**
 * The screen after "End call now" (plans/50-end-call-now.md, decision 19): who ended the call,
 * what that means for the money, and three choices, each with what it does: "Report", "Block"
 * and "Neither". The call is over whatever is chosen here, or if this page is simply closed.
 */
export default async function EndedPage(props: PageProps<"/calls/[id]/ended">) {
  const { id } = await props.params;
  const user = await requireUser(`/calls/${id}/ended`);
  const screen = await endedScreenFor(user.id, id, new Date());
  if (!screen) notFound();
  // A call that is still going on, has yet to start, or was cancelled: its own page says where it stands.
  if (screen === "not_ended") redirect(`/calls/${id}`);
  const results = `/calls/${screen.callId}/results`;
  const choice = "rounded border border-neutral-400 p-4";
  const button = "inline-flex min-h-11 items-center rounded px-4 py-2 font-medium";

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{screen.title}</h1>
      <div className="mt-3 space-y-2 text-sm" data-ended-lines>
        {screen.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">{screen.what}</h2>
      <div className="mt-3 space-y-4 text-sm">
        <section className={choice} data-choice="report">
          <Link href={`/report?call=${screen.callId}`} className={`${button} bg-blue-600 text-white`}>
            {screen.report.label}
          </Link>
          <p className="mt-2 opacity-80">{screen.report.what}</p>
          {screen.report.money && <p className="mt-1 opacity-80">{screen.report.money}</p>}
        </section>

        <section className={choice} data-choice="block">
          {screen.block.done ? (
            <p className="font-medium">You have blocked {screen.otherName}.</p>
          ) : (
            <form action={blockAction}>
              <input type="hidden" name="userId" value={screen.otherId} />
              <input type="hidden" name="back" value={results} />
              <button type="submit" className={`${button} border border-red-600 text-red-600`}>
                {screen.block.label}
              </button>
            </form>
          )}
          <p className="mt-2 opacity-80">{screen.block.what}</p>
        </section>

        <section className={choice} data-choice="neither">
          <Link href={results} className={`${button} border border-neutral-500`}>
            {screen.neither.label}
          </Link>
          <p className="mt-2 opacity-80">{screen.neither.what}</p>
        </section>
      </div>
      <p className="mt-6 text-sm opacity-70">
        <Link href={results} className="underline underline-offset-2">
          {END_WORDS.toResults}
        </Link>
      </p>
    </SitePage>
  );
}
