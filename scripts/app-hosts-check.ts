/**
 * Testing tool: asks the app running on this computer for the search and for hosts' pages the way
 * the phone app does, and checks them (plans/45-phone-apps/05-search-and-a-hosts-page.md): what
 * the search finds and for whom; a host's page for a stranger, for someone not signed in, for a
 * member and an invited person of a host whose page is hidden, for a blocked pair, for a host
 * waiting for approval; that nothing of a project is in any answer; and following, with the
 * choices about emails, which must leave the choice about diary emails exactly as it was.
 *
 * It empties the table of attempt limits as it goes, so it only runs against a database made for
 * checking (its name must end in "_check"). It removes what it made.
 *
 * Usage: DATABASE_URL=…/something_check npx tsx scripts/app-hosts-check.ts [--app=http://localhost:3000]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { APP_ORIGIN } from "../src/lib/auth-rules";
import { APP_HEADER, SIGN_IN_HEADER } from "../src/lib/app-door/rules";
import type { AppFollowDone, AppHostPage, AppSearch, Refusal } from "../src/lib/app-door/types";
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
type Reply = { status: number; json: unknown; text: string; bytes: Buffer; headers: http.IncomingHttpHeaders };

/**
 * One request sent exactly as given, with nothing added. (The usual `fetch` of this tool adds a
 * browser-like mark of its own to every request, which a phone app does not send, and which the
 * door rightly refuses.)
 */
function plain(path: string, options: { body?: unknown; headers?: Record<string, string>; jar?: Jar } = {}): Promise<Reply> {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const headers: Record<string, string> = { ...options.headers };
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: payload !== undefined ? "POST" : "GET", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString("utf8");
        for (const cookie of response.headers["set-cookie"] ?? []) {
          const [pair, ...attributes] = cookie.split(";");
          const at = pair.indexOf("=");
          const name = pair.slice(0, at).trim();
          const value = pair.slice(at + 1);
          if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) options.jar?.delete(name);
          else options.jar?.set(name, value);
        }
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          // not JSON
        }
        resolve({ status: response.statusCode ?? 0, json, text, bytes, headers: response.headers });
      });
    });
    request.on("error", reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}
