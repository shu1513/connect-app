/**
 * Testing tool: the home page and "Past calls" (plans/36), read from the running app the way a
 * browser gets them, against the local database.
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
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
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
      check(`the first ${HOME.newsLetters} letters of a long post, and no more`, excerpt.length > 200 && excerpt.length <= HOME.newsLetters + 1 && words(section).includes(excerpt) && !words(section).includes(`${excerpt.slice(0, -1)} More`), String(excerpt.length));
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
  } finally {
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
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
