import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { RefreshEvery } from "@/components/refresh-every";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { followedHosts } from "@/lib/follows/follows";
import { FOLLOW } from "@/lib/follows/rules";
import { readNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { unfollowAction } from "./actions";

export const metadata: Metadata = { title: "Hosts you follow" };

// Who is available changes by the minute: always built fresh.
export const dynamic = "force-dynamic";

/** The hosts this person follows: who is available now, and their next call with each. Only they ever see it. */
export default async function FollowingPage(props: PageProps<"/following">) {
  const user = await requireUser("/following");
  const notice = readNotice("/following", await props.searchParams);
  const hosts = await followedHosts(user.id, new Date());

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <RefreshEvery seconds={FOLLOW.refreshSeconds} />
      <h1 className={warm.title}>Hosts you follow</h1>
      <p className="mt-2 text-sm opacity-70">
        Only you see this list. A host is shown as available while they have switched &quot;Available now&quot; on; this page looks again every minute.
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {hosts.length === 0 ? (
        <p className="mt-6 text-sm">
          You do not follow anyone yet. Press &quot;Follow&quot; on a host&apos;s page, or have a call with them: after a call you follow the host.{" "}
          <Link href="/search" className="underline underline-offset-2">
            Find a host
          </Link>
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {hosts.map((host) => (
            <li key={host.hostId} className={`${host.available ? warm.available : warm.card} text-sm`} data-followed={host.available ? "available" : "not"}>
              <p className="text-lg font-bold">
                {host.handle ? (
                  <Link href={`/h/${host.handle}`} className="inline-flex min-h-11 items-center underline decoration-[#c2410c] underline-offset-4">
                    {host.name}
                  </Link>
                ) : (
                  host.name
                )}
              </p>
              {host.available && host.handle ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-semibold">
                    <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600" />
                    Available now
                  </span>
                  <Link href={`/h/${host.handle}`} className={warm.button}>
                    Call now
                  </Link>
                </p>
              ) : !host.handle ? (
                <p className="mt-1 opacity-70">Not taking calls at the moment.</p>
              ) : null}
              {host.nextCall && (
                <p className="mt-2">
                  Your next call: <LocalTime iso={host.nextCall.startsAt.toISOString()} />.{" "}
                  <Link href={`/calls/${host.nextCall.id}`} className="underline underline-offset-2">
                    Go to the call
                  </Link>
                </p>
              )}
              <form action={unfollowAction} className="mt-3">
                <input type="hidden" name="hostId" value={host.hostId} />
                <input type="hidden" name="back" value="/following" />
                <button type="submit" className="inline-flex min-h-11 items-center underline underline-offset-2 opacity-70" title={`Stop following ${host.name}`}>
                  Unfollow
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-sm">
        <Link href="/contacts" className="inline-flex min-h-11 items-center underline underline-offset-2">
          People you have talked to
        </Link>
      </p>
    </SitePage>
  );
}