const asCookie = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
/** A request the way the phone app sends it: to the door with its sign-in in the app's own header, to the login tool as the kit does. */
function asApp(path: string, options: { body?: unknown; jar?: Jar } = {}): Promise<Reply> {
  const kept = options.jar?.size ? asCookie(options.jar) : null;
  const headers: Record<string, string> = { [APP_HEADER]: "android 1.0.0" };
  if (path.startsWith("/api/app/")) {
    if (kept) headers[SIGN_IN_HEADER] = kept;
  } else {
    headers["expo-origin"] = APP_ORIGIN;
    if (kept) headers.cookie = kept;
  }
  return plain(path, { ...options, headers });
}
/** A request the way a browser on our own site sends it. */
function asBrowser(path: string, options: { body?: unknown; jar?: Jar } = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: BASE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
  if (options.jar?.size) headers.cookie = asCookie(options.jar);
  return plain(path, { ...options, headers });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const refusal = (reply: Reply) => (reply.json as Refusal | null)?.error?.code ?? `no code, status ${reply.status}`;
/** Every name of a part anywhere in an answer, however deep. */
function namesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) namesIn(item, found);
  else if (value !== null && typeof value === "object") {
    for (const [name, inner] of Object.entries(value)) {
      found.add(name);
      namesIn(inner, found);
    }
  }
  return found;
}
async function main() {
  requireLocalDatabase();
  const setting = new URL(process.env.DATABASE_URL ?? "");
  for (const override of ["database", "dbname", "host", "hostaddr", "port", "service"]) {
    if (setting.searchParams.has(override)) throw new Error(`DATABASE_URL must name its database in the address itself, not with "?${override}=".`);
  }
  const { db, schema } = await import("../src/db");
  const [{ name: database }] = (await db.execute(sql`select current_database() as name`)) as unknown as { name: string }[];
  if (!database.endsWith("_check")) throw new Error(`This script empties the attempt limits, so it only runs against a database made for checking (a name ending in "_check"), not "${database}".`);
  const up = await asBrowser("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error(`The app is not running at ${BASE}. Start it first.`);
  await db.delete(schema.rateLimit);

  const now = new Date();
  const made: string[] = [];
  const projects: string[] = [];
  const search = async (q: string, jar?: Jar) => {
    const reply = await asApp(`/api/app/search?q=${encodeURIComponent(q)}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppSearch) : null };
  };
  const page = async (handle: string, jar?: Jar, query = "") => {
    const reply = await asApp(`/api/app/hosts/${handle}${query}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppHostPage) : null };
  };
  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms" (pretended), and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Hosts ${name} ${RUN}`, email: `apphosts-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    await asApp("/api/auth/sign-up/email", { body: { name: person.name, email: person.email, password: person.password, callbackURL: `${BASE}/welcome` } });
    let link = "";
    for (let i = 0; i < 25 && !link; i++) {
      const found = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, person.email), like(schema.emailOutbox.subject, "%Confirm your email%"))).orderBy(desc(schema.emailOutbox.createdAt));
      link = found[0]?.body.match(/https?:\/\/\S+/)?.[0] ?? "";
      if (!link) await pause(200);
    }
    if (!link) throw new Error(`No confirmation email for ${person.email}`);
    await asBrowser(link, { jar: new Map() });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    made.push(row.id);
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    const signIn = await asApp("/api/auth/sign-in/email", { body: { email: person.email, password: person.password }, jar: person.jar });
    if (signIn.status !== 200) throw new Error(`Could not sign in ${person.email} the app's way: ${signIn.status}`);
    return { ...person, id: row.id };
  }
  /** A person who never signs in here, written straight to the database. */
  async function person(name: string) {
    const id = `ao-${RUN}-${name}`;
    const email = `apphosts-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Account ${name} ${RUN}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Account ${name} ${RUN}`, email };
  }
  /** Makes someone a host whose page is open to everyone. */
  async function asHost<T extends { id: string }>(who: T, name: string, displayName: string) {
    const handle = `ao${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: who.id, handle, handleKey: handle, displayName, pricePer15Cents: 0, status: "approved", usConfirmedAt: now });
    return { ...who, handle, displayName };
  }
  /** A host who can be asked for a call right now: free calls, a calendar open all week, "Available now" on. */
  async function goOnline(hostId: string) {
    await db.insert(schema.hostCalendars).values({ userId: hostId, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId, weekday, startMinute: 0, endMinute: 1440 })));
    const at = new Date();
    await db.update(schema.hostCalendars).set({ availableUntil: new Date(at.getTime() + 60 * MINUTE), availableSeenAt: at }).where(eq(schema.hostCalendars.userId, hostId));
  }
  const photoOf = async (userId: string) =>
    (await db.insert(schema.hostPhotos).values({ userId, network: "upload", width: 8, height: 8, byteLength: 5, sha256: randomUUID(), bytes: Buffer.from("photo"), takenAt: now, checkedBy: "apphomecheck", rulesVersion: "apphomecheck" }).returning({ id: schema.hostPhotos.id }))[0].id;

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. The search");
    const cust = await newPerson("cust");
    const maya = await asHost(await person("maya"), "maya", `Maya Makes ${RUN}`);
    await goOnline(maya.id);
    const mayaPhoto = await photoOf(maya.id);
    await db.update(schema.hostProfiles).set({ about: "I make things by hand." }).where(eq(schema.hostProfiles.userId, maya.id));
    {
      const one = await search("m");
      check("one letter is too little, and says so", one.body?.searched === false && one.body.hosts.length === 0 && one.body.hint === "Type at least 2 letters or numbers.", one.body?.hint ?? "");
      const none = await search(`nobody${RUN}xyz`);
      check("a search that finds nobody says so", none.body?.searched === true && none.body.hosts.length === 0 && none.body.hint === "Nobody found. Check the spelling, or try their handle or social media name.");
      const byName = await search(`Maya Makes ${RUN}`);
      const found = byName.body?.hosts.find((h) => h.handle === maya.handle);
      check("someone not signed in finds a host by her name", byName.reply.status === 200 && found !== undefined, `${byName.reply.status}`);
      check("a result is what a search result shows, and no account id", found !== undefined && Object.keys(found).sort().join(",") === "about,handle,languages,name,photoId,price,rating,socials" && found.photoId === mayaPhoto && found.price === "Free calls" && found.about === "I make things by hand.");
      check("by her Connect handle too, with or without the @", (await search(maya.handle)).body?.hosts.some((h) => h.handle === maya.handle) === true && (await search(`@${maya.handle}`)).body?.hosts.some((h) => h.handle === maya.handle) === true);
      check("signed in, the same", (await search(maya.handle, cust.jar)).body?.hosts.some((h) => h.handle === maya.handle) === true);
      check("it may not be kept by anything on the way", String(byName.reply.headers["cache-control"]).includes("no-store"));
      check("a browser cannot search through the app's address", refusal(await asBrowser(`/api/app/search?q=${maya.handle}`)) === "not_the_app");
      // More than are shown: the line that asks to type more.
      const many = [];
      for (let i = 0; i < 22; i++) many.push(await asHost(await person(`many${i}`), `many${i}`, `Crowd ${RUN} ${i}`));
      const crowd = await search(`Crowd ${RUN}`);
      check("at most twenty are shown, with a line asking to type more", crowd.body?.hosts.length === 20 && crowd.body.more === "Showing the 20 best matches. Type more to narrow it down.", `${crowd.body?.hosts.length} ${crowd.body?.more}`);
      // A hidden host, and one waiting for approval, are not found.
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, many[0].id));
      await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, many[1].id));
      const afterwards = (await search(`Crowd ${RUN}`)).body?.hosts.map((h) => h.handle) ?? [];
      check("a hidden host and one waiting for approval are not found", !afterwards.includes(many[0].handle) && !afterwards.includes(many[1].handle));
      // A block, either way: the pair never find each other. Anyone else still finds her.
      await db.insert(schema.blocks).values({ blockerId: maya.id, blockedId: cust.id });
      check("a host who blocked someone is not found by them", (await search(maya.handle, cust.jar)).body?.hosts.some((h) => h.handle === maya.handle) === false);
      check("and is still found by everyone else", (await search(maya.handle)).body?.hosts.some((h) => h.handle === maya.handle) === true);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, maya.id));
      await db.insert(schema.blocks).values({ blockerId: cust.id, blockedId: maya.id });
      check("nor is a host found by someone who blocked her", (await search(maya.handle, cust.jar)).body?.hosts.some((h) => h.handle === maya.handle) === false);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, cust.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. A host's page: a stranger, someone not signed in, her own");
    {
      const guest = await page(maya.handle);
      const p = guest.body;
      check("someone not signed in can open an approved, visible host's page", guest.reply.status === 200 && p?.handle === maya.handle && p.name === maya.displayName, `${guest.reply.status}`);
      check(
        "it has exactly the parts the app knows, and no account id",
        Object.keys(p ?? {}).sort().join(",") === "about,ask,callWords,confirmId,follow,handle,languages,membership,name,now,own,photoId,price,rating,shareUrl,socials,verifiedOnly" && !guest.reply.text.includes(maya.id),
        Object.keys(p ?? {}).sort().join(","),
      );
      check("with her photo, her price and what a call is", p?.photoId === mayaPhoto && p.price === "Free private video call" && p.callWords === "A private one-to-one video call. Free to cancel any time before the call starts.");
      check("a visitor is offered to sign in to follow", p?.follow === "visitor" && p.own === false);
      check("she can be shared, by her page's address on the web", p?.shareUrl === `${BASE}/h/${maya.handle}`);
      check("she can be asked for a call: the lengths, the one shown first, and its open times as moments on the world's clock", p?.ask.closed === null && p.ask.title === "Or ask for a call later" && p.ask.lengths.map((l) => l.minutes).join(",") === "15,30" && p.ask.chosen === 30 && p.ask.starts.length > 0 && p.ask.starts.every((s) => /Z$/.test(s)), JSON.stringify(p?.ask).slice(0, 160));
      check("she is available now, with the lengths for that", p?.now !== null && p?.now?.answerMinutes === 2 && p.now.paid === false && p.now.lengths.length > 0, JSON.stringify(p?.now));
      const fifteen = (await page(maya.handle, undefined, "?length=15")).body;
      check("choosing another length shows that length's times", fifteen?.ask.chosen === 15 && fifteen.ask.starts.length >= (p?.ask.starts.length ?? 0));
      check("a length she does not offer is read as none chosen", (await page(maya.handle, undefined, "?length=47")).body?.ask.chosen === 30);
      const stranger = (await page(maya.handle, cust.jar)).body;
      check("a signed-in stranger sees the same, with a Follow button", stranger?.follow === "none" && stranger.own === false && stranger.ask.closed === null && stranger.membership === null);
      check("no page: 'not found', for a handle that does not exist and for one that is not a handle", refusal((await page(`nobody${RUN}`)).reply) === "not_found" && refusal((await page("not%20a%20handle")).reply) === "not_found");
      check("a browser cannot read a page through the app's address", refusal(await asBrowser(`/api/app/hosts/${maya.handle}`)) === "not_the_app");
      // Her own page.
      const hostC = await asHost(await newPerson("hostc"), "hostc", `Host C ${RUN}`);
      const own = (await page(hostC.handle, hostC.jar)).body;
      check("her own page says it is hers, and has no Follow button", own?.own === true && own.follow === null);
      check("a host with no calendar is 'not taking calls at the moment'", own?.ask.closed === `${hostC.displayName} is not taking calls at the moment.` && own.ask.starts.length === 0 && own.ask.lengths.length === 0 && own.now === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Who may open which page");
    const hidden = await asHost(await person("hidden"), "hidden", `Hidden Host ${RUN}`);
    await goOnline(hidden.id);
    const hiddenPhoto = await photoOf(hidden.id);
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, hidden.id));
    const member = await newPerson("member");
    const invited = await newPerson("invited");
    {
      check("a hidden host's page is 'not found' for someone not signed in and for a stranger", refusal((await page(hidden.handle)).reply) === "not_found" && refusal((await page(hidden.handle, cust.jar)).reply) === "not_found");
      await db.insert(schema.memberships).values({ hostId: hidden.id, customerId: member.id, status: "active", since: now });
      const forMember = await page(hidden.handle, member.jar);
      check("her member can still open it", forMember.reply.status === 200 && forMember.body?.name === hidden.displayName, `${forMember.reply.status}`);
      check("without her photo and her social accounts, and it cannot be shared", forMember.body?.photoId === null && forMember.body.socials.length === 0 && forMember.body.shareUrl === null && !forMember.reply.text.includes(hiddenPhoto));
      check("and with no new following offered on a page that is not open to everyone", forMember.body?.follow === null);
      await db.insert(schema.memberships).values({ hostId: hidden.id, customerId: invited.id, status: "invited", inviteId: randomUUID(), invitedAt: now, inviteExpiresAt: new Date(Date.now() + DAY), inviteOfferVersion: 1, inviteMinutes: 120, ownPricePer15Cents: 750, ownMinutes: 120 });
      const forInvited = await page(hidden.handle, invited.jar);
      check("someone she invited can open it, and is told of the invitation and until when", forInvited.reply.status === 200 && typeof forInvited.body?.membership?.invitedUntil === "string", JSON.stringify(forInvited.body?.membership));
      // The invitation runs out: the page closes again.
      await db.update(schema.memberships).set({ inviteExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(schema.memberships.hostId, hidden.id), eq(schema.memberships.customerId, invited.id)));
      check("once the invitation has run out, the page is 'not found' for them again", refusal((await page(hidden.handle, invited.jar)).reply) === "not_found");
      // Waiting for approval: a member can open it, nobody can book.
      await db.update(schema.hostProfiles).set({ hidden: false, status: "pending" }).where(eq(schema.hostProfiles.userId, hidden.id));
      const waiting = await page(hidden.handle, member.jar);
      check("while she waits for approval her member can open the page", waiting.reply.status === 200);
      check("and a stranger cannot", refusal((await page(hidden.handle, cust.jar)).reply) === "not_found");
      // Approved again, and hidden as at first.
      await db.update(schema.hostProfiles).set({ status: "approved", hidden: true }).where(eq(schema.hostProfiles.userId, hidden.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. A blocked pair");
    {
      await db.insert(schema.blocks).values({ blockerId: maya.id, blockedId: cust.id });
      const blockedByHost = (await page(maya.handle, cust.jar)).body;
      check("someone the host blocked can still open her page by its address, with nothing to book", blockedByHost !== null && blockedByHost.ask.closed !== null && blockedByHost.ask.starts.length === 0 && blockedByHost.now === null);
      check("and the Follow button is as for anyone, so it does not give the block away", blockedByHost?.follow === "none");
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, maya.id));
      await db.insert(schema.blocks).values({ blockerId: cust.id, blockedId: maya.id });
      const blockedHer = (await page(maya.handle, cust.jar)).body;
      check("someone who blocked the host sees nothing to book, and no Follow button", blockedHer !== null && blockedHer.ask.closed !== null && blockedHer.follow === null);
      const tried = await asApp(`/api/app/hosts/${maya.handle}/follow`, { body: {}, jar: cust.jar });
      check("and cannot follow her while their own block stands", tried.status === 400 && refusal(tried) === "not_valid" && (tried.json as Refusal).error.message.includes("unblock"), (tried.json as Refusal | null)?.error?.message ?? "");
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, cust.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Nothing of a project");
    {
      const [project] = await db.insert(schema.projects).values({ hostId: maya.id, name: `Album ${RUN}`, startedAt: new Date(now.getTime() - 60 * DAY) }).returning();
      projects.push(project.id);
      await db.insert(schema.projectPosts).values({ projectId: project.id, text: `A diary post ${RUN}`, createdAt: now, updatedAt: now });
      const withProject = await page(maya.handle, cust.jar);
      const names = [...namesIn(withProject.body)];
      check("a host with a running project and a diary: her page for the app names none of it", withProject.reply.status === 200 && !names.some((name) => /project|diary|post|contribut|tip/i.test(name)), names.filter((name) => /project|diary|post|contribut|tip/i.test(name)).join(","));
      check("and carries none of its words", !withProject.reply.text.includes(`Album ${RUN}`) && !withProject.reply.text.includes(`A diary post ${RUN}`) && !/diary|contribut/i.test(withProject.reply.text));
      const inSearch = await search(maya.handle, cust.jar);
      check("nor does the search", !inSearch.reply.text.includes(`Album ${RUN}`) && ![...namesIn(inSearch.body)].some((name) => /project|diary|post|contribut|tip/i.test(name)));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. Following, and the choices about emails");
    {
      const line = async () => (await db.select().from(schema.follows).where(and(eq(schema.follows.followerId, cust.id), eq(schema.follows.hostId, maya.id))))[0];
      check("nobody signed in cannot follow", refusal(await asApp(`/api/app/hosts/${maya.handle}/follow`, { body: {} })) === "not_signed_in");
      const followed = await asApp(`/api/app/hosts/${maya.handle}/follow`, { body: {}, jar: cust.jar });
      const done = followed.json as AppFollowDone | null;
      check("following answers with the website's sentence, and how it stands", followed.status === 200 && done?.follow === "following" && done.words === `You follow ${maya.displayName}. When they are available now, you see it on your home page.`, `${followed.status}`);
      check("and it is written as her own choice", (await line())?.how === "self" && (await line())?.unfollowedAt === null);
      check("her page now says Following", (await page(maya.handle, cust.jar)).body?.follow === "following");
      const hiddenTry = await asApp(`/api/app/hosts/${hidden.handle}/follow`, { body: {}, jar: cust.jar });
      const noSuch = await asApp(`/api/app/hosts/nobody${RUN}/follow`, { body: {}, jar: cust.jar });
      check("a hidden host cannot be followed, and is answered exactly like a page that does not exist", hiddenTry.status === 400 && (hiddenTry.json as Refusal | null)?.error?.message === "That page cannot be followed at the moment." && noSuch.text === hiddenTry.text, `${hiddenTry.status} ${hiddenTry.text.slice(0, 80)}`);

      // The person chose, on the website, to get emails about new diary posts. Whatever the app does must leave that.
      await db.update(schema.follows).set({ tellPosts: true }).where(and(eq(schema.follows.followerId, cust.id), eq(schema.follows.hostId, maya.id)));
      const on = await asApp(`/api/app/hosts/${maya.handle}/choices`, { body: { tellOnline: true, hours: { from: 9 * 60, to: 17 * 60 } }, jar: cust.jar });
      let now1 = await line();
      // Emails about hosts can be switched off for the whole site (no postal address yet): then the app is told so, and nothing changes.
      if (on.status === 400 && (on.json as Refusal).error.message.includes("not available at the moment")) {
        check("the emails are switched off on this site: the app is told so, and nothing is changed", now1.tellOnline === false && now1.tellPosts === true);
      } else {
        check("the email about 'available now' is switched on, with its hours", on.status === 200 && now1.tellOnline === true && now1.hoursFrom === 9 * 60 && now1.hoursTo === 17 * 60, `${on.status} ${JSON.stringify(on.json)}`);
        check("the diary choice stays exactly as it was", now1.tellPosts === true);
        const off = await asApp(`/api/app/hosts/${maya.handle}/choices`, { body: { tellOnline: false }, jar: cust.jar });
        now1 = await line();
        check("switching it off again changes only that: the hours and the diary choice stay", off.status === 200 && now1.tellOnline === false && now1.tellPosts === true && now1.hoursFrom === 9 * 60);
        const anyTime = await asApp(`/api/app/hosts/${maya.handle}/choices`, { body: { hours: null }, jar: cust.jar });
        now1 = await line();
        check("'any time' clears the hours and nothing else", anyTime.status === 200 && now1.hoursFrom === null && now1.hoursTo === null && now1.tellPosts === true);
      }
      for (const [label, body] of [
        ["nothing to change", {}],
        ["a tick that is not yes or no", { tellOnline: "yes" }],
        ["hours that are the same", { hours: { from: 540, to: 540 } }],
        ["an hour that is not a full hour", { hours: { from: 545, to: 600 } }],
        ["an hour past the end of the day", { hours: { from: 0, to: 1440 } }],
      ] as const) {
        check(`the choices are refused with ${label}`, refusal(await asApp(`/api/app/hosts/${maya.handle}/choices`, { body, jar: cust.jar })) === "not_valid");
      }
      check("a choice named 'tellPosts' is not taken from the app, whatever is sent", (await asApp(`/api/app/hosts/${maya.handle}/choices`, { body: { tellPosts: false }, jar: cust.jar })).status === 400 && (await line()).tellPosts === true);
      check("choices for a host one does not follow are refused", refusal(await asApp(`/api/app/hosts/${hidden.handle}/choices`, { body: { tellOnline: false }, jar: cust.jar })) === "not_valid");

      // A paused person cannot follow, and can still unfollow.
      const other = await asHost(await person("other"), "other", `Other Host ${RUN}`);
      await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, cust.id));
      check("a paused person cannot follow", refusal(await asApp(`/api/app/hosts/${other.handle}/follow`, { body: {}, jar: cust.jar })) === "paused");
      const unfollowed = await asApp(`/api/app/hosts/${maya.handle}/unfollow`, { body: {}, jar: cust.jar });
      check("but can stop following", unfollowed.status === 200 && (unfollowed.json as AppFollowDone).follow === "ended" && (await line()).unfollowedAt !== null);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
      check("her page then offers Follow again, as to someone who said no", (await page(maya.handle, cust.jar)).body?.follow === "ended");
      const none = await asApp(`/api/app/hosts/nobody${RUN}/unfollow`, { body: {}, jar: cust.jar });
      check("unfollowing a handle that does not exist is answered the same, and gives nothing away", none.status === 200 && (none.json as AppFollowDone).words === (unfollowed.json as AppFollowDone).words);
      check("a step that does not exist is not found", refusal(await asApp(`/api/app/hosts/${maya.handle}/else`, { body: {}, jar: cust.jar })) === "not_found");
      check("a browser cannot follow through the app's address", refusal(await asBrowser(`/api/app/hosts/${maya.handle}/follow`, { body: {}, jar: cust.jar })) === "not_the_app");
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const projectIds = projects.length ? projects : [randomUUID()];
    await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.id, projectIds));
    await db.delete(schema.memberships).where(or(inArray(schema.memberships.hostId, ids), inArray(schema.memberships.customerId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.hostPhotos).where(inArray(schema.hostPhotos.userId, ids));
    await db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids)));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `apphosts-${RUN}-%`));
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
