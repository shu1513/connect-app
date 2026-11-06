import Link from "next/link";
import { readNotice } from "@/lib/notice";
import { identityState, IDENTITY_TRIES, refreshIdentity } from "@/lib/safety/identity";
import { requireUser } from "@/lib/session";
import { startIdentity } from "./actions";

/** "Confirm who you are": the identity check, needed to host and before a first free call. */
export default async function IdentityPage(props: PageProps<"/identity">) {
  const user = await requireUser();
  const notice = readNotice("/identity", await props.searchParams);
  let state = await identityState(user.id);
  if (!state.passed && (state.pending || state.triesLeft < IDENTITY_TRIES)) state = await refreshIdentity(user.id).catch(() => state);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href="/account" className="underline underline-offset-2">
          ← Your account
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Confirm who you are</h1>
      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}
      {state.passed ? (
        <p className="mt-4 text-sm text-green-700">Done. Your identity is confirmed.</p>
      ) : (
        <>
          <p className="mt-4 text-sm">
            Hosts, and anyone booking a free call, confirm that they are a real adult. You take a photo of your ID and a selfie on
            Stripe&apos;s own pages. We never see or keep the photos: Stripe tells us only that you are a real person, 18 or older, and
            the name on the ID.
          </p>
          {state.pending && <p className="mt-3 text-sm">Your last check is still being looked at. This usually takes a minute or two. Reload this page to see the result.</p>}
          {state.triesLeft === 0 ? (
            <p className="mt-3 text-sm">You have used all {IDENTITY_TRIES} tries. Please write to us.</p>
          ) : (
            <form action={startIdentity} className="mt-4">
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
    </main>
  );
}
