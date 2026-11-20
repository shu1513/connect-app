import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import Link from "next/link";
import type { ListedCall } from "@/components/call-row";
import { CallsCalendar } from "@/components/calls-calendar";
import { Countdown } from "@/components/countdown";
import { CustomerDetailsLines } from "@/components/customer-details";
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
import { asksByTime, CALENDAR, parseDay, viewRange } from "@/lib/home/calendar";
import { customerDetailsFor } from "@/lib/home/customer-details";
import { earnedFrom, unsettled } from "@/lib/home/earned";
import { diaryNews, followedHosts } from "@/lib/follows/follows";
import { FOLLOW } from "@/lib/follows/rules";
import { notPaidYet, paymentLine, paymentsByCall } from "@/lib/home/payment-line";
import { HOME, nextCall, notOver } from "@/lib/home/rules";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { currentSplit } from "@/lib/payments/actions";
import { photosOf } from "@/lib/profiles/photo";
import { picturesOf } from "@/lib/projects/pictures";
import { firstLines } from "@/lib/projects/rules";
import { callsToRate } from "@/lib/ratings/ratings";
import { getSignedIn, requireUser } from "@/lib/session";
import { todaysSuggestions } from "@/lib/suggestions/suggestions";
import { RequestList, timesAskedFor } from "./host/requests/request-list";

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
 * the next call with its countdown, what is waiting for them, their calendar (plans/43), the hosts
 * they follow, news from those hosts, and suggested hosts (plans/37). Calls that are over are on /calls.
 *
 * One page for everyone: a person can be a customer and a host with the same account, so the
 * calls they host and the requests waiting for their answer are here too. A host sees more on it
 * (plans/38-host-home-page.md): what she should know about the customer of each call she hosts,
 * the requests themselves with Accept and Decline, and a line of shortcuts. Those parts appear
 * when there is something to show; someone who only books calls sees the page of plan 36.
 *
 * Drawing this page only reads. It never opens a room: every way into a call is a link to the
 * call's own page, which decides who may enter.
 */
