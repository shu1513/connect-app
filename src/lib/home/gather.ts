/**
 * Everything the home page of someone who is logged in is made of (plans/36, 37, 38, 41, 42, 43),
 * put together in one place for the two that show it: the website's page (src/app/page.tsx) and
 * the phone app's address (src/app/api/app/home/route.ts, plans/45-phone-apps/04-the-home-page.md).
 * So the two can never come to differ about which calls a person sees, what a host is told about
 * a customer, or what a call earned.
 *
 * It only reads. It never opens a room, and it never makes suggestions (that is a separate step,
 * asked for after the page is up).
 *
 * `diary`: the news from followed hosts' diaries, and its pictures. The website's page asks for
 * it; the phone app never does (projects are not in the apps), and then nothing of a diary is
 * read at all.
 */
import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { ListedCall } from "@/components/call-row";
import { db, schema } from "@/db";
import { requestsOfCustomer, waitingForHost } from "@/lib/booking/bookings";
import { diaryNews, followedHosts } from "@/lib/follows/follows";
import { asksByTime, CALENDAR, parseDay, viewRange } from "@/lib/home/calendar";
import { customerDetailsFor } from "@/lib/home/customer-details";
import { listedCall } from "@/lib/home/list-calls";
import { paymentsByCall } from "@/lib/home/payment-line";
import { HOME, nextCall, notOver } from "@/lib/home/rules";
import { photosOf } from "@/lib/profiles/photo";
import { picturesOf } from "@/lib/projects/pictures";
import { callsToRate } from "@/lib/ratings/ratings";
import { todaysSuggestions } from "@/lib/suggestions/suggestions";

export async function gatherHome(user: { id: string; name: string; paused: boolean }, dayAsked: unknown, options: { diary: boolean }) {
  const now = new Date();
  // The day the calendar is asked to show (plans/43); anything that is not a real day is read as today.
  const day = parseDay(dayAsked);
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
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const hostNameOf = new Map(hostProfiles.map((p) => [p.userId, p.displayName]));
  const paymentsOf = paymentsByCall(payments);
  const otherOf = (call: (typeof every)[number]) => (call.hostId === user.id ? nameOf.get(call.customerId) : (hostNameOf.get(call.hostId) ?? nameOf.get(call.hostId))) ?? "Unknown";

  // "Hosts you follow": the first few in the list's own order (available now first). The rest are behind "See all".
  const shownHosts = followed.slice(0, HOME.hostsShown);
  // "News from your hosts" (plans/31, decision 9, and plans/36, decision 6): what anyone could read in those diaries.
  const news = options.diary && followed.length > 0 ? await diaryNews(user.id, now) : [];
  const [photos, pictures, suggested] = await Promise.all([
    // A photo is fetched from its own address, which decides afresh who may see it; a followed host whose page is not open is shown by name only.
    photosOf([...new Set([...myHostIds, ...shownHosts.filter((host) => host.handle).map((host) => host.hostId), ...news.map((post) => post.hostId)])]),
    // Only the pictures everyone may see. With no news (always so for the phone app) there is nothing to ask for, and nothing is read.
    picturesOf(news.map((post) => post.postId)),
    // "Suggested hosts" (plans/37): only read here. A paused person gets none.
    user.paused ? null : todaysSuggestions(user.id, now),
  ]);

  // The time the countdown counts from, and by which a room counts as open: taken here, after everything was read,
  // so the time the reads took is not lost. (Which calls are not over was asked at `now`, a moment earlier.)
  const drawn = new Date();
  // Each call as the page draws it, through the one function that describes a call for every list (list-calls.ts).
  const context = { userId: user.id, drawn, paymentsOf, photos, aboutOf, otherOf };
  const listed: ListedCall[] = every.map((call) => listedCall(call, context));
  // The times people have asked this person for and that wait for her answer (plans/43, decision 10): for each time
  // only how many asked. Who they are, and what they wrote, is in the list of requests above the calendar.
  const asks = asksByTime(
    toAnswer.map(({ booking }) => ({ startsAt: booking.startsAt, endsAt: booking.endsAt })),
    around,
  );
  const next = nextCall(soonest, drawn);
  const nextListed = next ? listed.find((call) => call.id === next.id)! : null;
  return {
    /** The moment the page was put together: what the countdown counts from, and by which a room counts as open. */
    drawn,
    day,
    /** More calls touch the days in view than are shown. */
    cut,
    hasCalls,
    /** This person's soonest calls that are not over (a few), as the database has them. */
    soonest,
    next,
    nextListed,
    listed,
    asks,
    paymentsOf,
    requests,
    toAnswer,
    toRate,
    followed,
    shownHosts,
    news,
    photos,
    pictures,
    suggested,
    ownProfile,
    hosts,
  };
}

export type HomeGathered = Awaited<ReturnType<typeof gatherHome>>;
