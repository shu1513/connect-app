import type { Metadata } from "next";
import Link from "next/link";
import { readNotice } from "@/lib/notice";
import { returnPath } from "@/lib/safe-next";
import { identityState, IDENTITY_TRIES, refreshIdentity } from "@/lib/safety/identity";
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

  return (
    <SitePage warm className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={next ?? "/account"} className="underline underline-offset-2">
          ← {next ? "Back to where you were" : "Your account"}
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Confirm who you are</h1>
      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}
      {state.passed ? (
        <>
          <p className="mt-4 text-sm text-green-700">Done. Your identity is confirmed.</p>
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
          <p className="mt-4 text-sm">
            This confirms that you are a real adult. Hosts need it, so does anyone booking a free call, and some hosts only take calls from
            people who have done it. You take a photo of your ID and a selfie on Stripe&apos;s own pages. We never see or keep the photos:
            Stripe tells us only that you are a real person, 18 or older, and the name on the ID.
          </p>
          {state.pending && <p className="mt-3 text-sm">Your last check is still being looked at. This usually takes a minute or two. Reload this page to see the result.</p>}
          {state.triesLeft === 0 ? (
            <p className="mt-3 text-sm">You have used all {IDENTITY_TRIES} tries. Please write to us.</p>
          ) : (
            <form action={startIdentity} className="mt-4">
              {next && <input type="hidden" name="next" value={next} />}
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                {state.pending ? "Start a new check" : "Start the check"}
              </button>
              <span className="ml-3 text-sm opacity-70">
                {state.triesLeft} of {IDENTITY_TRIES} tries left
              </span>
            </form>
          )}
        </>
      )}
      <p className="mt-6 text-sm opacity-70">
        Hosts you ask for a call can see that your ID is confirmed. They never see your ID, your photos or the name on it.
      </p>
    </SitePage>
  );
}
