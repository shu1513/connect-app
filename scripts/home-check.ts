/**
 * Testing tool: the home page and "Past calls" (plans/36), and what a host sees on the home page
 * (plans/38), read from the running app the way a browser gets them, against the local database.
 *
 * What is real and what is pretended:
 *   real       sign-up and the confirmation link (so each person has a real login), and every
 *              page, fetched with that person's login.
 *   pretended  the two tick boxes of the welcome step; the hosts, calls, follows, projects, posts
 *              and pictures, which are written straight to the database.
 *
 * It makes its own people, touches no other account, needs no Stripe, and removes what it made.
 * It clears the local "too many attempts" counters at the start and the end, because every
 * request here comes from one network address.
 *
 * It reads the page as the server sends it. What only happens in the browser (the seconds moving,
 * "Today" and "Tomorrow" in the person's own time zone, asking again at zero) is covered by the
 * tests of the plain rules and by a try in a real browser.
 *
 * Usage: npx tsx scripts/home-check.ts            (the app on http://localhost:3000)
 *        npx tsx scripts/home-check.ts --app=http://localhost:3210
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, like, ne, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;

/** One request to the app, the way a browser would send it. Cookies are kept in the jar. Redirects are not followed. */
async function send(path: string, options: { body?: unknown; jar?: Jar } = {}) {
  const headers: Record<string, string> = { origin: BASE };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    method: options.body !== undefined ? "POST" : "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair, ...attributes] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) options.jar?.delete(name);
    else options.jar?.set(name, value);
  }
  const text = await response.text();
  return { status: response.status, text, location: response.headers.get("location") };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unescape = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** What a person reads on a page: the text, without the markup. */
