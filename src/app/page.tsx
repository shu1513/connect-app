import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import Link from "next/link";
import { CallsByDay, type ListedCall } from "@/components/calls-by-day";
import { Countdown } from "@/components/countdown";
import { DiaryPicture } from "@/components/diary-picture";
import { HostPhoto } from "@/components/host-photo";
import { LocalTime } from "@/components/local-time";
import { RefreshEvery } from "@/components/refresh-every";
import { SitePage } from "@/components/site-page";
import { SuggestedHosts } from "@/components/suggested-hosts";
import { MakeSuggestions } from "@/components/suggestions-watch";
import { warm, warmFont } from "@/components/warm-ui";
import { db, schema } from "@/db";
import { requestsOfCustomer, waitingForHost } from "@/lib/booking/bookings";
import { PASSED_OVER } from "@/lib/booking/rules";
import { roomOpensAt, roomState } from "@/lib/calls";
import { diaryNews, followedHosts } from "@/lib/follows/follows";
import { FOLLOW } from "@/lib/follows/rules";
import { notPaidYet, paymentLine, paymentsByCall } from "@/lib/home/payment-line";
import { HOME, nextCall } from "@/lib/home/rules";
import { readNotice } from "@/lib/notice";
import { photosOf } from "@/lib/profiles/photo";
import { picturesOf } from "@/lib/projects/pictures";
import { firstLines } from "@/lib/projects/rules";
import { callsToRate } from "@/lib/ratings/ratings";
import { getSignedIn, requireUser } from "@/lib/session";
import { todaysSuggestions } from "@/lib/suggestions/suggestions";

const REQUEST_LABEL: Record<string, string> = {
  card: "card details needed to send it",
  waiting: "waiting for the host's answer",
  declined: "the host could not take it",
  passed_over: "the host accepted another request for that time",
  ran_out: "ended without an answer",
  taken_back: "you took it back",
};
/** A booking a member made with their membership time that is not (or not yet) a call. */
const MEMBER_REQUEST_LABEL: Record<string, string> = {
  paying: "this month's payment is being taken; open it to finish the booking",
  ran_out: "not booked",
};

/** What a visitor sees at the front address: what Connect is, and the ways in. */
function FrontPage() {
  const focus = warm.focus;
  const footerLink = `inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-2 hover:text-[#9a3412] ${focus}`;
  return (
    <div className={`${warmFont.className} ${warm.root}`}>
      <header data-site-header="visitor" className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-4 p-6">
        <Link href="/" className={`inline-flex min-h-11 items-center text-[22px] font-extrabold ${focus}`}>
          Connect
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-5 text-[15px]">
          <Link href="/login" className={`inline-flex min-h-11 min-w-11 items-center text-[#44403c] hover:underline ${focus}`}>
            Log in
          </Link>
          <Link href="/signup" className={`inline-flex min-h-11 items-center rounded-full bg-[#1c1917] px-[18px] py-2.5 font-semibold text-white hover:bg-[#44403c] ${focus}`}>
            Sign up
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-[760px] px-6 pt-12 pb-10 text-center sm:pt-[72px]">
        <div aria-hidden="true" className="mb-7 flex justify-center">
          <div className="size-16 rounded-full border-4 border-[#fffbf7] bg-[#fdba74]" />
          <div className="-ml-4 size-16 rounded-full border-4 border-[#fffbf7] bg-[#c2410c]" />
        </div>
        <h1 className="text-[36px] leading-[1.1] font-extrabold tracking-[-0.02em] sm:text-[52px]">Go from following to talking.</h1>
        <p className="mx-auto mt-5 max-w-[560px] text-[19px] leading-[1.6] text-[#57534e]">
          A private video call, just the two of you. You choose who, when and for how long.
        </p>

        <form action="/search" method="get" className={`${warm.searchPill} mx-auto mt-9 max-w-[560px]`}>
          <label htmlFor="front-search" className="sr-only">Who would you like to talk to?</label>
          <input
            id="front-search"
            name="q"
            type="search"
            maxLength={50}
            placeholder="Who would you like to talk to?"
            aria-describedby="front-search-hint"
            className={`${warm.searchInput} ${focus}`}
          />
          <button type="submit" className={`${warm.button} ${focus}`}>
            Search
          </button>
        </form>
        <p id="front-search-hint" className="mt-3.5 text-sm text-[#78716c]">Type a name or their @handle from Instagram, TikTok or YouTube.</p>
        <p className="mt-10 flex flex-wrap items-center justify-center gap-2 text-[15px] text-[#57534e]">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span>Every host&apos;s ID is checked. Nothing is charged when you ask.</span>
        </p>
      </main>

      <footer className="mx-auto flex max-w-[1040px] flex-wrap justify-center gap-x-5 px-6 pt-6 pb-12 text-sm text-[#57534e]">
        <Link href="/host" className={`${footerLink} font-semibold text-[#9a3412]`}>Become a host</Link>
        <Link href="/rules" className={footerLink}>Rules</Link>
        <Link href="/terms" className={footerLink}>Terms</Link>
        <Link href="/privacy" className={footerLink}>Privacy</Link>
      </footer>
    </div>
  );
}

