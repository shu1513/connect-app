import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { RefreshEvery } from "@/components/refresh-every";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { followEmailsOf } from "@/lib/follows/emails";
import { followedHosts } from "@/lib/follows/follows";
import { EMAILS, FOLLOW, followEmailsOn } from "@/lib/follows/rules";
import { readNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { saveChoicesAction, unfollowAction } from "./actions";

const HOURS = Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}` }));

export const metadata: Metadata = { title: "Hosts you follow" };

// Who is available changes by the minute: always built fresh.
export const dynamic = "force-dynamic";

/** The hosts this person follows: who is available now, and their next call with each. Only they ever see it. */
export default async function FollowingPage(props: PageProps<"/following">) {
  const user = await requireUser("/following");
  const notice = readNotice("/following", await props.searchParams);
  const hosts = await followedHosts(user.id, new Date());
  // The emails of plans/31, only while they are switched on for the whole site (there is a postal address for them).
  const emails = followEmailsOn() ? { accountOn: await followEmailsOf(user.id) } : null;

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

      {emails && hosts.length > 0 && (
        <p className="mt-4 text-sm opacity-70" data-email-note>
          You can get an email about a host, if you tick it below: at most one of each kind per host in {EMAILS.perHostHours} hours, and {EMAILS.perDay} a day in all. The hours are in
          your own time zone{user.timeZone ? ` (${user.timeZone.replace(/_/g, " ")})` : ""}.
          {!emails.accountOn && (
            <>
              {" "}
              <strong>Emails about hosts are switched off for your account</strong>, so none are sent whatever is ticked.{" "}
              <Link href="/account" className="underline underline-offset-2">
                Switch them on
              </Link>
            </>
          )}
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
              {emails && (
                <form action={saveChoicesAction} className="mt-4 border-t border-neutral-300/60 pt-3" data-email-choices>
                  <input type="hidden" name="hostId" value={host.hostId} />
                  <fieldset>
                    <legend className="font-semibold">Emails about {host.name}</legend>
                    <label className="mt-2 flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="online" defaultChecked={host.tellOnline} /> When they are available now
                    </label>
                    <p className="flex flex-wrap items-center gap-2 pl-6">
                      <label className="flex items-center gap-2">
                        <span>only between</span>
                        <select name="from" defaultValue={host.hoursFrom === null ? "" : String(host.hoursFrom / 60)} className={warm.input}>
                          <option value="">any time</option>
                          {HOURS.map(({ hour, label }) => (
                            <option key={hour} value={hour}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        <span>and</span>
                        <select name="to" defaultValue={host.hoursTo === null ? "" : String(host.hoursTo / 60)} className={warm.input}>
                          <option value="">any time</option>
                          {HOURS.map(({ hour, label }) => (
                            <option key={hour} value={hour}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </p>
                    <label className="mt-1 flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="posts" defaultChecked={host.tellPosts} /> When they write in their diary
                    </label>
                  </fieldset>
                  <button type="submit" className={`${warm.secondary} mt-2`}>
                    Save
                  </button>
                </form>
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