export default async function HomePage(props: PageProps<"/">) {
  // Nobody logged in: the front page. Someone part-way through signing up is still sent to their next step.
  if (!(await getSignedIn())) return <FrontPage />;
  const user = await requireUser();
  const query = await props.searchParams;
  const notice = readNotice("/", query);
  const now = new Date();
  // The day the calendar is asked to show (plans/43); anything that is not a real day is read as today.
  const day = parseDay(query.day);
  const around = viewRange(day, now);
  const mine = or(eq(schema.calls.hostId, user.id), eq(schema.calls.customerId, user.id));

  const notOverYet = and(isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt), gt(schema.calls.endsAt, now));
  // The middle of those days, on the world's clock: when more calls touch them than are shown, the nearest to it are kept.
  const middle = Math.round((around.from.getTime() + around.to.getTime()) / 2000);

  const [soonest, hostedOne, nearby] = await Promise.all([
    // For the card of the next call: this person's soonest calls that are not over (rules.ts, `notOver`, said here to the
    // database). A few, not one: the first may be over a moment later, when the page is drawn.
    db.select().from(schema.calls).where(and(mine, notOverYet)).orderBy(asc(schema.calls.startsAt), asc(schema.calls.endsAt)).limit(3),
    // Whether this person hosts a call that is not over, wherever in time: one of the ways to have hosting to do.
    db.select({ id: schema.calls.id }).from(schema.calls).where(and(eq(schema.calls.hostId, user.id), notOverYet)).limit(1),
    // For the calendar: this person's calls that touch the days around the day asked for, also the ones that are over.
    // Never a cancelled one. One more than is shown, to know whether some are left out.
    db
      .select()
      .from(schema.calls)
      .where(and(mine, isNull(schema.calls.cancelledAt), lt(schema.calls.startsAt, around.to), gt(schema.calls.endsAt, around.from)))
      .orderBy(sql`abs(extract(epoch from ${schema.calls.startsAt}) - ${middle})`, asc(schema.calls.id))
      .limit(CALENDAR.most + 1),
  ]);
  const cut = nearby.length > CALENDAR.most;
  // Every call the page speaks of, each once and in order: the ones around the day in view, and the soonest ones for
  // the card. Never more than that, however many calls a person has (plans/43).
  const every = [...new Map([...soonest, ...nearby.slice(0, CALENDAR.most)].map((call) => [call.id, call])).values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime());
  // Someone with no call at all, past or coming, gets no calendar. Asked only when none is in sight.
  const hasCalls = every.length > 0 || (await db.select({ id: schema.calls.id }).from(schema.calls).where(and(mine, isNull(schema.calls.cancelledAt))).limit(1)).length > 0;

  // Only the names of the people this person has calls with.
  const otherIds = [...new Set(every.map((c) => (c.hostId === user.id ? c.customerId : c.hostId)))];
  // A customer knows their host by the display name on the host's page, never by the host's account name.
  const myHostIds = [...new Set(every.filter((c) => c.customerId === user.id).map((c) => c.hostId))];
  const callIds = every.map((c) => c.id);
  const [people, hostProfiles, payments, requests, toAnswer, toRate, followed, aboutOf, ownProfiles] = await Promise.all([
    otherIds.length > 0 ? db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, otherIds)) : [],
    myHostIds.length > 0 ? db.select({ userId: schema.hostProfiles.userId, displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, myHostIds)) : [],
    callIds.length > 0 ? db.select().from(schema.payments).where(inArray(schema.payments.callId, callIds)) : [],
    requestsOfCustomer(user.id, now),
    waitingForHost(user.id),
    callsToRate(user.id, now),
    followedHosts(user.id, now),
    // About the customers of the calls this person hosts, and of no other call (plans/38). Nothing is asked for someone who
    // hosts none. Only for calls that are not over: beside a finished call, "calls before" would count that call itself.
    customerDetailsFor(
      user.id,
      every.filter((call) => notOver(call, now)),
      now,
    ),
    // This person's own host profile, for the shortcuts: only whether there is one, where it is, and how it stands.
    db.select({ handle: schema.hostProfiles.handle, status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id)),
  ]);
  const ownProfile = ownProfiles[0] ?? null;
  // Who has hosting to do. Not only an approved profile: a host who changed her display name waits for approval
  // again, and a declined or suspended host can still have calls booked.
  const hosts = ownProfile?.status === "approved" || hostedOne.length > 0 || toAnswer.length > 0;
  const requestTimes = timesAskedFor(toAnswer);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const hostNameOf = new Map(hostProfiles.map((p) => [p.userId, p.displayName]));
  const paymentsOf = paymentsByCall(payments);
  const otherOf = (call: (typeof every)[number]) => (call.hostId === user.id ? nameOf.get(call.customerId) : (hostNameOf.get(call.hostId) ?? nameOf.get(call.hostId))) ?? "Unknown";

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
  // Each call as the page draws it: the words and numbers only, never a whole record (plans/43, decision 18).
  const listed: ListedCall[] = every.map((call) => {
    const hosting = call.hostId === user.id;
    const finished = Boolean(call.safetyEndedAt) || call.endsAt.getTime() <= drawn.getTime();
    const paid = paymentsOf.get(call.id) ?? [];
    // What a finished call earned its host (plans/43, decision 8): her share of each charge, by the one rule for that.
    // Worked out here, and only for a call this person hosted.
    const parts = hosting && finished ? paid.map((payment) => ({ status: payment.status, needsReview: payment.needsReview, shareCents: payment.status === "charged" ? currentSplit(payment).hostShareCents : 0 })) : null;
    const earned = parts ? earnedFrom(parts) : null;
    return {
      id: call.id,
      startsAt: call.startsAt.toISOString(),
      endsAt: call.endsAt.toISOString(),
      minutes: Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / 60_000),
      name: otherOf(call),
      // The host's photo for a call this person booked; the customer's for a call they host that is not over, when they are handed one.
      photoId: call.customerId === user.id ? (photos.get(call.hostId) ?? null) : finished ? null : (aboutOf.get(call.id)?.photoId ?? null),
      hosting,
      open: roomState(call, drawn) === "open",
      finished,
      payment: paymentLine(paid),
      ...(earned ? { earned: { text: formatMoney(earned.cents), cents: earned.cents, soFar: earned.soFar } } : {}),
      ...(parts && unsettled(parts) ? { moneyOpen: true } : {}),
      // Only ever set for a call this person hosts that is not over: `customerDetailsFor` answers for no other.
      ...(finished ? {} : { about: aboutOf.get(call.id)?.details }),
    };
  });
  // The times people have asked this person for and that wait for her answer (plans/43, decision 10): for each time
  // only how many asked. Who they are, and what they wrote, is in the list of requests above the calendar.
  const asks = asksByTime(
    toAnswer.map(({ booking }) => ({ startsAt: booking.startsAt, endsAt: booking.endsAt })),
    around,
  );
  const next = nextCall(soonest, drawn);
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

      {hosts && (
        <nav aria-label="Hosting" className="mt-2 text-sm" data-host-shortcuts>
          <p className="flex flex-wrap items-center gap-x-5">
            <span className="font-bold text-[#9a3412]">Hosting</span>
            <Link href="/host/now" className={plainLink}>
              Available now
            </Link>
            <Link href="/host/calendar" className={plainLink}>
              Your calendar
            </Link>
            <Link href="/host#paid" className={plainLink}>
              Earnings
            </Link>
            <Link href="/host" className={plainLink}>
              Settings
            </Link>
          </p>
          {ownProfile?.status === "approved" && !ownProfile.hidden && (
            <p className="text-[#57534e]">
              Your page:{" "}
              <Link href={`/h/${ownProfile.handle}`} className={plainLink}>
                /h/{ownProfile.handle}
              </Link>
            </p>
          )}
        </nav>
      )}

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
          {nextListed.about && (
            <div className="mt-3 text-sm">
              <CustomerDetailsLines callId={next.id} name={nextListed.name} about={nextListed.about} />
            </div>
          )}
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
            <div data-requests-to-answer>
              <p className="mt-1">
                You have {toAnswer.length} {toAnswer.length === 1 ? "request" : "requests"} for a call waiting for your answer.
              </p>
              {/* The requests themselves, to answer here (plans/38): the list of the requests page, its first few times. */}
              <div className="mt-3">
                <RequestList hostId={user.id} waiting={toAnswer} from="home" times={HOME.requestTimesShown} />
              </div>
              <p>
                <Link href="/host/requests" className={plainLink}>
                  {requestTimes > HOME.requestTimesShown ? `See all ${toAnswer.length} requests` : "The requests page"}
                </Link>
              </p>
            </div>
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

      {/* The calendar (plans/43): the calls of the days in view, also the ones that are over. Not for someone who never had a call. */}
      {hasCalls && (
        <section className={`${warm.card} mt-6`} data-calendar>
          <h2 className={sectionTitle}>Your calendar</h2>
          <div className="mt-2">
            <CallsCalendar calls={listed} asks={asks} serverNow={drawn.toISOString()} day={day} nextId={next?.id ?? null} cut={cut} />
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
        {soonest.length === 0 && (
          <Link href="/host" className={plainLink}>
            Take calls yourself
          </Link>
        )}
      </p>
    </SitePage>
  );
}