/**
 * The home page of someone who is logged in (plans/36-customer-home-page.md), from top to bottom:
 * the next call with its countdown, what is waiting for them, their next calls by day, the hosts
 * they follow, news from those hosts, and suggested hosts (plans/37). Calls that are over are on /calls.
 *
 * One page for everyone: a person can be a customer and a host with the same account, so the
 * calls they host and the requests waiting for their answer are here too.
 *
 * Drawing this page only reads. It never opens a room: every way into a call is a link to the
 * call's own page, which decides who may enter.
 */
export default async function HomePage(props: PageProps<"/">) {
  // Nobody logged in: the front page. Someone part-way through signing up is still sent to their next step.
  if (!(await getSignedIn())) return <FrontPage />;
  const user = await requireUser();
  const notice = readNotice("/", await props.searchParams);
  const now = new Date();

  // Only this person's calls that are not over (rules.ts, `notOver`, said here to the database), the soonest first.
  const calls = await db
    .select()
    .from(schema.calls)
    .where(and(or(eq(schema.calls.hostId, user.id), eq(schema.calls.customerId, user.id)), isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt), gt(schema.calls.endsAt, now)))
    .orderBy(asc(schema.calls.startsAt), asc(schema.calls.endsAt));

  // Only the names of the people this person has calls with.
  const otherIds = [...new Set(calls.map((c) => (c.hostId === user.id ? c.customerId : c.hostId)))];
  // A customer knows their host by the display name on the host's page, never by the host's account name.
  const myHostIds = [...new Set(calls.filter((c) => c.customerId === user.id).map((c) => c.hostId))];
  const callIds = calls.map((c) => c.id);
  const [people, hostProfiles, payments, requests, toAnswer, toRate, followed] = await Promise.all([
    otherIds.length > 0 ? db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, otherIds)) : [],
    myHostIds.length > 0 ? db.select({ userId: schema.hostProfiles.userId, displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, myHostIds)) : [],
    callIds.length > 0 ? db.select().from(schema.payments).where(inArray(schema.payments.callId, callIds)) : [],
    requestsOfCustomer(user.id, now),
    waitingForHost(user.id),
    callsToRate(user.id, now),
    followedHosts(user.id, now),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const hostNameOf = new Map(hostProfiles.map((p) => [p.userId, p.displayName]));
  const paymentsOf = paymentsByCall(payments);
  const otherOf = (call: (typeof calls)[number]) => (call.hostId === user.id ? nameOf.get(call.customerId) : (hostNameOf.get(call.hostId) ?? nameOf.get(call.hostId))) ?? "Unknown";

  // "Hosts you follow": the first few in the list's own order (available now first). The rest are behind "See all".
  const shownHosts = followed.slice(0, HOME.hostsShown);
  // "News from your hosts" (plans/31, decision 9, and plans/36, decision 6): what anyone could read in those diaries.
  const news = followed.length > 0 ? await diaryNews(user.id, now) : [];
  const [photos, pictures, suggested] = await Promise.all([
    // A photo is fetched from its own address, which decides afresh who may see it; a followed host whose page is not open is shown by name only.
    photosOf([...new Set([...myHostIds, ...shownHosts.filter((host) => host.handle).map((host) => host.hostId), ...news.map((post) => post.hostId)])]),
    // Only the pictures everyone may see.
    picturesOf(news.map((post) => post.postId)),
    // "Suggested hosts" (plans/37): only read here. A paused person gets none.
    user.paused ? null : todaysSuggestions(user.id, now),
  ]);

  // The time the countdown counts from, and by which a room counts as open: taken here, after everything was read,
  // so the time the reads took is not lost. (Which calls are not over was asked at `now`, a moment earlier.)
  const drawn = new Date();
  const listed: ListedCall[] = calls.map((call) => ({
    id: call.id,
    startsAt: call.startsAt.toISOString(),
    minutes: Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / 60_000),
    name: otherOf(call),
    photoId: call.customerId === user.id ? (photos.get(call.hostId) ?? null) : null,
    hosting: call.hostId === user.id,
    open: roomState(call, drawn) === "open",
    payment: paymentLine(paymentsOf.get(call.id) ?? []),
  }));
  const next = nextCall(calls, drawn);
  const nextListed = next ? listed.find((call) => call.id === next.id)! : null;
  const firstName = user.name.trim().split(/\s+/)[0] ?? "";
  const sectionTitle = "text-lg font-bold";
  const plainLink = "inline-flex min-h-11 items-center underline underline-offset-2";

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      {/*
        Who is available, which room is open, a follow that comes by itself after a call and a call that is to be
        rated all appear without a reload: the page asks the server again every minute while it is in front.
      */}
      <RefreshEvery seconds={FOLLOW.refreshSeconds} />
      <h1 className={warm.title}>{firstName ? `Hello, ${firstName}` : "Hello"}</h1>

      {user.paused && (
        <p className="mt-6 rounded border border-red-600 p-3 text-sm">
          Your account is paused: you can look, but not book, host or join calls.{" "}
          <Link href="/paused" className="underline underline-offset-2">
            Why, and what to do
          </Link>
        </p>
      )}

      {notice && (
        <p role="status" className="mt-6 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {next && nextListed ? (
        <section className={`${roomState(next, drawn) === "open" ? warm.available : warm.card} mt-6`} data-next-call={next.id}>
          <h2 className="text-sm font-bold text-[#9a3412]">Your next call</h2>
          <div className="mt-3 flex items-center gap-3">
            <HostPhoto photoId={nextListed.photoId} name={nextListed.name} />
            <div className="min-w-0">
              <p className="text-xl font-extrabold">{nextListed.name}</p>
              <p className="text-sm text-[#57534e]">
                <LocalTime iso={nextListed.startsAt} /> · {nextListed.minutes} minutes
              </p>
              <p className="text-sm text-[#57534e]">
                {nextListed.payment}
                {nextListed.hosting && " · You host this call"}
              </p>
            </div>
          </div>
          <Countdown
            callId={next.id}
            serverNow={drawn.toISOString()}
            opensAt={roomOpensAt(next).toISOString()}
            startsAt={next.startsAt.toISOString()}
            endsAt={next.endsAt.toISOString()}
            open={roomState(next, drawn) === "open"}
            notPaid={notPaidYet(paymentsOf.get(next.id) ?? [])}
          />
        </section>
      ) : (
        <section className={`${warm.card} mt-6`} data-next-call="none">
          <h2 className="text-sm font-bold text-[#9a3412]">Your next call</h2>
          <p className="mt-2 text-[#57534e]">
            {followed.length === 0 && requests.length === 0
              ? "Welcome to Connect. Find someone you follow, and ask them for a call."
              : "You have no call coming up. Find a host to ask for one."}
          </p>
          <form action="/search" method="get" className={`${warm.searchPill} mt-4`}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Find a host by name, handle or social media name</span>
              <input name="q" type="search" maxLength={50} placeholder="Name, @handle or social media name" className={`${warm.searchInput} w-full`} />
            </label>
            <button type="submit" className={warm.button}>
              Search
            </button>
          </form>
        </section>
      )}

      {(toRate.length > 0 || toAnswer.length > 0) && (
        <section className="mt-6 rounded-3xl border border-[#fed7aa] bg-[#fff7ed] p-5 text-sm" data-waiting>
          <h2 className={sectionTitle}>Waiting for you</h2>
          {toAnswer.length > 0 && (
            <p className="mt-1">
              You have {toAnswer.length} {toAnswer.length === 1 ? "request" : "requests"} for a call waiting for your answer.{" "}
              <Link href="/host/requests" className={plainLink}>
                See {toAnswer.length === 1 ? "it" : "them"}
              </Link>
            </p>
          )}
          {toRate.length > 0 && (
            <>
              <h3 className="mt-2 font-semibold">Waiting for your rating</h3>
              <ul>
                {toRate.map((call) => (
                  <li key={call.callId}>
                    <Link href={`/calls/${call.callId}/results`} className={plainLink}>
                      Rate your call with {call.otherName}
                    </Link>{" "}
                    <span className="text-[#57534e]">
                      (<LocalTime iso={call.endsAt.toISOString()} />)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* One call is already in the card above; the list is for seeing several together. */}
      {listed.length > 1 && (
        <section className={`${warm.card} mt-6`} data-calls="coming-up">
          <h2 className={sectionTitle}>Your next calls</h2>
          <div className="mt-2">
            <CallsByDay calls={listed} serverNow={drawn.toISOString()} />
          </div>
        </section>
      )}

      {requests.length > 0 && (
        <section className={`${warm.card} mt-6`} data-requests>
          <h2 className={sectionTitle}>Your requests</h2>
          <ul className="mt-1 text-sm">
            {requests.map(({ booking, hostName }) => (
              <li key={booking.id}>
                <Link href={`/bookings/${booking.id}`} className={plainLink}>
                  {hostName}, <LocalTime iso={booking.startsAt.toISOString()} />
                </Link>
                : {(booking.source === "member" ? MEMBER_REQUEST_LABEL[booking.stage] : booking.endedReason === PASSED_OVER.ownCall ? PASSED_OVER.ownCall : REQUEST_LABEL[booking.stage]) ?? booking.stage}
              </li>
            ))}
          </ul>
        </section>
      )}

      {followed.length > 0 && (
        <section className={`${warm.card} mt-6`} data-followed-hosts>
          <h2 className={sectionTitle}>Hosts you follow</h2>
          <ul className="mt-2">
            {shownHosts.map((host) => (
              <li key={host.hostId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#e7e5e4] py-2 first:border-t-0" data-followed={host.available ? "available" : "not"}>
                <HostPhoto photoId={host.handle ? (photos.get(host.hostId) ?? null) : null} name={host.name} small />
                <div className="min-w-0 flex-1">
                  {host.handle ? (
                    <Link href={`/h/${host.handle}`} className="inline-flex min-h-11 items-center font-bold underline decoration-[#c2410c] underline-offset-4">
                      {host.name}
                    </Link>
                  ) : (
                    <span className="font-bold">{host.name}</span>
                  )}
                  {host.available && host.handle && (
                    <p className="text-sm font-semibold">
                      <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600" />
                      Available now
                    </p>
                  )}
                </div>
                {host.available && host.handle && (
                  <Link href={`/h/${host.handle}`} className={warm.button}>
                    Call now
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm">
            <Link href="/following" className={plainLink}>
              {followed.length > shownHosts.length ? `See all ${followed.length}` : "See all"}
            </Link>
          </p>
        </section>
      )}

      {news.length > 0 && (
        <section className={`${warm.card} mt-6`} data-diary-news>
          <h2 className={sectionTitle}>News from your hosts</h2>
          <ul className="mt-2">
            {news.map((post) => {
              const picture = (pictures.get(post.postId) ?? [])[0];
              return (
                <li key={post.postId} className="border-t border-[#e7e5e4] py-4 first:border-t-0" data-news-post={post.postId}>
                  <div className="flex items-center gap-3">
                    <HostPhoto photoId={photos.get(post.hostId) ?? null} name={post.hostName} small />
                    <p className="min-w-0 text-sm">
                      <span className="font-bold">{post.hostName}</span> in {post.projectName}
                      <br />
                      <span className="text-[#57534e]">
                        <LocalTime iso={post.writtenAt.toISOString()} />
                      </span>
                    </p>
                  </div>
                  {picture && (
                    <p className="mt-3">
                      <DiaryPicture id={picture.id} width={picture.width} height={picture.height} />
                    </p>
                  )}
                  <p className="mt-3 text-[#44403c]" data-news-text>{firstLines(post.text, HOME.newsLetters)}</p>
                  <p className="text-sm">
                    <Link href={`/h/${post.handle}/project/${post.projectId}`} className={plainLink}>
                      Read the diary
                    </Link>
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Today's suggestions are made by the browser's own request, a moment after the page is there; drawing the page never writes. */}
      {suggested && !suggested.made && <MakeSuggestions key={suggested.day} />}
      {suggested && <SuggestedHosts day={suggested.day} hosts={suggested.hosts} />}

      <p className="mt-8 flex flex-wrap gap-x-6 text-sm">
        <Link href="/calls" className={plainLink}>
          Past calls
        </Link>
        <Link href="/contacts" className={plainLink}>
          People you have talked to
        </Link>
        {calls.length === 0 && (
          <Link href="/host" className={plainLink}>
            Take calls yourself
          </Link>
        )}
      </p>
    </SitePage>
  );
}