const words = (html: string) => unescape(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const count = (text: string, piece: string) => text.split(piece).length - 1;
/** The page without its scripts: the data the browser part is given is in there a second time. */
const markup = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ");

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { removeTestsOf } = await import("../src/lib/connection/tests");
  const { FOLLOW } = await import("../src/lib/follows/rules");
  const { HOME } = await import("../src/lib/home/rules");
  const { firstLines } = await import("../src/lib/projects/rules");

  const up = await send("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error(`The app is not running at ${BASE}. Start it first.`);
  await db.delete(schema.rateLimit);

  const now = new Date();
  const made: string[] = [];
  const calls: string[] = [];
  const projects: string[] = [];

  const page = async (path: string, jar?: Jar) => {
    const reply = await send(path, { jar });
    return { ...reply, html: markup(reply.text), words: words(reply.text) };
  };

  /** Signs up the way the form does, opens the link in the confirmation email, and ticks the welcome step (pretended). */
  async function signUp(name: string) {
    const person = { name: `Home ${name} ${RUN}`, email: `homecheck-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    await send("/api/auth/sign-up/email", { body: { name: person.name, email: person.email, password: person.password, callbackURL: "/welcome" } });
    let link = "";
    for (let i = 0; i < 25 && !link; i++) {
      const found = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, person.email), like(schema.emailOutbox.subject, "%Confirm your email%"))).orderBy(desc(schema.emailOutbox.createdAt));
      link = found[0]?.body.match(/https?:\/\/\S+/)?.[0] ?? "";
      if (!link) await pause(200);
    }
    if (!link) throw new Error(`No confirmation email for ${person.email}`);
    await send(link, { jar: person.jar });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    made.push(row.id);
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    return { ...person, id: row.id };
  }
  /** A person who never logs in here, written straight to the database. */
  async function person(name: string) {
    const id = `hm-${RUN}-${name}`;
    await db.insert(schema.user).values({ id, name: `Account ${name} ${RUN}`, email: `homecheck-${RUN}-${name}@example.test`, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Account ${name} ${RUN}` };
  }
  /** Makes someone a host whose page is open to everyone. */
  async function asHost<T extends { id: string }>(who: T, name: string, displayName: string) {
    const handle = `hm${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: who.id, handle, handleKey: handle, displayName, pricePer15Cents: 0, status: "approved", usConfirmedAt: now });
    return { ...who, handle, displayName };
  }
  const host = async (name: string, displayName: string) => asHost(await person(name), name, displayName);
  /** A host who can be asked for a call right now: free calls, a calendar open all week, "Available now" on. */
  async function goOnline(hostId: string) {
    await db.insert(schema.hostCalendars).values({ userId: hostId, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId, weekday, startMinute: 0, endMinute: 1440 })));
    const at = new Date();
    await db.update(schema.hostCalendars).set({ availableUntil: new Date(at.getTime() + 60 * MINUTE), availableSeenAt: at }).where(eq(schema.hostCalendars.userId, hostId));
  }
  /** A call of 30 minutes that starts so many minutes from now (a negative number: it started that long ago). */
  async function call(input: { hostId: string; customerId: string; startsInMinutes: number; cancelled?: boolean; safetyEnded?: boolean }) {
    const startsAt = new Date(Math.floor((Date.now() + input.startsInMinutes * MINUTE) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * MINUTE);
    const [row] = await db
      .insert(schema.calls)
      .values({
        hostId: input.hostId,
        customerId: input.customerId,
        startsAt,
        endsAt,
        roomName: `home-${randomUUID()}`,
        closedAt: endsAt.getTime() < Date.now() ? new Date(endsAt.getTime() + 1000) : null,
        cancelledAt: input.cancelled ? now : null,
        cancelledBy: input.cancelled ? "host" : null,
        safetyEndedAt: input.safetyEnded ? now : null,
      })
      .returning();
    calls.push(row.id);
    return row;
  }
  const listed = (html: string, callId: string) => html.includes(`data-call="${callId}"`);

  // --- for part 8 (plans/38) ---
  /** The request a call came from, sent to the host and accepted, as a real booking leaves it. */
  async function requestOf(row: { id: string; hostId: string; customerId: string; startsAt: Date; endsAt: Date }, more: { words?: string; source?: string } = {}) {
    await db.insert(schema.bookings).values({ hostId: row.hostId, customerId: row.customerId, startsAt: row.startsAt, endsAt: row.endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: more.words ?? "", stage: "accepted", source: more.source ?? "customer", requestKey: randomUUID(), requestedAt: now, decidedAt: now, callId: row.id });
  }
  /** A request that waits for the host's answer. */
  async function waitingRequest(hostId: string, customerId: string, startsInMinutes: number, words: string) {
    const startsAt = new Date(Math.floor((Date.now() + startsInMinutes * MINUTE) / 1000) * 1000);
    const [row] = await db
      .insert(schema.bookings)
      .values({ hostId, customerId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: words, stage: "waiting", requestKey: randomUUID(), requestedAt: now, respondBy: new Date(Date.now() + DAY) })
      .returning();
    return row;
  }
  /** The video service's word that these people joined the call. */
  async function joined(callId: string, who: string[]) {
    await db.insert(schema.attendanceEvents).values(who.map((id) => ({ provider: "homecheck", providerEventId: randomUUID(), callId, type: "participant_joined", participantIdentity: id, providerTime: now, payload: "{}" })));
  }
  /** The details a host is shown about the customer of one call: that part of the page, or "" when there is none. */
  const detailsOf = (html: string, callId: string) => {
    const from = html.indexOf(`data-customer-details="${callId}"`);
    if (from < 0) return "";
    const rest = html.slice(from + 30);
    const ends = [rest.indexOf("data-customer-details="), rest.indexOf("data-call="), rest.indexOf("data-countdown="), rest.indexOf("</section>")].filter((at) => at >= 0);
    return html.slice(from, from + 30 + Math.min(...ends, 6000));
  };
  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Someone new, and someone who is not logged in");
    const cust = await signUp("cust");
    {
      const home = await page("/", cust.jar);
      check("a new person gets the home page, with their first name", home.status === 200 && home.words.includes("Hello, Home"), String(home.status));
      check("no call: the card says so and offers the search box", home.html.includes('data-next-call="none"') && home.words.includes("Welcome to Connect") && home.html.includes('action="/search"'));
      check("nothing of what they do not have is shown", !home.html.includes("data-calls=") && !home.html.includes("data-followed-hosts") && !home.html.includes("data-diary-news") && !home.html.includes("data-waiting"));
      check("the top bar says Home", /<nav[\s\S]*?>\s*Home\s*<[\s\S]*?<\/nav>/.test(home.html) && !home.words.includes("Your calls"));
      check("their past calls page is empty", (await page("/calls", cust.jar)).words.includes("No past calls yet."));
      const visitor = await page("/");
      check("a visitor still gets the front page", visitor.status === 200 && visitor.words.includes("Go from following to talking."));
      check("past calls need a login", [302, 303, 307].includes((await page("/calls")).status));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. The next call and the countdown");
    const anna = await host("anna", `Anna Display ${RUN}`);
    const cancelledSoon = await call({ hostId: anna.id, customerId: cust.id, startsInMinutes: 10, cancelled: true });
    const reported = await call({ hostId: anna.id, customerId: cust.id, startsInMinutes: -5, safetyEnded: true });
    const over = await call({ hostId: anna.id, customerId: cust.id, startsInMinutes: -90 });
    const twoHours = await call({ hostId: anna.id, customerId: cust.id, startsInMinutes: 120 });
    const threeDays = await call({ hostId: anna.id, customerId: cust.id, startsInMinutes: 3 * 24 * 60 });
    {
      const home = await page("/", cust.jar);
      check("the card is about the soonest call that is not over", home.html.includes(`data-next-call="${twoHours.id}"`), home.html.match(/data-next-call="[^"]*"/)?.[0] ?? "no card");
      check("never a cancelled call or one ended with a report, though they are sooner", !home.html.includes(`data-next-call="${cancelledSoon.id}"`) && !home.html.includes(`data-next-call="${reported.id}"`));
      check("it counts down to the moment the room opens, five minutes before the start", home.html.includes('data-countdown="waiting"') && /You can enter in 1 hour 5[45] minutes/.test(home.words), home.words.match(/You can enter[^.]*/)?.[0] ?? "");
      check("and does not offer to enter yet", home.html.includes('data-enter="not-open"') && !home.words.includes("Enter the room") && home.words.includes("The room opens 5 minutes before the start."));
      check("the host is shown by the name on their page, never their account name", home.words.includes(anna.displayName) && !home.words.includes(anna.name));
      check("the list holds the calls that are not over", listed(home.html, twoHours.id) && listed(home.html, threeDays.id));
      check("and none that is cancelled, ended with a report, or over", !listed(home.html, cancelledSoon.id) && !listed(home.html, reported.id) && !listed(home.html, over.id));
      const past = await page("/calls", cust.jar);
      check("past calls hold exactly the others", listed(past.html, cancelledSoon.id) && listed(past.html, reported.id) && listed(past.html, over.id) && !listed(past.html, twoHours.id) && !listed(past.html, threeDays.id));
      check("with what became of each", past.words.includes("Cancelled") && past.words.includes("Ended") && past.words.includes(anna.displayName));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. A room that is open, and a call that is not paid");
    const soon = await call({ hostId: anna.id, customerId: cust.id, startsInMinutes: 3 });
    {
      let home = await page("/", cust.jar);
      check("a call whose room is open becomes the next call", home.html.includes(`data-next-call="${soon.id}"`));
      check("with the way in instead of a countdown", home.html.includes('data-countdown="open"') && home.html.includes('data-enter="open"') && home.words.includes("The room is open") && home.words.includes("Enter the room"));
      check("the way in is a link to the call's own page", new RegExp(`<a[^>]*href="/calls/${soon.id}"[^>]*data-enter="open"|<a[^>]*data-enter="open"[^>]*href="/calls/${soon.id}"`).test(home.html));
      check("it says when the booked start is, not that anyone has joined", /The call starts in [0-2]:\d\d\./.test(home.words), home.words.match(/The call starts[^.]*\./)?.[0] ?? "");
      await db.insert(schema.payments).values({ callId: soon.id, coversFrom: soon.startsAt, coversUntil: soon.endsAt, pricePer15Cents: 2000, bookedCents: 4000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150 });
      home = await page("/", cust.jar);
      check("a call that is not paid yet says so, and its button does not promise the room", home.html.includes('data-enter="not-paid"') && !home.words.includes("Enter the room") && home.words.includes("$40.00, not paid yet") && home.words.includes("Open the call"));
      await db.delete(schema.payments).where(eq(schema.payments.callId, soon.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Someone who hosts");
    const hostess = await asHost(await signUp("hostess"), "hostess", `Hanna Display ${RUN}`);
    const hosted = await call({ hostId: hostess.id, customerId: cust.id, startsInMinutes: 300 });
    {
      const hers = await page("/", hostess.jar);
      check("a host sees the call they host as their next call, with its label", hers.html.includes(`data-next-call="${hosted.id}"`) && hers.words.includes("You host this call"));
      check("and the customer by their account name", hers.words.includes(cust.name));
      const his = await page("/", cust.jar);
      check("the customer sees the same call in their list, under the host's display name", listed(his.html, hosted.id) && his.words.includes(hostess.displayName));
      check("and no host label on a call they do not host", count(his.html, "data-hosting") === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Hosts you follow");
    const online = await host("online", `Online Olga ${RUN}`);
    const blocker = await host("blocker", `Blocking Bea ${RUN}`);
    await goOnline(online.id);
    await goOnline(blocker.id);
    await db.insert(schema.follows).values([online, blocker, anna].map((h) => ({ followerId: cust.id, hostId: h.id, how: "self" })));
    await db.insert(schema.blocks).values({ blockerId: blocker.id, blockedId: cust.id });
    {
      const home = await page("/", cust.jar);
      const section = home.html.match(/<section[^>]*data-followed-hosts[\s\S]*?<\/section>/)?.[0] ?? "";
      const row = (name: string) => section.match(new RegExp(`<li[^>]*data-followed="(\\w+)"(?:(?!<li)[\\s\\S])*?${name}`))?.[1] ?? "missing";
      check("the hosts a person follows are there", [online, blocker, anna].every((h) => section.includes(h.displayName)));
      check("a host who is available now shows as available, with Call now", row(online.displayName) === "available" && words(section).includes("Available now") && words(section).includes("Call now"), row(online.displayName));
      check("a host who has blocked the follower never shows as available to them", row(blocker.displayName) === "not", row(blocker.displayName));
      check("the available host comes first", section.indexOf(online.displayName) < section.indexOf(anna.displayName) && section.indexOf(online.displayName) < section.indexOf(blocker.displayName));
      check("there is one Call now, and a way to the whole list", count(words(section), "Call now") === 1 && section.includes('href="/following"'));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. News from your hosts");
    {
      const [project] = await db.insert(schema.projects).values({ hostId: anna.id, name: `Album ${RUN}`, startedAt: new Date(now.getTime() - 60 * DAY) }).returning();
      projects.push(project.id);
      const post = async (minutesAgo: number, text: string, more: Partial<typeof schema.projectPosts.$inferInsert> = {}) => {
        const at = new Date(now.getTime() - minutesAgo * MINUTE);
        return (await db.insert(schema.projectPosts).values({ projectId: project.id, text, createdAt: at, updatedAt: at, ...more }).returning())[0];
      };
      const removed = await post(1, `Removed ${RUN}`, { removedAt: now });
      const hidden = await post(2, `Hidden ${RUN}`, { hiddenAt: now });
      // Older than the old limit of a week, and inside the new one.
      const weeksOld = await post(20 * 24 * 60, `Twenty days old ${RUN}`);
      const tooOld = await post((FOLLOW.newsDays + 1) * 24 * 60, `Too old ${RUN}`);
      const news = async () => {
        const home = await page("/", cust.jar);
        const section = home.html.match(/<section[^>]*data-diary-news[\s\S]*?<\/section>/)?.[0] ?? "";
        return { home, section, ids: [...section.matchAll(/data-news-post="([^"]+)"/g)].map((m) => m[1]) };
      };
      {
        // With only these four, nothing is cut by the number: what is missing is missing by its own rule.
        const { home, ids } = await news();
        check(`a post from the last ${FOLLOW.newsDays} days is there, also one older than a week`, ids.join() === weeksOld.id, ids.join());
        check("never a removed post, a hidden post, or one older than the limit", !ids.includes(removed.id) && !ids.includes(hidden.id) && !ids.includes(tooOld.id) && !home.words.includes(`Removed ${RUN}`) && !home.words.includes(`Hidden ${RUN}`) && !home.words.includes(`Too old ${RUN}`));
      }
      const normal = [];
      for (let i = 0; i < FOLLOW.newsPosts + 1; i++) normal.push(await post(10 + i, `Post ${i} of ${RUN}. ${"More words. ".repeat(40)}`));
      const picture = (postId: string, state: string, uploadedAt = now) => db.insert(schema.projectPictures).values({ postId, hostId: anna.id, width: 800, height: 600, byteLength: 1, sha256: randomUUID(), uploadedAt, state, level: state === "shown" ? "full" : null }).returning();
      const [shown] = await picture(normal[0].id, "shown");
      const [second] = await picture(normal[0].id, "shown", new Date(now.getTime() + MINUTE));
      const [waiting] = await picture(normal[1].id, "waiting");

      const { section, ids } = await news();
      check(`at most ${FOLLOW.newsPosts} posts, the newest first`, ids.join() === normal.slice(0, FOLLOW.newsPosts).map((p) => p.id).join(), `${ids.length} posts`);
      check("with the host's name, the project and the way to the diary", words(section).includes(anna.displayName) && words(section).includes(`Album ${RUN}`) && section.includes(`href="/h/${anna.handle}/project/${project.id}"`));
      const excerpt = firstLines(normal[0].text, HOME.newsLetters);
      const shownText = words(section.match(new RegExp(`data-news-post="${normal[0].id}"[\\s\\S]*?<p[^>]*data-news-text[^>]*>([\\s\\S]*?)</p>`))?.[1] ?? "").trim();
      check(`the first ${HOME.newsLetters} letters of a long post, and no more`, excerpt.length > 200 && excerpt.length <= HOME.newsLetters + 1 && shownText === excerpt, `${shownText.length} shown, ${excerpt.length} expected`);
      // The pictures here have no file behind them: these two look at what the page asks for, not at what the picture address answers (scripts/project-check.ts does that).
      check("the page asks for the post's first picture that everyone may see, and only that one", section.includes(`/pictures/${shown.id}"`) && !section.includes(`/pictures/${second.id}"`));
      check("and never for a picture that is still being checked", !section.includes(`/pictures/${waiting.id}"`));

      await db.update(schema.follows).set({ unfollowedAt: now }).where(and(eq(schema.follows.followerId, cust.id), eq(schema.follows.hostId, anna.id)));
      check("a host who is no longer followed is gone from the news", !(await page("/", cust.jar)).html.includes("data-diary-news"));
    }

    // ----------------------------------------------------------------------
    console.log("\n7. Nobody sees anyone else's calls, and a long list of past calls");
    const other = await signUp("other");
    {
      const home = await page("/", other.jar);
      check("another person's home page has none of these calls or names", ![twoHours, threeDays, soon, hosted].some((c) => home.html.includes(c.id)) && !home.words.includes(anna.displayName) && !home.words.includes(cust.name));
      const past = await page("/calls", other.jar);
      check("and their past calls have none of them", ![cancelledSoon, reported, over].some((c) => past.html.includes(c.id)) && past.words.includes("No past calls yet."));

      const start = Date.now() - 10 * DAY;
      const many = await db
        .insert(schema.calls)
        .values(
          Array.from({ length: HOME.pastPerPage + 1 }, (_, i) => {
            const startsAt = new Date(Math.floor((start + i * 60 * MINUTE) / 1000) * 1000);
            const endsAt = new Date(startsAt.getTime() + 30 * MINUTE);
            return { hostId: anna.id, customerId: other.id, startsAt, endsAt, roomName: `home-${randomUUID()}`, closedAt: endsAt };
          }),
        )
        .returning({ id: schema.calls.id });
      calls.push(...many.map((c) => c.id));
      const first = await page("/calls", other.jar);
      check(`${HOME.pastPerPage} to a page, the newest first, with a way to the older ones`, count(first.html, "data-call=") === HOME.pastPerPage && listed(first.html, many[many.length - 1].id) && !listed(first.html, many[0].id) && first.html.includes('href="/calls?page=2"'), String(count(first.html, "data-call=")));
      const secondPage = await page("/calls?page=2", other.jar);
      check("the rest on the next page, with a way back", count(secondPage.html, "data-call=") === 1 && listed(secondPage.html, many[0].id) && secondPage.html.includes('href="/calls"'));
      check("a page number that is not one is read as the first page", count((await page("/calls?page=abc", other.jar)).html, "data-call=") === HOME.pastPerPage);
      check("none of them is on the home page", !(await page("/", other.jar)).html.includes("data-calls="));
    }

    // ----------------------------------------------------------------------
    console.log("\n8. What a host sees about her customers (plans/38)");
    {
      const { contactsOf, hasAskedHost, haveAskedHost, hostNotesAbout } = await import("../src/lib/people/contacts");
      const bri = await asHost(await signUp("bri"), "bri", `Bri Display ${RUN}`);
      const regular = await signUp("regular");
      const first = await person("first");
      const pausedMember = await person("pausedm");
      const tester = await person("tester");
      const seller = await host("seller", `Seller Display ${RUN}`);
      const stranger = await person("stranger");

      // Two calls that count, one cancelled, and one the customer never joined.
      const before1 = await call({ hostId: bri.id, customerId: regular.id, startsInMinutes: -3 * 24 * 60 });
      const before2 = await call({ hostId: bri.id, customerId: regular.id, startsInMinutes: -2 * 24 * 60 });
      const beforeCancelled = await call({ hostId: bri.id, customerId: regular.id, startsInMinutes: -4 * 24 * 60, cancelled: true });
      const beforeMissed = await call({ hostId: bri.id, customerId: regular.id, startsInMinutes: -5 * 24 * 60 });
      for (const row of [before1, before2, beforeCancelled, beforeMissed]) await requestOf(row);
      await joined(before1.id, [bri.id, regular.id]);
      await joined(before2.id, [bri.id, regular.id]);
      await joined(beforeCancelled.id, [bri.id, regular.id]);
      await joined(beforeMissed.id, [bri.id]);

      const noteText = `Likes short answers ${RUN}`;
      const legalName = `Legal Name ${RUN}`;
      await db.insert(schema.hostNotes).values({ hostId: bri.id, customerId: regular.id, text: noteText });
      await db.insert(schema.identityChecks).values({ userId: regular.id, stripeSessionId: `vs_homecheck_${randomUUID()}`, status: "verified", adult: true, verifiedName: legalName, checkedAt: now });
      await db.insert(schema.memberships).values([
        { hostId: bri.id, customerId: regular.id, status: "active", since: now },
        { hostId: bri.id, customerId: pausedMember.id, status: "paused", since: now },
      ]);

      const withRegular = await call({ hostId: bri.id, customerId: regular.id, startsInMinutes: 90 });
      await requestOf(withRegular, { words: `Advice on my first video ${RUN}` });
      const withFirst = await call({ hostId: bri.id, customerId: first.id, startsInMinutes: 200 });
      await requestOf(withFirst, { words: `Sponsors question ${RUN}` });
      const withPaused = await call({ hostId: bri.id, customerId: pausedMember.id, startsInMinutes: 300 });
      await requestOf(withPaused, { source: "now" });
      const testCall = await call({ hostId: bri.id, customerId: tester.id, startsInMinutes: 400 });
      await requestOf(testCall, { words: `Words of a test call ${RUN}`, source: "admin" });
      // The same person is also a real customer of hers, with a past call, a note and a photo: still nothing on the test call.
      const testersReal = await call({ hostId: bri.id, customerId: tester.id, startsInMinutes: -6 * 24 * 60 });
      await requestOf(testersReal);
      await joined(testersReal.id, [bri.id, tester.id]);
      await db.insert(schema.hostNotes).values({ hostId: bri.id, customerId: tester.id, text: `A note about the tester ${RUN}` });
      const photo = (userId: string) => ({ userId, network: "upload", width: 8, height: 8, byteLength: 1, sha256: randomUUID(), bytes: Buffer.from("x"), takenAt: now, checkedBy: "homecheck", rulesVersion: "homecheck" });
      const [testersPhoto, regularsPhoto] = await db.insert(schema.hostPhotos).values([photo(tester.id), photo(regular.id)]).returning({ id: schema.hostPhotos.id });
      const sheBooked = await call({ hostId: seller.id, customerId: bri.id, startsInMinutes: 500 });
      await requestOf(sheBooked, { words: `Her own words as a customer ${RUN}` });

      const hers = await page("/", bri.jar);
      const card = detailsOf(hers.html, withRegular.id);
      check("the card is about the call she hosts next", hers.html.includes(`data-next-call="${withRegular.id}"`));
      check("with what the customer wrote", words(card).includes(`Advice on my first video ${RUN}`), words(card).slice(0, 160));
      check("the details of the next call are on the page once: in the card, not again in the list", count(hers.html, `data-customer-details="${withRegular.id}"`) === 1 && listed(hers.html, withRegular.id), String(count(hers.html, `data-customer-details="${withRegular.id}"`)));
      check("ID confirmed and Your member", card.includes("data-customer-id") && card.includes("data-customer-member"));
      check("the calls before: the two that count, not the cancelled one nor the one the customer never joined", card.includes('data-customer-before="2"') && words(card).includes("2 calls before, the last on"), card.match(/data-customer-before="\d+"/)?.[0] ?? "none");
      const contact = (await contactsOf(bri.id, new Date())).find((c) => c.userId === regular.id);
      check('the same number as "People you have talked to"', contact?.calls === 2, String(contact?.calls));
      check("her own note, folded", card.includes('data-host-note="folded"') && words(card).includes(noteText) && words(card).includes(`Your notes about ${regular.name}`));
      check("never the customer's email or the name from their ID", !hers.text.includes(regular.email) && !hers.text.includes(legalName));
      check("no star rating beside a booked call", !card.includes("data-rating") && !/ratings?\b/.test(words(card)), words(card).slice(0, 200));

      const firstRow = detailsOf(hers.html, withFirst.id);
      check("a first-time customer: their words and \"First call with you\", nothing else", words(firstRow).includes(`Sponsors question ${RUN}`) && firstRow.includes('data-customer-before="0"') && words(firstRow).includes("First call with you") && !firstRow.includes("data-customer-id") && !firstRow.includes("data-customer-member") && !firstRow.includes("data-host-note"), words(firstRow).slice(0, 160));
      const pausedRow = detailsOf(hers.html, withPaused.id);
      check("a paused membership is not \"Your member\", and a call right now has no words", pausedRow !== "" && !pausedRow.includes("data-customer-member") && !pausedRow.includes("data-customer-words"), words(pausedRow).slice(0, 160));
      check("a test call shows no details", listed(hers.html, testCall.id) && detailsOf(hers.html, testCall.id) === "" && !hers.text.includes(`Words of a test call ${RUN}`));
      check("also when its customer is a real customer of hers too: not their note, nor their photo", !hers.text.includes(`A note about the tester ${RUN}`) && !hers.text.includes(testersPhoto.id));
      check("the photo of a real customer is asked for beside their call", hers.html.includes(`/host-photos/${regularsPhoto.id}`));
      check("a call she booked as a customer is on the same page, without details", listed(hers.html, sheBooked.id) && detailsOf(hers.html, sheBooked.id) === "" && !hers.text.includes(`Her own words as a customer ${RUN}`));
      check("the shortcuts for a host are there, with her page", hers.html.includes("data-host-shortcuts") && hers.html.includes(`href="/h/${bri.handle}"`) && hers.html.includes('href="/host/now"') && hers.html.includes('href="/host#paid"'));

      const his = await page("/", regular.jar);
      check("the customer of that call gets none of it on their own home page", listed(his.html, withRegular.id) || his.html.includes(`data-next-call="${withRegular.id}"`) ? !his.text.includes("data-customer-") && !his.text.includes(noteText) && !his.text.includes("Your member") && !his.text.includes("calls before") : false);
      check("and no shortcuts for someone who only books calls", !his.html.includes("data-host-shortcuts"));
      // What a page hands to the parts that run in the browser travels inside the page itself. So the whole reply is
      // searched, not only what is drawn. The minute's refresh is made by the same code with the same data, but it is
      // not fetched here: that, and a note staying open over it, is tried in a real browser.
      check("nor in what the first page hands to the parts that run in the browser; the host's page does hold it there", !his.text.includes("callsBefore") && !his.text.includes("idConfirmed") && hers.text.includes("callsBefore") && hers.text.includes(noteText));
      const sellers = await signUp("sellerlogin");
      const sellersCall = await call({ hostId: sellers.id, customerId: regular.id, startsInMinutes: 600 });
      await requestOf(sellersCall);
      const another = await page("/", sellers.jar);
      check("another host, with a call of the same customer, sees nothing of this host's note or count", detailsOf(another.html, sellersCall.id).includes('data-customer-before="0"') && !another.text.includes(noteText) && !detailsOf(another.html, sellersCall.id).includes("data-customer-member"));

      // The check for several people at once against the single check, person by person.
      const abandoned = await person("abandoned");
      await db.insert(schema.bookings).values({ hostId: bri.id, customerId: abandoned.id, startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + DAY + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "card", requestKey: randomUUID() });
      const onlyTest = await person("onlytest");
      const onlyTestCall = await call({ hostId: bri.id, customerId: onlyTest.id, startsInMinutes: 700 });
      await requestOf(onlyTestCall, { source: "admin" });
      const everyone = [regular.id, first.id, pausedMember.id, tester.id, onlyTest.id, seller.id, stranger.id, abandoned.id, bri.id];
      /** The single check as it was before plans/38, written out here on its own: what the new code is compared with. */
      const asBefore = async (hostId: string, customerId: string) => {
        if (hostId === customerId) return false;
        const b = schema.bookings;
        const [asked] = await db.select({ id: b.id }).from(b).where(and(eq(b.hostId, hostId), eq(b.customerId, customerId), ne(b.source, "admin"), isNotNull(b.requestedAt), or(ne(b.source, "member"), isNotNull(b.callId)))).limit(1);
        if (!asked) return false;
        const [customer] = await db.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, customerId));
        if (!customer || customer.closedAt) return false;
        const [block] = await db.select({ blockerId: schema.blocks.blockerId }).from(schema.blocks).where(or(and(eq(schema.blocks.blockerId, hostId), eq(schema.blocks.blockedId, customerId)), and(eq(schema.blocks.blockerId, customerId), eq(schema.blocks.blockedId, hostId)))).limit(1);
        return !block;
      };
      const same = async () => {
        const many = await haveAskedHost(bri.id, everyone);
        const single = await Promise.all(everyone.map((id) => hasAskedHost(bri.id, id)));
        const before = await Promise.all(everyone.map((id) => asBefore(bri.id, id)));
        return { ok: everyone.every((id, i) => many.has(id) === before[i] && single[i] === before[i]), many };
      };
      const open = await same();
      check("the check for several customers at once, and the single check, answer as the old single check did for each", open.ok);
      check("yes for her real customers, also one who has a test call as well", [regular.id, first.id, pausedMember.id, tester.id].every((id) => open.many.has(id)) && open.many.size === 4, String(open.many.size));
      check("never for a customer of a test call only, a host she booked herself, a stranger, a request abandoned at the card step, or herself", ![onlyTest.id, seller.id, stranger.id, abandoned.id, bri.id].some((id) => open.many.has(id)));
      check("an empty list and a list with the same person twice are answered plainly", (await haveAskedHost(bri.id, [])).size === 0 && (await haveAskedHost(bri.id, [regular.id, regular.id])).size === 1);
      const inside = await db.transaction(async (tx) => {
        await tx.insert(schema.blocks).values({ blockerId: regular.id, blockedId: bri.id });
        const seen = [(await haveAskedHost(bri.id, [regular.id], tx)).has(regular.id), await hasAskedHost(bri.id, regular.id, tx)];
        await tx.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, regular.id), eq(schema.blocks.blockedId, bri.id)));
        return seen;
      });
      check("asked inside a change that is not finished yet, both see that change", inside.every((answer) => answer === false));

      // A block, in either direction, with the call still on the list (a block cancels only calls that have not started, and that can fail).
      for (const [blockerId, blockedId, which] of [
        [bri.id, regular.id, "the host blocked the customer"],
        [regular.id, bri.id, "the customer blocked the host"],
      ] as const) {
        await db.insert(schema.blocks).values({ blockerId, blockedId });
        const blocked = await page("/", bri.jar);
        check(`${which}: the call that is still listed shows no details at all`, (listed(blocked.html, withRegular.id) || blocked.html.includes(`data-next-call="${withRegular.id}"`)) && detailsOf(blocked.html, withRegular.id) === "" && !blocked.text.includes(noteText) && !blocked.text.includes(`Advice on my first video ${RUN}`));
        check("  and the two checks still agree", (await same()).ok && !(await same()).many.has(regular.id) && (await hostNotesAbout(bri.id, [regular.id])).size === 0);
        await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, blockerId), eq(schema.blocks.blockedId, blockedId)));
      }
      check("unblocked, the details are back", detailsOf((await page("/", bri.jar)).html, withRegular.id).includes("data-host-note"));
      await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, first.id));
      const closed = await page("/", bri.jar);
      check("a customer whose account is closed: the call that is still listed shows no details", listed(closed.html, withFirst.id) && detailsOf(closed.html, withFirst.id) === "" && !closed.text.includes(`Sponsors question ${RUN}`) && (await same()).ok);
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, first.id));

      // Requests, to answer on the home page.
      const asking = [await person("ask1"), await person("ask2")];
      const sameTime = await Promise.all(asking.map((who, i) => waitingRequest(bri.id, who.id, 3 * 24 * 60, `Request words ${i} ${RUN}`)));
      const fromRegular = await waitingRequest(bri.id, regular.id, 4 * 24 * 60, `A request from the regular ${RUN}`);
      const withRequests = await page("/", bri.jar);
      const list = withRequests.html.slice(withRequests.html.indexOf('data-request-list="home"'));
      check("the requests are on the home page, each with Accept and Decline that come back to it", [...sameTime, fromRegular].every((b) => list.includes(`data-request="${b.id}"`)) && count(list, 'name="from" value="home"') === 6 && count(words(list), "Accept") === 3 && count(words(list), "Decline") === 3, `${count(list, 'name="from" value="home"')} return fields`);
      check("people who asked for the same time sit together", words(list).includes("2 people asked for this time. Choose one."));
      check("with the customer's words, and her note folded", words(list).includes(`Request words 0 ${RUN}`) && list.slice(list.indexOf(`data-request="${fromRegular.id}"`)).includes('data-host-note="folded"'));
      const more = await Promise.all([5, 6, 7, 8, 9].map((days, i) => waitingRequest(bri.id, asking[0].id, days * 24 * 60 + i, `More ${i} ${RUN}`)));
      const many = await page("/", bri.jar);
      check(`only the first ${HOME.requestTimesShown} times asked for are shown, with the way to all of them`, count(many.html, "data-request=") === HOME.requestTimesShown + 1 && !many.html.includes(`data-request="${more[4].id}"`) && many.words.includes("See all 8 requests") && many.html.includes('href="/host/requests"'), `${count(many.html, "data-request=")} shown`);
      const requestsPage = await page("/host/requests", bri.jar);
      check("the requests page shows all of them, with its own return field, and the note folded", count(requestsPage.html, "data-request=") === 8 && count(requestsPage.html, 'name="from" value="requests"') === 16 && !requestsPage.html.includes('name="from" value="home"') && requestsPage.html.includes('data-host-note="folded"'), `${count(requestsPage.html, "data-request=")} shown`);
      check("the customer who asked sees no list of requests to answer", !(await page("/", regular.jar)).html.includes("data-request-list"));
      // A request that is still waiting although the account was closed, or a block was made (ending it can fail).
      await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, asking[1].id));
      await db.insert(schema.blocks).values({ blockerId: regular.id, blockedId: bri.id });
      for (const [path, where] of [
        ["/", "the home page"],
        ["/host/requests", "the requests page"],
      ] as const) {
        const html = (await page(path, bri.jar)).html;
        const rowOf = (id: string) => html.slice(html.indexOf(`data-request="${id}"`), html.indexOf("Decline", html.indexOf(`data-request="${id}"`)));
        const [closedRow, blockedRow, openRow] = [rowOf(sameTime[1].id), rowOf(fromRegular.id), rowOf(sameTime[0].id)];
        const bare = (row: string) => row !== "" && !row.includes("ratings") && !row.includes("ID confirmed") && !row.includes("data-host-note") && !row.includes("&ldquo;") && !row.includes("“") && !row.includes("/host-photos/");
        check(`${where}: a request of a closed account, and one across a block, show the name, time, length and price, and nothing else about the customer`, bare(closedRow) && bare(blockedRow) && !html.includes(`Request words 1 ${RUN}`) && !html.includes(`A request from the regular ${RUN}`), `${words(closedRow).slice(0, 90)} | ${words(blockedRow).slice(0, 90)}`);
        check("  and the request beside them keeps its details", words(openRow).includes(`Request words 0 ${RUN}`) && openRow.includes("ratings"));
      }
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, asking[1].id));
      await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, regular.id), eq(schema.blocks.blockedId, bri.id)));

      // A host whose profile waits for approval again still has hosting to do.
      await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, bri.id));
      const pending = await page("/", bri.jar);
      check("a host waiting for approval again keeps the shortcuts and the details, without the link to a page nobody can open", pending.html.includes("data-host-shortcuts") && !pending.html.includes(`href="/h/${bri.handle}"`) && detailsOf(pending.html, withRegular.id) !== "");
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
    // Part 8: what hangs on the calls and the people.
    await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, callIds));
    await db.delete(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)));
    await db.delete(schema.hostNotes).where(or(inArray(schema.hostNotes.hostId, ids), inArray(schema.hostNotes.customerId, ids)));
    await db.delete(schema.memberships).where(or(inArray(schema.memberships.hostId, ids), inArray(schema.memberships.customerId, ids)));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, ids));
    await db.delete(schema.hostPhotos).where(inArray(schema.hostPhotos.userId, ids));
    const projectIds = projects.length ? projects : [randomUUID()];
    const posts = (await db.select({ id: schema.projectPosts.id }).from(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds))).map((p) => p.id);
    if (posts.length) await db.delete(schema.projectPictures).where(inArray(schema.projectPictures.postId, posts));
    await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.id, projectIds));
    await db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.payments).where(inArray(schema.payments.callId, callIds));
    await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `homecheck-${RUN}-%`));
    await removeTestsOf(ids);
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
    await db.delete(schema.rateLimit);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
