/**
 * Testing tool: plays hosts and the founder through a host's photo (plans/29), against the local
 * database, and checks every result. Meta, its picture server and the checking services are
 * pretended: nothing outside this computer is ever asked from here.
 *
 * The journey about the pages needs the app running (`npm run dev`).
 *
 * It works on this computer's test database only, makes its own people (their ids start "hp-"),
 * and at the end puts the lines about the checking services back as it found them and removes
 * everything it made. It must have the test database to itself while it runs: no always-on helper
 * and no second check script beside it.
 *
 * Usage: npx tsx scripts/photo-check.ts            (everything)
 *        npx tsx scripts/photo-check.ts --only=4   (one journey)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import type { PhotoAnswer } from "../src/lib/profiles/bio-check";
import type { PhotoOptions, PhotoOutcome } from "../src/lib/profiles/photo";
import type { TikTokAccount, TikTokSettings } from "../src/lib/profiles/tiktok";
import type { Checker } from "../src/lib/projects/checks/types";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${!ok && detail !== "" ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const sharp = (await import("sharp")).default;
  const Photo = await import("../src/lib/profiles/photo");
  const { PHOTO } = await import("../src/lib/profiles/photo-rules");
  const profiles = await import("../src/lib/profiles/profiles");
  const closing = await import("../src/lib/profiles/closing");
  const { ProfileError } = profiles;
  const { searchHosts } = await import("../src/lib/profiles/search");
  const { runPictureRound } = await import("../src/lib/projects/queue");
  const { givePlace, takePlace } = await import("../src/lib/projects/pictures");
  const { PICTURE } = await import("../src/lib/projects/rules");
  const { createReport, REPORT_REASONS } = await import("../src/lib/safety/reports");
  const Tik = await import("../src/lib/profiles/tiktok-photo");
  const TikLogin = await import("../src/lib/profiles/tiktok-login");
  const { readNote, writeNote } = await import("../src/lib/profiles/login-note");

  const RUN = randomUUID().slice(0, 8);
  const TAG = RUN.slice(0, 6);
  const MIN = 60_000;
  const BASE = "http://localhost:3000";
  const GOOD = "https://scontent-test-1.xx.fbcdn.net/v/t51/photo.jpg?oe=1";
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",").map(Number);
  const startedAt = new Date();
  const photos = schema.hostPhotos;
  const tries = schema.hostPhotoTries;
  const pictures = schema.projectPictures;
  const fingerprint = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

  // ------------------------------------------------------------------------
  // The clock, the people, the pictures
  // ------------------------------------------------------------------------
  let clock = Date.now();
  const now = () => new Date(clock);
  const later = (minutes: number) => void (clock += minutes * MIN);

  type Host = { id: string; name: string; handle: string; igName: string; igNumber: string; picture: Buffer };
  /** Everyone this run made. The look at the diary's pictures and the queue's rounds only ever touch theirs. */
  const people: string[] = [];
  let made = 0;
  const base = String(parseInt(RUN, 16));
  const number = (n: number) => `${base}${String(n).padStart(4, "0")}`;
  let shade = 0;
  /** A picture of a colour of its own each time, as a network's picture server would send it. */
  const picture = (side = 320) => sharp({ create: { width: side, height: side, channels: 3, background: { r: (++shade * 37) % 256, g: (shade * 91) % 256, b: (shade * 53) % 256 } } }).jpeg().toBuffer();

  async function person(kind: string): Promise<{ id: string; name: string; email: string }> {
    const id = `hp-${RUN}-${++made}-${kind}`;
    const stamp = new Date();
    const row = { id, name: `Photo check ${kind} ${made}`, email: `photocheck-${RUN}-${made}@example.test` };
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
    people.push(id);
    return row;
  }
  /** Writes a confirmed entry as a proof would leave it: with the code (no number) or by signing in (with the network's number). */
  const confirm = (userId: string, network: string, nameKey: string, providerAccountId: string | null = null) =>
    db.insert(schema.socialAccounts).values({ userId, network, nameTyped: nameKey, nameKey, url: `https://example.test/${network}/${nameKey}`, code: `connect-${randomUUID().slice(0, 10)}`, codeExpiresAt: new Date(Date.now() + 86_400_000), confirmedAt: new Date(), providerAccountId });
  /**
   * A host with an approved page and a confirmed Instagram account. `bySignIn`: the entry carries
   * Meta's number. `spare`: a second confirmed account (YouTube), so the Instagram one can be
   * removed or replaced although the page is approved.
   */
  async function newHost(opts: { status?: string; bySignIn?: boolean; spare?: boolean; instagram?: boolean } = {}): Promise<Host> {
    const p = await person("host");
    const handle = `hp${RUN}${made}`;
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle, handleKey: handle, displayName: `Photo host ${RUN} ${made}`, pricePer15Cents: 1000, status: opts.status ?? "approved", usConfirmedAt: new Date() });
    const host: Host = { id: p.id, name: p.name, handle, igName: `hp.${made}.${TAG}`, igNumber: number(made), picture: await picture() };
    if (opts.instagram !== false) await confirm(p.id, "instagram", host.igName, opts.bySignIn ? host.igNumber : null);
    if (opts.spare) await confirm(p.id, "youtube", `hpyt${made}${TAG}`);
    return host;
  }
  let adminMade: { id: string; email: string } | null = null;
  /** The founder of this run: an admin of its own, so the emails "to the founder" can be counted. */
  const theAdmin = async () => {
    if (!adminMade) {
      adminMade = await person("admin");
      await db.insert(schema.admins).values({ userId: adminMade.id });
    }
    return adminMade;
  };
  const mails = async (to: string, part: string) => (await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${part}%`)))).length;

  // ------------------------------------------------------------------------
  // The stand-ins: Meta, its picture server, the checking services
  // ------------------------------------------------------------------------
  type Kind = "clean" | "flagged" | "out" | "fault";
  type Name = "openai" | "azure" | "sightengine";
  let says: Record<Name, Kind | (() => Kind | Promise<Kind>)>;
  let keys: Record<Name, string | null>;
  let partial = new Set<Name>();
  /** Who was asked, in order, and about which picture (the fingerprint of its bytes). */
  let asked: Name[] = [];
  let askedAbout: string[] = [];
  /** How often Meta and its picture server were asked. */
  let metaAsked: string[] = [];
  let fetched = 0;
  const standIn = (name: Name): Checker => ({
    name,
    get keyMark() {
      return keys[name];
    },
    check: async (jpeg) => {
      asked.push(name);
      askedAbout.push(fingerprint(jpeg));
      const say = says[name];
      const kind = typeof say === "function" ? await say() : say;
      if ((kind as string) === "throw") throw new Error("the stand-in broke");
      return { kind, detail: `${name} said ${kind}`, ...(kind === "flagged" && partial.has(name) ? { partial: true } : {}) };
    },
  });
  const standIns = () => [standIn("openai"), standIn("azure"), standIn("sightengine")];
  const forget = () => {
    asked = [];
    askedAbout = [];
    metaAsked = [];
    fetched = 0;
  };
  /** A clean start for a journey: every stand-in answers "clean", no service has a history, and the clock is two hours on. */
  const fresh = async () => {
    says = { openai: "clean", azure: "clean", sightengine: "clean" };
    keys = { openai: "key-1", azure: "key-1", sightengine: "key-1" };
    partial = new Set();
    forget();
    later(120);
    await db.delete(schema.pictureCheckers);
  };
  type Press = { meta?: PhotoAnswer | (() => PhotoAnswer | Promise<PhotoAnswer>); picture?: Buffer | null; meanwhile?: PhotoOptions["meanwhile"]; services?: Checker[]; fetchBreaks?: boolean };
  /** The line of the try the last press wrote, as it stands after the press; undefined when the press wrote none. */
  let tried: Awaited<ReturnType<typeof triesOf>>[number] | undefined;
  /** Whether the last press said that a refusal took the host's photo down. */
  let tookDown: boolean | undefined;
  /** One press of "Use my Instagram photo" or "Update", with the stand-ins. */
  const press = async (host: Host, over: Press = {}): Promise<PhotoOutcome> => {
    const before = new Set((await db.select({ id: tries.id }).from(tries).where(eq(tries.userId, host.id))).map((row) => row.id));
    const outcome = await pressOnly(host, over);
    tried = (await db.select().from(tries).where(eq(tries.userId, host.id))).find((row) => !before.has(row.id));
    return outcome;
  };
  const pressOnly = async (host: Host, over: Press = {}): Promise<PhotoOutcome> => {
    const result = await pressResult(host, over);
    tookDown = result.tookDown;
    return result.outcome;
  };
  const pressResult = (host: Host, over: Press = {}) =>
    (
      Photo.takePhoto(
        { userId: host.id, network: "instagram" },
        {
          read: async (nameKey) => {
            metaAsked.push(nameKey);
            const meta = over.meta ?? { kind: "picture", accountId: host.igNumber, address: GOOD };
            return typeof meta === "function" ? meta() : meta;
          },
          fetch: async () => {
            fetched++;
            if (over.fetchBreaks) throw new Error("something of our own broke");
            return over.picture === undefined ? host.picture : over.picture;
          },
          services: over.services ?? standIns(),
          clock: now,
          diaryHosts: people,
          meanwhile: over.meanwhile,
        },
      )
    );
  const photoOf = async (host: { id: string }) => (await db.select({ id: photos.id, network: photos.network, sourceNameKey: photos.sourceNameKey, sourceAccountId: photos.sourceAccountId, sha256: photos.sha256, byteLength: photos.byteLength, checkedBy: photos.checkedBy, rulesVersion: photos.rulesVersion, lockedAt: photos.lockedAt, reportMadeAt: photos.reportMadeAt }).from(photos).where(eq(photos.userId, host.id))).filter((row) => !row.lockedAt)[0];
  const lockedOf = async (host: { id: string }) => (await db.select({ id: photos.id, lockedAt: photos.lockedAt, lockedBy: photos.lockedBy, reportMadeAt: photos.reportMadeAt }).from(photos).where(eq(photos.userId, host.id))).filter((row) => row.lockedAt);
  const bytesOf = async (photoId: string) => (await db.select({ bytes: photos.bytes }).from(photos).where(eq(photos.id, photoId)))[0]?.bytes;
  const triesOf = async (host: { id: string }) => db.select().from(tries).where(eq(tries.userId, host.id));
  const sees = async (viewer: { id: string; admin: boolean } | null, id: string) => Boolean(await Photo.photoFor(viewer, id));
  const entryOf = async (host: { id: string }, network = "instagram") => (await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.userId, host.id), eq(schema.socialAccounts.network, network))))[0];
  const checkerLine = async (name: Name) => (await db.select().from(schema.pictureCheckers).where(eq(schema.pictureCheckers.service, name)))[0];
  const refusal = async (work: Promise<unknown>): Promise<string | null> => {
    try {
      await work;
      return null;
    } catch (error) {
      if (error instanceof ProfileError) return error.message;
      throw error;
    }
  };
  /** A sign-in at Meta that shares exactly this account, as the return address would run it. */
  const signIn = (host: Host, accountId: string, username: string) => profiles.confirmInstagramBySignIn({ userId: host.id, shared: [{ accountId, username }], now: now() });
  /** A picture in a host's diary, written straight in, in the state a journey needs. */
  async function diaryPicture(host: Host, values: { sha256: string; state: "shown" | "refused" | "locked" | "removed"; level?: "full" | "nudity_only"; refusedByChecker?: boolean; suspectedByFounder?: boolean }) {
    let [project] = await db.select().from(schema.projects).where(eq(schema.projects.hostId, host.id));
    if (!project) [project] = await db.insert(schema.projects).values({ hostId: host.id, name: "A project", startedAt: now() }).returning();
    const [post] = await db.insert(schema.projectPosts).values({ projectId: project.id, text: "A post" }).returning();
    const [row] = await db
      .insert(pictures)
      .values({ postId: post.id, hostId: host.id, width: 320, height: 320, byteLength: 1000, sha256: values.sha256, uploadedAt: now(), state: values.state, level: values.state === "shown" ? (values.level ?? "full") : null, refusedByChecker: values.refusedByChecker ?? false, suspectedByFounder: values.suspectedByFounder ?? false, lockedAt: values.state === "locked" ? now() : null, checkedBy: "openai", checkedAt: now(), rulesVersion: PICTURE.rulesVersion })
      .returning();
    return row;
  }
  /** A diary picture that waits for its check and is due now, with its file, for a round of the queue. */
  async function waitingDiaryPicture(host: Host, label: string) {
    const row = await diaryPicture(host, { sha256: fingerprint(Buffer.from(`${label}-${RUN}`)), state: "shown" });
    await db.update(pictures).set({ state: "waiting", level: null, nextTryAt: now(), checkedBy: null, checkedAt: null }).where(eq(pictures.id, row.id));
    await db.insert(schema.projectPictureFiles).values({ pictureId: row.id, bytes: (await (await import("../src/lib/projects/copy")).makeCopy(await picture())).bytes });
    return row;
  }
  /** What Connect's copy of a picture is, as takePhoto makes it: its fingerprint. */
  const copyPrint = async (original: Buffer) => fingerprint((await (await import("../src/lib/projects/copy")).makeCopy(original)).bytes);
  const get = async (path: string) => {
    const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
    return { status: response.status, headers: response.headers, text: response.headers.get("content-type")?.startsWith("image/") ? "" : await response.text(), bytes: response.headers.get("content-type")?.startsWith("image/") ? Buffer.from(await response.arrayBuffer()) : null };
  };

  const journeys: Array<[string, () => Promise<void>]> = [];
  const journey = (title: string, run: () => Promise<void>) => void journeys.push([title, run]);

  // ========================================================================
  journey("Taking a photo, updating it, removing it", async () => {
    await fresh();
    const host = await newHost();
    check("before: the host has no photo, and the Hosting page's facts say so", !(await photoOf(host)) && (await Photo.ownPhotoState(host.id)).photo === null && !(await Photo.ownPhotoState(host.id)).locked);
    const first = await press(host);
    const photo = await photoOf(host);
    const stored = photo ? await bytesOf(photo.id) : undefined;
    const kept = stored ? await sharp(stored).metadata() : null;
    check("one press: Meta is asked once for the confirmed name, the picture fetched once, the first service asked once, and the photo is the host's", first === "shown" && metaAsked.join() === host.igName && fetched === 1 && asked.join() === "openai" && Boolean(photo), { first, metaAsked, fetched, asked });
    check("what is kept is Connect's own JPEG copy, with its fingerprint, the account's name and Meta's number, and who passed it by which rules", kept?.format === "jpeg" && stored !== undefined && fingerprint(stored) === photo.sha256 && stored.length === photo.byteLength && photo.network === "instagram" && photo.sourceNameKey === host.igName && photo.sourceAccountId === host.igNumber && photo.checkedBy === "openai" && photo.rulesVersion === PICTURE.rulesVersion && askedAbout[0] === photo.sha256);
    const line = tried;
    check("the try's line says how it ended, with the entry it started from", line?.result === "shown" && line.entryNameKey === host.igName && line.entryAccountId === null && line.sha256 === photo.sha256 && line.endedAt !== null, line);
    check("the photo's facts for the Hosting page, the host's page and the search", (await Photo.ownPhotoState(host.id)).photo?.id === photo.id && (await Photo.photosOf([host.id])).get(host.id) === photo.id && (await searchHosts(host.handle, null, new Date())).find((found) => found.handle === host.handle)?.photoId === photo.id);

    // Update: a new picture, a new address.
    forget();
    host.picture = await picture();
    const second = await press(host);
    const updated = await photoOf(host);
    check("\"Update\" with a new picture: a new photo with a new address, and the old address gives nothing", second === "shown" && updated.id !== photo.id && updated.sha256 !== photo.sha256 && !(await sees(null, photo.id)) && (await sees(null, updated.id)) && (await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, host.id))).length === 1);
    // A failed update changes nothing.
    says.openai = "out";
    says.azure = "out";
    says.sightengine = "out";
    const failed = await press(host, { picture: await picture() });
    check("an update that cannot be checked changes nothing: the photo is as it was", failed === "not_checked" && (await photoOf(host)).id === updated.id, failed);
    // Remove.
    check("\"Remove\": the photo is gone, its address gives nothing, and removing twice says there was none", (await Photo.removePhoto({ userId: host.id, now: now() })) === true && !(await photoOf(host)) && !(await sees({ id: host.id, admin: false }, updated.id)) && (await Photo.removePhoto({ userId: host.id, now: now() })) === false);
  });

  // ========================================================================
  journey("Each way a try can end", async () => {
    await fresh();
    const host = await newHost({ bySignIn: true });
    const none = async () => !(await photoOf(host));
    /** One press each on its own day, so the day's five never get in the way. */
    const tryOne = async (over: Press) => {
      later(25 * 60);
      await db.delete(schema.pictureCheckers);
      forget();
      return press(host, over);
    };
    const endings: Array<[string, Press, PhotoOutcome, { fetched: number; asked: string }]> = [
      ["Meta shows no such account", { meta: { kind: "no_account" } }, "no_picture", { fetched: 0, asked: "" }],
      ["the account shows no picture", { meta: { kind: "no_picture" } }, "no_picture", { fetched: 0, asked: "" }],
      ["Meta says we asked too often", { meta: { kind: "too_often", code: 4 } }, "not_fetched", { fetched: 0, asked: "" }],
      ["Meta cannot be reached", { meta: { kind: "unavailable" } }, "not_fetched", { fetched: 0, asked: "" }],
      ["the name now leads to an account with another number", { meta: { kind: "picture", accountId: number(9000), address: GOOD } }, "no_picture", { fetched: 0, asked: "" }],
      ["a picture address on a server that is not Meta's", { meta: { kind: "picture", accountId: host.igNumber, address: "https://fbcdn.net.example.com/p.jpg" } }, "not_fetched", { fetched: 0, asked: "" }],
      ["a picture address that is not https", { meta: { kind: "picture", accountId: host.igNumber, address: "http://scontent.xx.fbcdn.net/p.jpg" } }, "not_fetched", { fetched: 0, asked: "" }],
      // (What makes the fetch itself give nothing, a redirect, a slow or a too large answer, is tried in the unit tests of photo-fetch.ts.)
      ["the picture server gives nothing", { picture: null }, "not_fetched", { fetched: 1, asked: "" }],
      ["a file that is not a picture", { picture: Buffer.from("<html>not a picture</html>") }, "unusable", { fetched: 1, asked: "" }],
      ["a picture smaller than 100 points a side", { picture: await picture(60) }, "unusable", { fetched: 1, asked: "" }],
    ];
    for (const [label, over, expected, counts] of endings) {
      const outcome = await tryOne(over);
      const line = tried;
      check(`${label}: "${expected}", nothing kept, no service asked`, outcome === expected && line?.result === expected && (await none()) && fetched === counts.fetched && asked.join() === counts.asked, { outcome, line: line?.result, fetched, asked });
    }
    // Meta's refusal of our own key is told to the founder's page, under its own name.
    const before = (await profiles.refusedBioChecks(now())).find((row) => row.network === profiles.INSTAGRAM_PHOTO)?.count ?? 0;
    const refusedKey = await tryOne({ meta: { kind: "refused", code: 190 } });
    const forFounder = (await profiles.refusedBioChecks(now())).find((row) => row.network === profiles.INSTAGRAM_PHOTO)?.count ?? 0;
    check("Meta refuses our own key: the host is told to try later, and it shows up for the founder's page under its own name", refusedKey === "not_fetched" && forFounder === before + 1 && (await none()), { refusedKey, before, forFounder });
    // Meta's stand-in breaks.
    const broke = await tryOne({
      meta: () => {
        throw new Error("boom");
      },
    });
    check("a request to Meta that breaks ends the try as \"not fetched\"", broke === "not_fetched" && tried?.result === "not_fetched" && (await none()), broke);

    // Something of our own breaks in the middle.
    const brokeInside = await tryOne({ fetchBreaks: true });
    check("something of our own breaks in the middle: the host is told so (not that something was decided meanwhile), the try is ended, the one place is given back, and nothing is kept", brokeInside === "failed" && tried?.result === "stopped" && takePlace() && (givePlace(), true) && (await none()), { brokeInside, line: tried?.result });

    // The checking services.
    says = { openai: "flagged", azure: "clean", sightengine: "clean" };
    const flagged = await tryOne({});
    check("a service flags it: not accepted, nothing kept, and nobody else is asked for a second opinion", flagged === "not_accepted" && asked.join() === "openai" && (await none()) && tried?.result === "not_accepted" && tried?.checkedBy === "openai", { flagged, asked });
    says = { openai: "flagged", azure: "clean", sightengine: "clean" };
    partial = new Set<Name>(["openai"]);
    host.picture = await picture();
    const partly = await tryOne({});
    check("a flag with parts of the answer missing refuses the photo all the same, and does not count as the service working", partly === "not_accepted" && (await none()) && !(await checkerLine("openai"))?.lastGoodAt, { partly, line: await checkerLine("openai") });
    partial = new Set();
    host.picture = await picture();
    says = { openai: "out", azure: "out", sightengine: "out" };
    const allOut = await tryOne({});
    check("every service is out: nothing is kept, Connect's own checker never stands in, and each service starts its five minutes", allOut === "not_checked" && asked.join() === "openai,azure,sightengine" && (await none()) && Boolean((await checkerLine("openai"))?.outUntil) && Boolean((await checkerLine("sightengine"))?.outUntil), { allOut, asked });
    says = { openai: "fault", azure: "clean", sightengine: "clean" };
    const fault = await tryOne({});
    check("a service with a fault: the photo is not passed on to the next one, and nothing is kept", fault === "not_checked" && asked.join() === "openai" && (await none()) && Boolean((await checkerLine("openai"))?.faultSince), { fault, asked });
    says = { openai: "throw" as Kind, azure: "clean", sightengine: "clean" };
    const thrown = await tryOne({});
    check("a checker that breaks counts as a fault, never as the end of the press", thrown === "not_checked" && asked.join() === "openai" && (await none()), { thrown, asked });
    says = { openai: "out", azure: "clean", sightengine: "clean" };
    const second = await tryOne({});
    check("the first service is out and the second answers clean: the photo is shown, passed by the second", second === "shown" && asked.join() === "openai,azure" && (await photoOf(host))?.checkedBy === "azure", { second, asked });
    keys = { openai: null, azure: null, sightengine: null };
    forget();
    later(25 * 60);
    const noKeys = await press(host, { picture: await picture() });
    check("no service has a key: refused at the start, nothing asked of Meta, and no try written", noKeys === "no_checker" && metaAsked.length === 0 && tried === undefined, noKeys);
  });

  // ========================================================================
  journey("A refused photo stays refused", async () => {
    await fresh();
    const host = await newHost();
    says.openai = "flagged";
    const first = await press(host);
    const print = tried?.sha256;
    check("a flagged photo's fingerprint is kept on the try's line; its picture is kept nowhere", first === "not_accepted" && print === (await copyPrint(host.picture)) && (await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, host.id))).length === 0);
    // The same picture again, with every service now saying "clean".
    says = { openai: "clean", azure: "clean", sightengine: "clean" };
    forget();
    const again = await press(host);
    check("the same picture again is refused at once, without asking a service, although every service would now say clean", again === "refused_before" && asked.length === 0 && fetched === 1 && !(await photoOf(host)), { again, asked });
    await Photo.removePhoto({ userId: host.id, now: now() });
    later(3 * 24 * 60);
    forget();
    const days = await press(host);
    check("also after \"Remove\" and three days later", days === "refused_before" && asked.length === 0, days);
    // The same picture, refused in the host's diary.
    const diarist = await newHost();
    await diaryPicture(diarist, { sha256: await copyPrint(diarist.picture), state: "refused", refusedByChecker: true });
    forget();
    const fromDiary = await press(diarist);
    check("a picture that was refused in the host's own diary is refused as a photo, without asking a service", fromDiary === "refused_before" && asked.length === 0 && !(await photoOf(diarist)), fromDiary);
    // And one that was refused in another host's diary is not this host's business.
    const other = await newHost();
    other.picture = diarist.picture;
    forget();
    check("the same picture from another host is checked on its own", (await press(other)) === "shown" && asked.join() === "openai");
    // Locked in the diary: refused, and the founder is told.
    const admin = await theAdmin();
    const locker = await newHost();
    await diaryPicture(locker, { sha256: await copyPrint(locker.picture), state: "locked" });
    forget();
    const lockedOne = await press(locker);
    check("a picture that is the same as one removed and reported in the host's diary: not taken, no service asked, and the founder is told once", lockedOne === "refused_before" && asked.length === 0 && !(await photoOf(locker)) && (await mails(admin.email, "A locked picture was tried as a host's photo")) === 1, lockedOne);

    // A service refuses the very picture that is the host's photo: it is shown to nobody afterwards.
    const same = await newHost();
    await press(same);
    const shownBefore = await photoOf(same);
    says.openai = "flagged";
    const sameAgain = await press(same);
    says.openai = "clean";
    check("\"Update\" without a new picture, and a service now flags it: the photo, which is that very picture, is taken down, and the host is told so", Boolean(shownBefore) && sameAgain === "not_accepted" && tookDown === true && !(await photoOf(same)) && !(await sees(null, shownBefore.id)), { sameAgain, tookDown });
    const other2 = await newHost();
    await press(other2);
    const keeps = await photoOf(other2);
    says.openai = "flagged";
    const different = await press(other2, { picture: await picture() });
    says.openai = "clean";
    check("a service flags a different, new picture: the photo the host has stays, as before", different === "not_accepted" && tookDown === false && (await photoOf(other2))?.id === keeps.id, { different, tookDown });

    // Two tries for the same copy that overlap: the first was stopped while a service was still looking.
    const clean = (name: "azure", gate?: { reached: () => void; go: Promise<void> }): Checker => ({
      name,
      keyMark: "key-1",
      check: async () => {
        gate?.reached();
        await gate?.go;
        return { kind: "clean", detail: `${name} said clean` };
      },
    });
    // (a) The refusal of the first comes while the second is with its own service: the second must not write the photo.
    const racer = await newHost();
    let secondTry: Promise<PhotoOutcome> = Promise.resolve("failed");
    let letSecondGo: () => void = () => undefined;
    const go = new Promise<void>((resolve) => (letSecondGo = resolve));
    says.openai = async () => {
      // While the first service looks: the host presses "Remove" (the first try is stopped), then presses again.
      await Photo.removePhoto({ userId: racer.id, now: now() });
      await new Promise<void>((reached) => {
        secondTry = pressOnly(racer, { services: [clean("azure", { reached, go })] });
      });
      // The second try has passed its own look for refusals and is with its service. Now the first service flags.
      return "flagged" as const;
    };
    const firstTry = await pressOnly(racer);
    letSecondGo();
    const secondOutcome = await secondTry;
    says.openai = "clean";
    check("a first try is stopped while its service is looking, a second try for the same picture begins, and then the first service refuses it: the second try's clean answer does not make it the photo", firstTry === "not_accepted" && secondOutcome === "refused_before" && !(await photoOf(racer)), { firstTry, secondOutcome });
    // (b) The other way round: the second try has finished and shown the photo before the first service refuses.
    const racer2 = await newHost();
    let finishedFirst = "failed" as PhotoOutcome;
    says.openai = async () => {
      await Photo.removePhoto({ userId: racer2.id, now: now() });
      finishedFirst = await pressOnly(racer2, { services: [clean("azure")] });
      return "flagged" as const;
    };
    const lateRefusal = await pressOnly(racer2);
    says.openai = "clean";
    check("the same, with the second try finished first: the refusal that comes afterwards takes the photo down", finishedFirst === "shown" && lateRefusal === "not_accepted" && tookDown === true && !(await photoOf(racer2)), { finishedFirst, lateRefusal, tookDown });
    forget();
    check("and the picture stays refused for that host", (await press(racer2)) === "refused_before" && asked.length === 0);
  });

  // ========================================================================
  journey("The limits: five in 24 hours, one at a time, and everyone's hour at Instagram", async () => {
    await fresh();
    const host = await newHost();
    const outcomes: PhotoOutcome[] = [];
    for (let i = 0; i < PHOTO.triesPerDay; i++) {
      later(1);
      outcomes.push(await press(host, i % 2 ? { meta: { kind: "no_account" } } : { picture: await picture() }));
    }
    forget();
    const sixth = await press(host);
    check(`the sixth try in 24 hours is refused before anything is asked, whatever became of the five (${outcomes.join(", ")})`, sixth === "limit" && metaAsked.length === 0 && (await triesOf(host)).length === PHOTO.triesPerDay, sixth);
    // (The five tries were at minutes 1 to 5, so the clock stands 4 minutes after the first.)
    later(24 * 60 - 6);
    check("still refused two minutes before the first try is 24 hours old", (await press(host)) === "limit");
    later(4);
    check("and allowed once the first try is more than 24 hours old", (await press(host, { picture: await picture() })) === "shown");

    // Two presses at the same moment.
    const twin = await newHost();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = pressOnly(twin, { meanwhile: async (at) => (at === "asked" ? held : undefined) });
    let quick: PhotoOutcome | undefined;
    try {
      // (The first press has written its try once Meta was asked.)
      for (let i = 0; i < 250 && (await triesOf(twin)).length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      quick = await press(twin);
    } finally {
      release();
    }
    const slowOutcome = await slow;
    check("a second press while the first is under way is refused, and the first goes through", quick === "running" && slowOutcome === "shown" && (await triesOf(twin)).length === 1, { quick, slowOutcome });
    const pair = await newHost();
    const both = await Promise.all([pressOnly(pair), pressOnly(pair)]);
    check("two presses sent at the same moment: each is either taken or told that one is under way, and there are never two photos", both.includes("shown") && both.every((outcome) => outcome === "shown" || outcome === "running") && (await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, pair.id))).length === 1, both);

    // A try that never ended.
    const stuck = await newHost();
    const [left] = await db.insert(tries).values({ userId: stuck.id, network: "instagram", startedAt: now(), entryNameKey: stuck.igName, entryAccountId: null }).returning();
    later(1);
    check("a try that has not ended blocks a second one for two minutes", (await press(stuck)) === "running");
    later(2);
    const afterStuck = await press(stuck);
    const [leftNow] = await db.select().from(tries).where(eq(tries.id, left.id));
    check("after that it counts as stopped, a new try goes through, and it still counts toward the day's five", afterStuck === "shown" && leftNow.result === "stopped" && (await triesOf(stuck)).length === 2, { afterStuck, left: leftNow.result });

    // Everyone's hour at Instagram, bio checks and photos together. In an hour of its own: the tries above are older.
    later(61);
    const crowd = await newHost();
    await db.insert(schema.bioChecks).values(Array.from({ length: profiles.INSTAGRAM_CHECKS_PER_HOUR - 1 }, () => ({ userId: crowd.id, network: "instagram", startedAt: now(), result: "not_found" })));
    forget();
    const lastFree = await press(crowd);
    const full = await press(await newHost());
    check("everyone's requests to Instagram in an hour, bio checks and photos together: the last free one goes through, the next is told to wait, and nothing is asked", lastFree === "shown" && full === "busy" && metaAsked.length === 1, { lastFree, full });
    await db.insert(schema.bioChecks).values(Array.from({ length: 50 }, () => ({ userId: crowd.id, network: profiles.INSTAGRAM_SIGN_IN, startedAt: now(), result: "refused" })));
    later(61);
    check("an hour later there is room again", (await press(await newHost())) === "shown");

    // Diary pictures that wait for their full check come first.
    const diarist = await newHost();
    const owed = await diaryPicture(diarist, { sha256: fingerprint(Buffer.from(`owed-${RUN}`)), state: "shown", level: "nudity_only" });
    forget();
    const waits = await press(await newHost());
    check("while a diary picture is shown after a check for nudity only, a photo does not go ahead of it: refused at the start, nothing asked, no try written", waits === "no_checker" && tried === undefined && metaAsked.length === 0 && asked.length === 0, waits);
    await db.update(pictures).set({ suspectedByFounder: true }).where(eq(pictures.id, owed.id));
    check("a picture the founder holds as suspected is owed nothing by the services (the queue never sends it), so it does not hold photos up", (await press(await newHost())) === "shown");
    await db.update(pictures).set({ suspectedByFounder: false, level: "full" }).where(eq(pictures.id, owed.id));
    check("once that picture has had its full check, photos go through again", (await press(await newHost())) === "shown");
    // A diary picture comes to be owed its full check while a photo is on its way.
    const lateHost = await newHost();
    forget();
    const overtaken = await press(lateHost, { meanwhile: async (at) => void (at === "copied" && (await db.update(pictures).set({ level: "nudity_only" }).where(eq(pictures.id, owed.id)))) });
    check("a diary picture comes to be owed its full check while a photo is being fetched: the photo is sent to no service, and nothing is kept", overtaken === "not_checked" && asked.length === 0 && !(await photoOf(lateHost)), { overtaken, asked });
    await db.update(pictures).set({ level: "full" }).where(eq(pictures.id, owed.id));

    // The start waits for whoever holds the person's and the profile's locks (removing a photo, changing an account, closing).
    const waiter = await newHost();
    let letGo: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => (letGo = resolve));
    let lockTaken: () => void = () => undefined;
    const taken = new Promise<void>((resolve) => (lockTaken = resolve));
    const holder = db.transaction(async (tx) => {
      await profiles.lockedProfile(tx, waiter.id);
      lockTaken();
      await holding;
    });
    // (If the holder fails before it has the locks, this does not wait for ever.)
    await Promise.race([taken, holder]);
    let writtenWhileHeld = -1;
    let reachedTheLock = false;
    let othersGoOn = false;
    const waitingPress = pressOnly(waiter);
    // Everyone else's requests to Instagram: this takes their lock, as a bio check or another host's photo would.
    let probe: Promise<boolean> = Promise.resolve(false);
    try {
      // The database itself says when the press is waiting for a lock: nothing else runs on this test database now.
      for (let i = 0; i < 250 && !reachedTheLock; i++) {
        const [{ waitingNow }] = await db.execute<{ waitingNow: number }>(sql`select count(*)::int as "waitingNow" from pg_locks where not granted`);
        reachedTheLock = waitingNow > 0;
        if (!reachedTheLock) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      writtenWhileHeld = (await triesOf(waiter)).length;
      probe = db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"bio-check:instagram:global"}))`);
        return true;
      });
      othersGoOn = await Promise.race([probe, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))]);
    } finally {
      letGo();
    }
    await holder;
    // (Whichever way the race went, the probe is over before the script goes on.)
    await probe.catch(() => false);
    check("a press waits while another step holds the host's locks, and writes its try only afterwards: a removal either sees the try or comes first", reachedTheLock && writtenWhileHeld === 0 && (await waitingPress) === "shown" && (await triesOf(waiter)).length === 1, { writtenWhileHeld });
    check("while it waits, it does not hold up anyone else's bio check or photo", othersGoOn);

    // One picture is opened at a time, a diary upload or a photo.
    const waiting = await newHost();
    check("(the one place for opening a picture is free)", takePlace());
    forget();
    const noPlace = await press(waiting);
    givePlace();
    check("while a diary upload holds the one place for opening a picture, a photo is told to try again, and its picture is not fetched", noPlace === "place_taken" && fetched === 0 && tried?.result === "not_fetched", noPlace);
    check("and the place is given back after a photo, however it ended", (await press(waiting, { picture: Buffer.from("not a picture") })) === "unusable" && takePlace() && (givePlace(), true));
  });

  // ========================================================================
  journey("Things that change while a try is under way", async () => {
    await fresh();
    const admin = await theAdmin();
    /** A host who already has a photo, and one press of "Update" during which something happens. */
    const during = async (when: "asked" | "copied" | "checked", change: (host: Host) => Promise<unknown>, opts: Parameters<typeof newHost>[0] = { spare: true }) => {
      const host = await newHost(opts);
      await press(host);
      const before = await photoOf(host);
      forget();
      const outcome = await press(host, { picture: await picture(), meanwhile: async (at) => void (at === when && (await change(host))) });
      return { host, before, outcome, after: await photoOf(host), line: tried };
    };
    for (const when of ["asked", "copied", "checked"] as const) {
      const removed = await during(when, async (host) => profiles.removeSocialName(host.id, (await entryOf(host)).id));
      check(`the account is removed (after "${when}"): the old photo goes with the account, and the late answer writes none`, removed.outcome === "stopped" && !removed.after && removed.line?.result === "stopped", { outcome: removed.outcome, after: removed.after?.id });
    }
    const firstTime = await newHost({ spare: true });
    forget();
    const firstOutcome = await press(firstTime, { meanwhile: async (at) => void (at === "copied" && (await profiles.removeSocialName(firstTime.id, (await entryOf(firstTime)).id))) });
    check("the same on a first try, when there is no photo yet: the try is stopped, no service is asked, and no photo is written", firstOutcome === "stopped" && tried?.result === "stopped" && asked.length === 0 && !(await photoOf(firstTime)), { firstOutcome, asked });
    const awayAndBack = await during(
      "copied",
      async (host) => {
        // Another account is confirmed in its place, and then the first one again: the entry reads exactly as at the start.
        await signIn(host, number(8500 + made), `hp.away.${made}.${TAG}`);
        await signIn(host, host.igNumber, host.igName);
      },
      { bySignIn: true, spare: true },
    );
    const backEntry = await entryOf(awayAndBack.host);
    check("the account is replaced and then confirmed again meanwhile, so the entry reads as at the start: the try was stopped all the same, and writes nothing", awayAndBack.outcome === "stopped" && !awayAndBack.after && backEntry.nameKey === awayAndBack.host.igName && backEntry.providerAccountId === awayAndBack.host.igNumber && asked.length === 0, { outcome: awayAndBack.outcome, asked });
    const liftedPause = await during("copied", async (host) => {
      await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, host.id));
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, host.id));
    });
    check("a pause that is lifted again before the end stops nothing: whether the account may do this is asked at the start and at the end", liftedPause.outcome === "shown" && liftedPause.after?.id !== liftedPause.before.id, liftedPause.outcome);
    const retyped = await during("copied", (host) => profiles.addSocialName(host.id, "instagram", `hp.other.${made}.${TAG}`));
    check("another name is typed meanwhile: the old photo goes, and the late answer writes none", retyped.outcome === "stopped" && !retyped.after, retyped.outcome);
    const replaced = await during("checked", (host) => signIn(host, number(8000 + made), `hp.new.${made}.${TAG}`), { bySignIn: true, spare: true });
    check("a sign-in brings a different account meanwhile: the old photo goes, and the picture of the old account is not written", replaced.outcome === "stopped" && !replaced.after, replaced.outcome);
    const renamed = await during("checked", (host) => signIn(host, host.igNumber, `hp.renamed.${made}.${TAG}`), { bySignIn: true, spare: true });
    check("the same account is renamed by a sign-in meanwhile: the old photo stays (it is the same account), and the try, started under the old name, writes nothing", renamed.outcome === "stopped" && renamed.after?.id === renamed.before.id, { outcome: renamed.outcome, kept: renamed.after?.id === renamed.before.id });
    const hostRemoved = await during("copied", (host) => Photo.removePhoto({ userId: host.id, now: now() }));
    check("the host presses \"Remove\" meanwhile: the photo is gone and stays gone, and no service is asked afterwards", hostRemoved.outcome === "stopped" && !hostRemoved.after && asked.length === 0, { outcome: hostRemoved.outcome, asked });
    const founderRemoved = await during("checked", async (host) => Photo.removePhotoAsFounder({ adminId: admin.id, photoId: (await photoOf(host)).id, now: now() }));
    check("the founder removes the photo meanwhile: the late answer does not bring one back", founderRemoved.outcome === "stopped" && !founderRemoved.after, founderRemoved.outcome);
    const founderLocked = await during("checked", async (host) => Photo.lockPhotoAsFounder({ adminId: admin.id, photoId: (await photoOf(host)).id, now: now() }));
    check("the founder removes and reports the photo meanwhile: no new photo is written, and the locked one is kept", founderLocked.outcome === "stopped" && !founderLocked.after && (await lockedOf(founderLocked.host)).length === 1, founderLocked.outcome);
    const closed = await during("checked", (host) => closing.closeAccount({ userId: host.id, by: admin.id }));
    check("the account is closed meanwhile: its photo is deleted, and the late answer writes none", closed.outcome === "stopped" && !closed.after && (await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, closed.host.id))).length === 0, closed.outcome);
    const paused = await during("checked", (host) => db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, host.id)));
    check("the account is paused meanwhile: the old photo stays as it was, and the new one is not written", paused.outcome === "stopped" && paused.after?.id === paused.before.id, paused.outcome);
    // A refusal is about the picture: it is written also when the try was stopped.
    const flagHost = await newHost({ spare: true });
    await press(flagHost);
    // The host presses "Remove" while the service is looking at the picture, and the service then flags it.
    says.openai = async () => {
      await Photo.removePhoto({ userId: flagHost.id, now: now() });
      return "flagged" as const;
    };
    const flaggedLate = await press(flagHost, { picture: await picture() });
    check("a service's flag is written to the try with its fingerprint also when the try was stopped while the service was looking", flaggedLate === "not_accepted" && tried?.result === "not_accepted" && Boolean(tried.sha256) && !(await photoOf(flagHost)), { flaggedLate, line: tried?.result });
    says.openai = "clean";

    // A refusal is never lost to something of ours breaking afterwards.
    const unlucky = await newHost();
    let checked = false;
    const breaksAfterwards: Checker = {
      name: "openai",
      // Once it has answered, anything that still wants its key (writing down that the service works) breaks.
      get keyMark() {
        if (checked) throw new Error("the bookkeeping broke");
        return "key-1";
      },
      check: async () => {
        checked = true;
        return { kind: "flagged", detail: "the stand-in flagged it" };
      },
    };
    const bookkeepingBroke = await press(unlucky, { services: [breaksAfterwards] });
    check("a service flags the photo and writing down the service's own state breaks: the refusal is written all the same, with its fingerprint", bookkeepingBroke === "not_accepted" && tried?.result === "not_accepted" && tried.sha256 === (await copyPrint(unlucky.picture)), { bookkeepingBroke, line: tried?.result });
    const unluckier = await newHost();
    says.openai = "flagged";
    const writeBroke = await press(unluckier, {
      meanwhile: async (at) => {
        if (at === "refused") throw new Error("the first write of the refusal broke");
      },
    });
    says.openai = "clean";
    forget();
    check("the first write of a refusal breaks: what is written in its place is the refusal, not a plain \"stopped\", and the host is told \"not accepted\"", writeBroke === "not_accepted" && tried?.result === "not_accepted" && tried.sha256 === (await copyPrint(unluckier.picture)), { writeBroke, line: tried?.result });
    check("so the same picture is refused at once the next time, although the service would now say clean", (await press(unluckier)) === "refused_before" && asked.length === 0);
    // Who cannot start at all.
    const noProfile = await person("plain");
    const stranger: Host = { id: noProfile.id, name: noProfile.name, handle: "", igName: `hp.none.${TAG}`, igNumber: number(7000), picture: await picture() };
    forget();
    const unconfirmed = await newHost({ instagram: false });
    await profiles.addSocialName(unconfirmed.id, "instagram", `hp.wait.${made}.${TAG}`);
    const pausedHost = await newHost();
    await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, pausedHost.id));
    const starts = [await press(stranger), await press(unconfirmed), await press(pausedHost), (await Photo.takePhoto({ userId: unconfirmed.id, network: "tiktok" })).outcome];
    check("someone without a host profile, a host whose Instagram account is not confirmed, and a paused host cannot start; TikTok is not part of this yet; nothing is asked and no try is written", starts.join() === "cannot,no_account,cannot,no_account" && metaAsked.length === 0 && (await triesOf(unconfirmed)).length === 0 && (await triesOf(pausedHost)).length === 0, starts);
  });

  // ========================================================================
  journey("Which account a photo belongs to", async () => {
    await fresh();
    // Proven with the code: tied to the name.
    const coded = await newHost({ spare: true });
    await press(coded);
    const codedPhoto = await photoOf(coded);
    await signIn(coded, coded.igNumber, coded.igName);
    check("an entry confirmed with the code gains the same number by a sign-in: the photo stays", (await photoOf(coded))?.id === codedPhoto.id && (await entryOf(coded)).providerAccountId === coded.igNumber);
    await signIn(coded, coded.igNumber, `hp.moved.${made}.${TAG}`);
    check("the account is renamed and proven again by signing in: the photo stays, by its number", (await photoOf(coded))?.id === codedPhoto.id && (await entryOf(coded)).nameKey === `hp.moved.${made}.${TAG}`);
    await signIn(coded, number(6000 + made), `hp.else.${made}.${TAG}`);
    check("a sign-in brings a different account: the photo goes in the same step", !(await photoOf(coded)) && !(await sees(null, codedPhoto.id)));

    const other = await newHost({ spare: true });
    await press(other);
    await signIn(other, number(6100 + made), other.igName);
    check("an entry confirmed with the code is proven by signing in with the same name but another number than the photo's: the photo goes", !(await photoOf(other)));

    const typed = await newHost({ spare: true });
    await press(typed);
    const typedPhoto = await photoOf(typed);
    await profiles.addSocialName(typed.id, "instagram", typed.igName);
    check("typing the name that is already confirmed changes nothing: the photo stays", (await photoOf(typed))?.id === typedPhoto.id);
    await profiles.addSocialName(typed.id, "x", `hpx${made}${TAG}`);
    check("adding an account on another network: the photo stays", (await photoOf(typed))?.id === typedPhoto.id);
    await profiles.addSocialName(typed.id, "instagram", `hp.typed.${made}.${TAG}`);
    check("typing another Instagram name: the photo goes in the same step", !(await photoOf(typed)));

    const last = await newHost();
    await press(last);
    const lastPhoto = await photoOf(last);
    const said = await refusal(profiles.removeSocialName(last.id, (await entryOf(last)).id));
    check("an approved host cannot remove their only confirmed account, so its photo stays", Boolean(said?.includes("needs one confirmed account")) && (await photoOf(last))?.id === lastPhoto.id, said);
    const spare = await newHost({ spare: true });
    await press(spare);
    await profiles.removeSocialName(spare.id, (await entryOf(spare, "youtube")).id);
    check("removing another account leaves the photo", Boolean(await photoOf(spare)));
    await confirm(spare.id, "x", `hpx${made}${TAG}b`);
    await profiles.removeSocialName(spare.id, (await entryOf(spare)).id);
    check("removing the account the photo came from removes the photo in the same step", !(await photoOf(spare)));

    // Taken while proven by signing in: Meta's number must be the entry's.
    const signed = await newHost({ bySignIn: true });
    forget();
    check("an entry proven by signing in: the photo is taken when Meta's number is the entry's, and its try remembers the number", (await press(signed)) === "shown" && tried?.entryAccountId === signed.igNumber && (await photoOf(signed)).sourceAccountId === signed.igNumber);
  });

  // ========================================================================
  journey("Who is handed a photo", async () => {
    await fresh();
    const admin = await theAdmin();
    const founder = { id: admin.id, admin: true };
    const visitor = { id: (await person("visitor")).id, admin: false };
    const matrix = async (host: Host) => {
      const id = (await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, host.id)))[0].id;
      const open = (await Photo.photoFor(null, id))?.open ?? null;
      return { text: [await sees(null, id), await sees(visitor, id), await sees({ id: host.id, admin: false }, id), await sees(founder, id)].map((yes) => (yes ? "yes" : "no")).join(" "), open, id };
    };
    const host = await newHost();
    await press(host);
    const whenOpen = await matrix(host);
    check("the page is open to everyone: a visitor, another person, the host and the founder all get it, and a browser may keep it", whenOpen.text === "yes yes yes yes" && whenOpen.open === true, whenOpen);
    check("the answer for the host or the founder on an open page may be kept too; it is the same picture anyone gets", (await Photo.photoFor({ id: host.id, admin: false }, whenOpen.id))?.open === true);
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
    const hidden = await matrix(host);
    // (A member or an invited person, who can open a hidden page, is "another person" here: photoFor knows nothing of
    // memberships, and the page's own reader hands a member's view no photo id at all.)
    check("hidden by the host: only the host and the founder, and their answer is not kept by a browser", hidden.text === "no no yes yes" && (await Photo.photoFor({ id: host.id, admin: false }, hidden.id))?.open === false, hidden);
    await db.update(schema.hostProfiles).set({ hidden: false, status: "pending" }).where(eq(schema.hostProfiles.userId, host.id));
    check("waiting for approval: only the host and the founder", (await matrix(host)).text === "no no yes yes");
    await db.update(schema.hostProfiles).set({ status: "declined" }).where(eq(schema.hostProfiles.userId, host.id));
    check("declined: only the host and the founder", (await matrix(host)).text === "no no yes yes");
    await db.update(schema.hostProfiles).set({ status: "suspended" }).where(eq(schema.hostProfiles.userId, host.id));
    check("suspended: only the host and the founder", (await matrix(host)).text === "no no yes yes");
    await db.update(schema.hostProfiles).set({ status: "approved" }).where(eq(schema.hostProfiles.userId, host.id));
    await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, host.id));
    const found = await searchHosts(host.handle, null, new Date());
    check("a paused account: as its page, which stays open; the search leaves the host out altogether", (await matrix(host)).text === "yes yes yes yes" && !found.some((one) => one.handle === host.handle));
    await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, host.id));
    const reason = REPORT_REASONS.find((one) => !one.urgent)!.key;
    const { reference } = await createReport({ reporterId: visitor.id, context: "profile", contextId: host.handle, reason, text: "", now: new Date() });
    const [filed] = await db.select().from(schema.reports).where(eq(schema.reports.reference, reference));
    check("a report of the host's page says which photo was showing", (JSON.parse(filed.snapshot) as { photoId?: string }).photoId === whenOpen.id, filed.snapshot.slice(0, 120));
    check("an address that is not an id, and one that belongs to nothing, give nothing", !(await sees(founder, "not-an-id")) && !(await sees(founder, "-".repeat(36))) && !(await sees(founder, "00000000-0000-4000-8000-000000000000")));
    check("the lists never carry the bytes", !JSON.stringify([await Photo.ownPhotoState(host.id), await Photo.photosForAdmin([host.id]), [...(await Photo.photosOf([host.id]))]]).includes("bytes"));
    const route = readFileSync("src/app/host-photos/[id]/route.ts", "utf8");
    const hostPage = readFileSync("src/app/h/[handle]/page.tsx", "utf8");
    check("the photo's address counts a founder only with the second login step, as the diary's does, and asks photoFor and nothing else", route.includes("admin = Boolean(row) && (await isAdminSession(await getSignedIn()));") && route.includes("const found = await photoFor(user ? { id: user.id, admin } : null, id);") && !route.includes("hostPhotos"));
    check("the host's page hands a member's view of a hidden page no photo", hostPage.includes("return forMember ? { ...forMember, socials: [], photoId: null, openToAll: false } : null;"));

    // Through the running app, as a browser would.
    const shownHost = await newHost();
    await press(shownHost);
    const shown = await photoOf(shownHost);
    const up = await get("/login").catch(() => null);
    if (!up || up.status !== 200) {
      check("the app is running, so the pages can be looked at (start it with `npm run dev`)", false);
      return;
    }
    const file = await get(`/host-photos/${shown.id}`);
    check("the photo's address, not logged in: the JPEG itself, told to be nothing else, kept by the browser for five minutes at most", file.status === 200 && file.headers.get("content-type") === "image/jpeg" && file.headers.get("x-content-type-options") === "nosniff" && file.headers.get("content-security-policy") === "default-src 'none'; sandbox" && file.headers.get("cache-control") === "private, max-age=300" && file.bytes !== null && fingerprint(file.bytes) === shown.sha256, { status: file.status, type: file.headers.get("content-type"), cache: file.headers.get("cache-control") });
    const page = await get(`/h/${shownHost.handle}`);
    check("the host's page shows the photo in place of the letter", page.status === 200 && page.text.includes(`/host-photos/${shown.id}`) && !page.text.includes("data-host-letter"), page.status);
    const results = await get(`/search?q=${shownHost.handle}`);
    check("the \"Find a host\" results show the photo beside the host", results.status === 200 && results.text.includes(`/host-photos/${shown.id}`), results.status);
    const letter = await newHost();
    const plain = await get(`/h/${letter.handle}`);
    const plainResults = await get(`/search?q=${letter.handle}`);
    check("a host without a photo keeps the letter, on the page and in the results", plain.text.includes("data-host-letter") && !plain.text.includes("/host-photos/") && plainResults.text.includes("data-host-letter") && !plainResults.text.includes("/host-photos/"));
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, shownHost.id));
    const gone = await get(`/host-photos/${shown.id}`);
    check("hidden: the same address now says \"not found\", and that answer is kept by nobody", gone.status === 404 && gone.headers.get("cache-control") === "no-store", gone.status);
    const nothing = await get("/host-photos/00000000-0000-4000-8000-000000000000");
    check("an address that belongs to nothing gives the very same answer", nothing.status === 404 && nothing.text === gone.text && nothing.headers.get("cache-control") === "no-store");
  });

  // ========================================================================
  journey("The founder: Remove, Remove and report, and closing an account", async () => {
    await fresh();
    const admin = await theAdmin();
    const founder = { id: admin.id, admin: true };
    const actions = async (host: Host) => (await db.select().from(schema.adminActions).where(and(eq(schema.adminActions.adminId, admin.id), eq(schema.adminActions.targetUserId, host.id))).orderBy(schema.adminActions.createdAt)).map((row) => row.action);
    const host = await newHost({ spare: true });
    await press(host);
    const first = await photoOf(host);
    check("the founder's page lists the photo with where it came from", (await Photo.photosForAdmin([host.id])).some((row) => row.id === first.id && row.sourceNameKey === host.igName && row.lockedAt === null));
    await Photo.removePhotoAsFounder({ adminId: admin.id, photoId: first.id, now: now() });
    check("\"Remove\": the photo is deleted, it is written into the record of the founder's actions, and the host can choose one again", !(await photoOf(host)) && (await actions(host)).join() === "host photo removed" && (await press(host, { picture: await picture() })) === "shown");
    check("removing a photo that is no longer there is refused in words", Boolean((await refusal(Photo.removePhotoAsFounder({ adminId: admin.id, photoId: first.id, now: now() })))?.includes("no longer there")) && Boolean((await refusal(Photo.removePhotoAsFounder({ adminId: admin.id, photoId: "nonsense", now: now() })))?.includes("no longer there")));

    // Remove and report.
    const second = await photoOf(host);
    const kept = fingerprint((await bytesOf(second.id))!);
    await Photo.lockPhotoAsFounder({ adminId: admin.id, photoId: second.id, now: now() });
    const [locked] = await lockedOf(host);
    check("\"Remove and report\": the photo is locked by the founder, kept byte for byte, and handed to nobody, the founder included", locked?.id === second.id && locked.lockedBy === admin.id && fingerprint((await bytesOf(second.id))!) === kept && !(await sees(null, second.id)) && !(await sees({ id: host.id, admin: false }, second.id)) && !(await sees(founder, second.id)));
    const inSearch = (await searchHosts(host.handle, null, new Date())).find((found) => found.handle === host.handle);
    const gone = first.id;
    const ordinaryNow = await newHost();
    await press(ordinaryNow);
    const stillTheirs = (await photoOf(ordinaryNow)).id;
    const states = await Photo.photoStates([second.id, gone, stillTheirs, "-".repeat(36)]);
    check("for the founder's page of reports: a photo that is still its host's, one that was removed and reported (and is kept), and one that is gone are told apart", states.get(stillTheirs) === "current" && states.get(second.id) === "locked" && !states.has(gone) && states.size === 2, [...states]);
    check("the host is still found by the search, without a photo", inSearch !== undefined && inSearch.photoId === null, inSearch);
    check("it is in none of the lists a page draws from, and the Hosting page's facts say it was removed", !(await Photo.photosOf([host.id])).has(host.id) && (await Photo.ownPhotoState(host.id)).photo === null && (await Photo.ownPhotoState(host.id)).locked === true && !(await searchHosts(host.handle, null, new Date())).find((found) => found.handle === host.handle)?.photoId);
    const contextBefore = (await db.select({ context: photos.lockedContext }).from(photos).where(eq(photos.id, second.id)))[0].context ?? "";
    await profiles.updateHostProfile(host.id, { displayName: "Someone Else Now", about: "Changed afterwards.", pricePer15Cents: 1000 });
    const contextAfter = (await db.select({ context: photos.lockedContext }).from(photos).where(eq(photos.id, second.id)))[0].context ?? "";
    check("what belonged to it is kept with it: the host's page and confirmed accounts as they were, also after the host changes them", contextBefore.includes(`Photo host ${RUN}`) && contextBefore.includes(host.handle) && contextBefore.includes(host.igName) && contextAfter === contextBefore && !contextAfter.includes("Someone Else Now"), contextBefore.slice(0, 200));
    forget();
    const blocked = await press(host, { picture: await picture() });
    check("the host can take no other photo: refused at the start, nothing asked", blocked === "locked" && metaAsked.length === 0, blocked);
    check("locking or removing it a second time is refused", Boolean((await refusal(Photo.lockPhotoAsFounder({ adminId: admin.id, photoId: second.id, now: now() })))?.includes("already removed and reported")) && Boolean((await refusal(Photo.removePhotoAsFounder({ adminId: admin.id, photoId: second.id, now: now() })))?.includes("already removed and reported")));
    // Nothing deletes it.
    check("the host's own \"Remove\" does not touch it", (await Photo.removePhoto({ userId: host.id, now: now() })) === false && (await lockedOf(host)).length === 1);
    await profiles.removeSocialName(host.id, (await entryOf(host)).id);
    check("removing the account it came from does not delete it", (await lockedOf(host)).length === 1 && fingerprint((await bytesOf(second.id))!) === kept);
    // The report.
    check("a report cannot be dated in time to come, or without a time", Boolean((await refusal(Photo.recordPhotoReportMade({ adminId: admin.id, photoId: second.id, madeAt: new Date(clock + 60 * MIN), now: now() })))?.includes("not come yet")) && Boolean((await refusal(Photo.recordPhotoReportMade({ adminId: admin.id, photoId: second.id, madeAt: new Date(Number.NaN), now: now() })))?.includes("give the day and time")));
    const madeAt = new Date(clock - 5 * MIN);
    await Photo.recordPhotoReportMade({ adminId: admin.id, photoId: second.id, madeAt, now: now() });
    check("\"I have made the report\" writes the time down, and all three steps are in the record of the founder's actions", (await lockedOf(host))[0].reportMadeAt?.getTime() === madeAt.getTime() && (await actions(host)).join() === "host photo removed,host photo removed and reported,report of a host photo recorded", await actions(host));
    const ordinary = await newHost();
    await press(ordinary);
    check("only a locked photo has a report", Boolean((await refusal(Photo.recordPhotoReportMade({ adminId: admin.id, photoId: (await photoOf(ordinary)).id, madeAt, now: now() })))?.includes("Only a photo that was removed and reported")));

    // Closing an account.
    await closing.closeAccount({ userId: host.id, by: admin.id });
    check("closing the account does not delete a locked photo", (await lockedOf(host)).length === 1 && fingerprint((await bytesOf(second.id))!) === kept);
    const ordinaryId = (await photoOf(ordinary)).id;
    await closing.closeAccount({ userId: ordinary.id, by: admin.id });
    check("closing an account deletes its ordinary photo", (await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, ordinary.id))).length === 0 && !(await sees(founder, ordinaryId)));
    await closing.reopenAccount(ordinary.id);
    check("opening the account again does not bring the photo back", (await db.select({ id: photos.id }).from(photos).where(eq(photos.userId, ordinary.id))).length === 0);
  });

  // ========================================================================
  journey("A photo from TikTok: the try is carried through TikTok's sign-in", async () => {
    await fresh();
    const admin = await theAdmin();
    // TikTok's side and the settings are pretended here. Nothing is asked of TikTok.
    const ON: TikTokSettings = { clientKey: "pretend-key", clientSecret: "pretend-secret", returnUrl: "https://connect.example/api/social/tiktok/return", signingSecret: "pretend-note-secret" };
    const BOTH = "user.info.basic,user.info.profile";
    const TT_GOOD = "https://p16-sign-va.tiktokcdn.com/tos-avt/photo.jpeg?x-expires=1";
    type TikHost = Host & { ttName: string; ttNumber: string };
    /** A host with a confirmed TikTok account: proven by signing in (the entry carries TikTok's number) or without a number. */
    const tikHost = async (opts: { numbered?: boolean; instagram?: boolean; spare?: boolean } = {}): Promise<TikHost> => {
      const host = await newHost({ instagram: opts.instagram ?? false, spare: opts.spare });
      const tik = { ...host, ttName: `hptt${made}${TAG}`, ttNumber: `tt-${number(made)}` };
      await confirm(host.id, "tiktok", tik.ttName, opts.numbered === false ? null : tik.ttNumber);
      return tik;
    };
    let tikAsked = 0;
    type Started = Extract<Awaited<ReturnType<typeof Tik.startTikTokPhoto>>, { url: string }>;
    const tikPress = (host: TikHost) => Tik.startTikTokPhoto({ userId: host.id, now: now(), settings: ON }, { services: standIns(), clock: now, diaryHosts: people });
    /** A press that must start. */
    const pressed = async (host: TikHost): Promise<Started> => {
      const started = await tikPress(host);
      if ("refused" in started) throw new Error(`The press was refused: ${started.refused}`);
      return started;
    };
    type Back = Parameters<typeof Tik.finishTikTokPhoto>[0];
    type Over = { account?: TikTokAccount | (() => TikTokAccount | Promise<TikTokAccount>); picture?: Buffer | null; change?: (request: Back) => void; meanwhile?: PhotoOptions["meanwhile"] };
    /** The host comes back from TikTok, as the return address would run it. `change` alters what comes back. */
    const tikReturn = (host: TikHost, started: Started, over: Over = {}) => {
      const request: Back = {
        settings: ON,
        code: "one-time-code",
        state: new URL(started.url).searchParams.get("state"),
        scopes: BOTH,
        refused: false,
        note: started.note,
        userId: host.id,
        now: now(),
        accountFor: async () => {
          tikAsked++;
          const account = over.account ?? { kind: "account", openId: host.ttNumber, username: host.ttName, pictureAddress: TT_GOOD };
          return typeof account === "function" ? account() : account;
        },
        photo: {
          fetch: async () => {
            fetched++;
            return over.picture === undefined ? host.picture : over.picture;
          },
          services: standIns(),
          clock: now,
          diaryHosts: people,
          meanwhile: over.meanwhile,
        },
      };
      over.change?.(request);
      return Tik.finishTikTokPhoto(request);
    };
    const tryOf = async (started: Started) => {
      const tryId = started.note.split(".")[3];
      return (await db.select().from(tries).where(eq(tries.id, tryId)))[0];
    };
    /** Everything about an entry that a proof touches, as one text, to see that nothing changed. */
    const proofOf = async (host: { id: string }, network = "tiktok") => {
      const e = await entryOf(host, network);
      return e ? JSON.stringify([e.id, e.nameKey, e.nameTyped, e.url, e.code, e.codeExpiresAt, e.claimedAt, e.confirmedAt, e.confirmedBy, e.providerAccountId]) : "none";
    };
    const SAVED = "Your photo passed the check and is saved.";
    const USED = "This sign-in was already used";

    // The press.
    const none = await newHost({ instagram: false });
    const noEntry = await tikPress({ ...none, ttName: "x", ttNumber: "x" });
    check("a host without a confirmed TikTok account is told so at the press, before being sent anywhere, and no try is written", "refused" in noEntry && noEntry.refused === "no_account" && (await triesOf(none)).length === 0, noEntry);
    const host = await tikHost();
    const before = await proofOf(host);
    forget();
    tikAsked = 0;
    const started = await pressed(host);
    const sentTo = new URL(started.url);
    const line = await tryOf(started);
    check("the press writes the try down (a TikTok try, still running, not yet taken up, with the entry it started from) and sends the host to TikTok's sign-in, asking for no more than \"Connect your TikTok\" does", line?.network === "tiktok" && line.result === null && line.returnedAt === null && line.entryNameKey === host.ttName && line.entryAccountId === host.ttNumber && sentTo.origin + sentTo.pathname === "https://www.tiktok.com/v2/auth/authorize/" && sentTo.searchParams.get("scope") === BOTH && sentTo.searchParams.get("redirect_uri") === ON.returnUrl, started.url);
    check("the note the browser keeps is a photo's note and never an ordinary sign-in's; an ordinary note is not a photo's", Tik.isPhotoReturn(started.note, ON, now()) && readNote("tiktok-login", started.note, ON.signingSecret, now()) === null && !Tik.isPhotoReturn(writeNote("tiktok-login", { state: "s", userId: host.id, expiresAt: new Date(clock + 600_000) }, ON.signingSecret), ON, now()) && !Tik.isPhotoReturn(started.note, null, now()));

    // The return.
    const back = await tikReturn(host, started);
    const photo = await photoOf(host);
    const done = await tryOf(started);
    check("the return: TikTok is asked once, the picture fetched once, the first service asked once, and the photo is the host's, from TikTok, with TikTok's number and the entry's name", back.startsWith(SAVED) && tikAsked === 1 && fetched === 1 && asked.join() === "openai" && photo?.network === "tiktok" && photo.sourceNameKey === host.ttName && photo.sourceAccountId === host.ttNumber && done.result === "shown" && done.returnedAt !== null, { back, tikAsked, fetched, asked });
    check("the host's TikTok entry is exactly as it was: a sign-in for the photo writes nothing to it", (await proofOf(host)) === before);
    check("the photo's facts for the Hosting page and the search say where it came from", (await Photo.ownPhotoState(host.id)).photo?.network === "tiktok" && (await searchHosts(host.handle, null, new Date())).find((found) => found.handle === host.handle)?.photoId === photo.id);

    // The same return a second time, and two at the same moment.
    tikAsked = 0;
    const again = await tikReturn(host, started);
    check("the same return a second time: nothing is asked of TikTok, nothing changes, and the host is told the sign-in was already used", again.startsWith(USED) && tikAsked === 0 && (await photoOf(host))?.id === photo.id, again);
    /**
     * The same return twice, really at the same time: the first is held while it asks TikTok (so it has taken the try
     * up and is in the middle of its work), the second comes in, and only then is the first let go.
     */
    const overlapping = async (started: Started, account: TikTokAccount, newPicture: Buffer) => {
      let reached: () => void = () => undefined;
      const atTikTok = new Promise<void>((resolve) => (reached = resolve));
      let letGo: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (letGo = resolve));
      tikAsked = 0;
      const winner = tikReturn(host, started, {
        picture: newPicture,
        account: async () => {
          reached();
          await held;
          return account;
        },
      });
      let loser = "";
      let during: Awaited<ReturnType<typeof tryOf>> | undefined;
      try {
        await atTikTok;
        loser = await tikReturn(host, started, { picture: newPicture, account });
        during = await tryOf(started);
      } finally {
        letGo();
      }
      return { winner: await winner, loser, during, asked: tikAsked, after: await tryOf(started) };
    };
    later(3);
    const doubled = await overlapping(await pressed(host), { kind: "account", openId: host.ttNumber, username: host.ttName, pictureAddress: TT_GOOD }, await picture());
    check("the same return twice at the same moment: the one that took the try up does the work; the other does nothing, asks TikTok nothing, and leaves the try running for the first", doubled.loser.startsWith(USED) && doubled.during?.result === null && doubled.during.returnedAt !== null && doubled.winner.startsWith(SAVED) && doubled.asked === 1 && doubled.after.result === "shown", doubled);
    later(3);
    const lost = await overlapping(await pressed(host), { kind: "failed", reason: "the code was not accepted" }, await picture());
    check("and when TikTok will not take the code: still only one of the two asks, the other ends nothing, and the try is ended once, by its owner", lost.loser.startsWith(USED) && lost.during?.result === null && lost.asked === 1 && lost.winner.includes("could not fetch") && lost.after.result === "not_fetched", lost);

    // Taking a try up: only its own host, only a TikTok try, only once.
    const claimant = await tikHost({ instagram: true });
    const mine = await pressed(claimant);
    const mineId = mine.note.split(".")[3];
    check("a try cannot be taken up by another host, or with an id that is not one", !(await Photo.takeUpTry({ userId: host.id, tryId: mineId }, now())) && !(await Photo.takeUpTry({ userId: claimant.id, tryId: "-".repeat(36) }, now())) && (await tryOf(mine)).returnedAt === null);
    check("it is taken up once by its own host, and not a second time", (await Photo.takeUpTry({ userId: claimant.id, tryId: mineId }, now())) && !(await Photo.takeUpTry({ userId: claimant.id, tryId: mineId }, now())));
    // That return's server now stops: the try is taken up and never gets a result.
    later(1);
    const tooSoon = await tikPress(claimant);
    later(2);
    const afterwards = await tikPress(claimant);
    check("a try that was taken up and then left (its server stopped) blocks the host for two minutes from the press, no longer", "refused" in tooSoon && tooSoon.refused === "running" && !("refused" in afterwards) && (await tryOf(mine)).result === "stopped", tooSoon);
    const [instagramTry] = await db.insert(tries).values({ userId: claimant.id, network: "instagram", startedAt: now(), entryNameKey: claimant.igName, entryAccountId: null }).returning();
    check("an Instagram try can never be taken up as a TikTok return", !(await Photo.takeUpTry({ userId: claimant.id, tryId: instagramTry.id }, now())));
    await db.delete(tries).where(eq(tries.id, instagramTry.id));
    check("after all of it the entry is still exactly as it was", (await proofOf(host)) === before);

    // Which account signed in.
    const strict = await tikHost();
    const strictBefore = await proofOf(strict);
    const strictPress = await pressed(strict);
    forget();
    const otherNumber = await tikReturn(strict, strictPress, { account: { kind: "account", openId: "tt-someone-else", username: strict.ttName, pictureAddress: TT_GOOD } });
    check("an entry proven by signing in: another account, even under the same name, gives no photo, changes nothing, and the host is told why", otherNumber.includes("different account") && otherNumber.includes("Connect your TikTok") && !(await photoOf(strict)) && (await proofOf(strict)) === strictBefore && fetched === 0, otherNumber);
    check("that try was ended there and then (as \"no picture\"), so the host can press again at once", (await tryOf(strictPress)).result === "no_picture");
    // (No waiting here: the press right after a refusal must go through.)
    const renamed = await tikReturn(strict, await pressed(strict), { account: { kind: "account", openId: strict.ttNumber, username: "Another.Name", pictureAddress: TT_GOOD } });
    check("the same number under another name is the same account: the photo is taken, and the entry's name is not touched", renamed.startsWith(SAVED) && (await photoOf(strict))?.sourceAccountId === strict.ttNumber && (await proofOf(strict)) === strictBefore, renamed);

    const byName = await tikHost({ numbered: false, spare: true });
    const byNameBefore = await proofOf(byName);
    const wrongName = await tikReturn(byName, await pressed(byName), { account: { kind: "account", openId: byName.ttNumber, username: "someone.else", pictureAddress: TT_GOOD } });
    check("an entry confirmed without a number: an account of another name gives no photo", wrongName.includes("different account") && !(await photoOf(byName)) && (await proofOf(byName)) === byNameBefore, wrongName);
    later(3);
    const rightName = await tikReturn(byName, await pressed(byName), { account: { kind: "account", openId: byName.ttNumber, username: byName.ttName.toUpperCase(), pictureAddress: TT_GOOD } });
    const byNamePhoto = await photoOf(byName);
    check("the account of that name (in whatever capitals) gives the photo; the photo remembers TikTok's number, and the entry still has none", rightName.startsWith(SAVED) && byNamePhoto?.sourceAccountId === byName.ttNumber && (await proofOf(byName)) === byNameBefore && (await entryOf(byName, "tiktok")).providerAccountId === null, rightName);
    await profiles.confirmSocialByLogin({ userId: byName.id, network: "tiktok", accountId: byName.ttNumber, username: byName.ttName, now: now() });
    check("when that entry later gains the same number through \"Connect your TikTok\", the photo stays", (await photoOf(byName))?.id === byNamePhoto.id && (await entryOf(byName, "tiktok")).providerAccountId === byName.ttNumber);
    await profiles.confirmSocialByLogin({ userId: byName.id, network: "tiktok", accountId: "tt-quite-another", username: byName.ttName, now: now() });
    check("and when a sign-in brings another number under that name, the photo goes", !(await photoOf(byName)));

    const owner = await tikHost();
    const borrower = await tikHost({ numbered: false });
    const taken = await tikReturn(borrower, await pressed(borrower), { account: { kind: "account", openId: owner.ttNumber, username: borrower.ttName, pictureAddress: TT_GOOD } });
    check("an account whose number is confirmed for another host gives no photo, whatever its name is now", taken.includes("confirmed for another host") && !(await photoOf(borrower)), taken);
    // The other host confirms that account only while the picture is with the checking service.
    const lateOwner = await tikHost({ numbered: false, spare: true });
    const lateBorrower = await tikHost({ numbered: false });
    const sharedNumber = `tt-shared-${number(made)}`;
    const duringCheck = await tikReturn(lateBorrower, await pressed(lateBorrower), {
      account: { kind: "account", openId: sharedNumber, username: lateBorrower.ttName, pictureAddress: TT_GOOD },
      meanwhile: async (at) => void (at === "checked" && (await profiles.confirmSocialByLogin({ userId: lateOwner.id, network: "tiktok", accountId: sharedNumber, username: lateOwner.ttName, now: now() }))),
    });
    check("another host confirms that very account while the picture is being checked: the photo is not written", duringCheck.includes("confirmed for another host") && !(await photoOf(lateBorrower)) && (await entryOf(lateOwner, "tiktok")).providerAccountId === sharedNumber, duringCheck);

    // What TikTok can send back.
    const plain = await tikHost();
    const without = await pressed(plain);
    const noPicture = await tikReturn(plain, without, { account: { kind: "account", openId: plain.ttNumber, username: plain.ttName } });
    check("TikTok sends no picture: the host is told so, the try says so, and nothing is kept", noPicture.includes("did not give us a profile picture") && !(await photoOf(plain)) && (await tryOf(without)).result === "no_picture", noPicture);
    later(3);
    forget();
    const elsewhere = await tikReturn(plain, await pressed(plain), { account: { kind: "account", openId: plain.ttNumber, username: plain.ttName, pictureAddress: "https://p16.tiktokcdn.com.example.com/a.jpeg" } });
    check("a picture address on a server that is not TikTok's: not fetched, nothing kept", elsewhere.includes("could not fetch") && fetched === 0 && !(await photoOf(plain)), elsewhere);
    later(3);
    const cancelled = await pressed(plain);
    tikAsked = 0;
    const gaveUp = await tikReturn(plain, cancelled, { change: (r) => ((r.refused = true), (r.code = null)) });
    check("the host cancels at TikTok: nothing is asked of TikTok, the try is ended there and then, and the host can press again at once", gaveUp.includes("did not finish at TikTok") && tikAsked === 0 && (await tryOf(cancelled)).result === "stopped" && !("refused" in (await tikPress(plain))), gaveUp);
    // (Another host from here on: five tries in 24 hours are the limit for each.)
    const plain2 = await tikHost();
    const noScopes = await pressed(plain2);
    tikAsked = 0;
    const partly = await tikReturn(plain2, noScopes, { change: (r) => (r.scopes = "user.info.basic") });
    check("a permission was switched off at TikTok: nothing is asked, and the try is ended", partly.includes("leave both switches on") && tikAsked === 0 && (await tryOf(noScopes)).result === "stopped", partly);
    later(3);
    const refusedBefore = (await profiles.refusedBioChecks(now())).find((row) => row.network === "tiktok")?.count ?? 0;
    const ours = await pressed(plain2);
    const refusedKeys = await tikReturn(plain2, ours, { account: { kind: "refused", reason: "invalid_client" } });
    check("TikTok refuses our own keys: the host is told to try later, it shows up for the founder's page, and the try is ended", refusedKeys.includes("could not fetch") && ((await profiles.refusedBioChecks(now())).find((row) => row.network === "tiktok")?.count ?? 0) === refusedBefore + 1 && (await tryOf(ours)).result === "not_fetched", refusedKeys);

    // A return that is not this try's own touches no try.
    const careful = await tikHost();
    const stranger = await tikHost();
    const open = await pressed(careful);
    tikAsked = 0;
    const wrong: Array<[string, (r: Back) => void]> = [
      ["no note", (r) => (r.note = undefined)],
      ["a note that was changed", (r) => (r.note = `${r.note}x`)],
      ["a note with the try's id cut out", (r) => (r.note = (r.note ?? "").split(".").filter((_, index) => index !== 3).join("."))],
      ["a value that does not match (another tab's return)", (r) => (r.state = "another-value")],
      ["no value", (r) => (r.state = null)],
      ["started as one person, returned as another", (r) => (r.userId = stranger.id)],
      ["an ordinary sign-in's note for the same person and value", (r) => (r.note = writeNote("tiktok-login", { state: r.state ?? "", userId: r.userId, expiresAt: new Date(clock + 600_000) }, ON.signingSecret))],
      ["the settings are gone", (r) => (r.settings = null)],
    ];
    const slipped: string[] = [];
    for (const [label, change] of wrong) {
      const said = await tikReturn(careful, open, { change });
      const now_ = await tryOf(open);
      if (said.startsWith(SAVED) || tikAsked !== 0 || now_.result !== null || now_.returnedAt !== null || (await photoOf(careful)) || (await photoOf(stranger))) slipped.push(label);
    }
    check(`a return that does not fit (${wrong.length} cases) is stopped before anything is asked of TikTok, and the try is not touched: it is still running and not taken up`, slipped.length === 0, slipped.join("; "));
    check("and that try's own return still goes through afterwards", (await tikReturn(careful, open)).startsWith(SAVED));

    // Two tabs: an ordinary sign-in and a photo's, sharing the one cookie.
    const tabs = await tikHost();
    const tabsBefore = await proofOf(tabs);
    const ordinary = TikLogin.startTikTokLogin({ userId: tabs.id, now: now(), settings: ON });
    const photoTab = await pressed(tabs);
    // The ordinary tab returns: the browser now holds the photo's note, the address carries the ordinary value.
    const ordinaryBack = await tikReturn(tabs, photoTab, { change: (r) => (r.state = new URL(ordinary.url).searchParams.get("state")) });
    check("an ordinary sign-in was started first, then a photo's: the ordinary tab's return is not accepted and does not stop the photo's try", !ordinaryBack.startsWith(SAVED) && (await tryOf(photoTab)).result === null && (await tryOf(photoTab)).returnedAt === null && (await proofOf(tabs)) === tabsBefore, ordinaryBack);
    later(3);
    const photoFirst = await pressed(tabs);
    const ordinaryLater = TikLogin.startTikTokLogin({ userId: tabs.id, now: now(), settings: ON });
    // The photo's tab returns: the browser now holds the ordinary note, the address carries the photo's value.
    const photoState = new URL(photoFirst.url).searchParams.get("state");
    const asOrdinary = await TikLogin.finishTikTokLogin({ settings: ON, code: "one-time-code", state: photoState, scopes: BOTH, refused: false, note: ordinaryLater.note, userId: tabs.id, now: now(), accountFor: async () => ({ kind: "account", openId: "tt-changed", username: "changed.name" }) });
    check("the other way round: the photo tab's return, read as the ordinary kind the browser's note says it is, confirms nothing and leaves the photo's try alone", !Tik.isPhotoReturn(ordinaryLater.note, ON, now()) && asOrdinary.includes("was not connected") && (await proofOf(tabs)) === tabsBefore && (await tryOf(photoFirst)).result === null, asOrdinary);

    // Time: two minutes, three, eleven, never.
    const slow = await tikHost();
    const first = await pressed(slow);
    const second = await tikPress(slow);
    check("a second press within two minutes is told that one is under way", "refused" in second && second.refused === "running");
    later(3);
    const afterThree = await tikReturn(slow, first);
    check("coming back after three minutes, with no other press in between, is fine", afterThree.startsWith(SAVED), afterThree);
    later(3);
    const old = await pressed(slow);
    later(3);
    const newer = await pressed(slow);
    const oldBack = await tikReturn(slow, old, { picture: await picture() });
    check("a press after two minutes stops the older try; the older try's return does nothing, and does not stop the newer one", (await tryOf(old)).result === "stopped" && oldBack.startsWith(USED) && (await tryOf(newer)).result === null && (await tryOf(newer)).returnedAt === null, oldBack);
    later(11);
    tikAsked = 0;
    const tooLate = await tikReturn(slow, newer);
    check("coming back after eleven minutes: the note has run out, nothing is asked of TikTok, and the try is left as it is", !tooLate.startsWith(SAVED) && tikAsked === 0 && (await tryOf(newer)).result === null, tooLate);
    check("a try that never comes back does not lock the host out: the next press marks it as stopped and starts afresh", !("refused" in (await tikPress(slow))) && (await tryOf(newer)).result === "stopped");

    // While the host is away at TikTok.
    const away = async (change: (host: TikHost) => Promise<unknown>, opts: Parameters<typeof tikHost>[0] = { spare: true }) => {
      const host = await tikHost(opts);
      await tikReturn(host, await pressed(host));
      const had = await photoOf(host);
      later(3);
      const press = await pressed(host);
      await change(host);
      tikAsked = 0;
      const said = await tikReturn(host, press, { picture: await picture() });
      return { host, had, said, after: await photoOf(host), line: await tryOf(press), asked: tikAsked };
    };
    const removedPhoto = await away((host) => Photo.removePhoto({ userId: host.id, now: now() }));
    check("the host presses \"Remove\" while away at TikTok: what comes back writes nothing, and TikTok is not even asked", removedPhoto.said.startsWith(USED) && !removedPhoto.after && removedPhoto.asked === 0 && removedPhoto.line.result === "stopped", removedPhoto.said);
    const removedAccount = await away(async (host) => profiles.removeSocialName(host.id, (await entryOf(host, "tiktok")).id));
    check("the TikTok account is removed from the page while away: the photo goes with it, and what comes back writes none", removedAccount.said.startsWith(USED) && !removedAccount.after && removedAccount.asked === 0, removedAccount.said);
    const replaced = await away((host) => profiles.confirmSocialByLogin({ userId: host.id, network: "tiktok", accountId: `tt-new-${made}`, username: `new.${made}.${TAG}`, now: now() }));
    check("\"Connect your TikTok\" brings another account while away: the old account's picture is not written", replaced.said.startsWith(USED) && !replaced.after, replaced.said);
    const lockedAway = await away(async (host) => Photo.lockPhotoAsFounder({ adminId: admin.id, photoId: (await photoOf(host)).id, now: now() }));
    check("the founder removes and reports the photo while away: no new photo is written", lockedAway.said.startsWith(USED) && !lockedAway.after && (await lockedOf(lockedAway.host)).length === 1, lockedAway.said);
    const closedAway = await away((host) => closing.closeAccount({ userId: host.id, by: admin.id }));
    check("the account is closed while away: its photo is deleted, and what comes back writes none", closedAway.said.startsWith(USED) && !closedAway.after && closedAway.asked === 0, closedAway.said);
    const pausedAway = await away((host) => db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, host.id)));
    check("the account is paused while away: the return ends the try without asking TikTok, and the photo the host had stays", pausedAway.said.includes("cannot do this") && pausedAway.asked === 0 && pausedAway.after?.id === pausedAway.had.id && pausedAway.line.result === "stopped", pausedAway.said);

    // Instagram and TikTok on one page: one photo at a time.
    const two = await tikHost({ instagram: true });
    check("(a photo from Instagram first)", (await press(two)) === "shown" && (await photoOf(two))?.network === "instagram");
    const fromInstagram = await photoOf(two);
    later(3);
    says.openai = "flagged";
    const flagged = await tikReturn(two, await pressed(two), { picture: await picture() });
    says.openai = "clean";
    check("a TikTok picture that a service refuses does not replace the Instagram photo", flagged.includes("was not accepted") && (await photoOf(two))?.id === fromInstagram.id, flagged);
    later(3);
    const tikPicture = await picture();
    const replacedIt = await tikReturn(two, await pressed(two), { picture: tikPicture });
    check("a TikTok picture that passes replaces it: one photo at a time, the last one chosen", replacedIt.startsWith(SAVED) && (await photoOf(two))?.network === "tiktok" && !(await sees(null, fromInstagram.id)), replacedIt);
    later(3);
    const tikTry = await pressed(two);
    later(3);
    const instagramTook = await press(two, { picture: await picture() });
    const tikLate = await tikReturn(two, tikTry, { picture: await picture() });
    check("an Instagram press, more than two minutes after a TikTok press that never came back, takes its place; the TikTok return that comes afterwards does nothing", instagramTook === "shown" && (await tryOf(tikTry)).result === "stopped" && tikLate.startsWith(USED) && (await photoOf(two))?.network === "instagram", { instagramTook, tikLate });
    // A refused TikTok picture stays refused.
    const strictAgain = await tikHost();
    const bad = await picture();
    says.openai = "flagged";
    await tikReturn(strictAgain, await pressed(strictAgain), { picture: bad });
    says.openai = "clean";
    later(3);
    forget();
    const sameBad = await tikReturn(strictAgain, await pressed(strictAgain), { picture: bad });
    check("a TikTok picture a service refused is refused at once the next time, without asking a service", sameBad.includes("not accepted before") && asked.length === 0 && !(await photoOf(strictAgain)), sameBad);
    // Something of ours breaks in the middle of a return.
    later(3);
    const breaking = await pressed(strictAgain);
    const broke = await tikReturn(strictAgain, breaking, {
      account: () => {
        throw new Error("boom");
      },
    });
    check("the request to TikTok breaks: the host is told nothing was changed, and the try is ended", broke.includes("could not fetch") && (await tryOf(breaking)).result === "not_fetched", broke);
    // Something of our own breaks after the return has taken the try up, outside every other catch.
    later(3);
    const stranded = await pressed(strictAgain);
    const brokeAfterClaim = await tikReturn(strictAgain, stranded, {
      change: (r) =>
        (r.accountFor = () => {
          throw new Error("something of our own broke");
        }),
    });
    const strandedLine = await tryOf(stranded);
    check("something of ours breaks after the try was taken up: the host is told so, and the try is ended, not left taken up and running", brokeAfterClaim.includes("went wrong on our side") && strandedLine.result === "stopped" && strandedLine.returnedAt !== null && !("refused" in (await tikPress(strictAgain))), { brokeAfterClaim, result: strandedLine.result });
  });

  // ========================================================================
  journey("The checking services, shared with the diary's queue", async () => {
    await fresh();
    const admin = await theAdmin();
    const round = () => runPictureRound({ now, services: standIns(), own: null, tool: null, onlyHosts: people });
    // A photo's answer counts for the service itself.
    const host = await newHost();
    await press(host);
    const good = await checkerLine("openai");
    check("a clean answer to a photo is remembered for the service, with the key that gave it", good?.lastGoodKey === "key-1" && good.lastGoodAt?.getTime() === clock && good.outUntil === null);
    // A photo finds a service out: the queue does not ask it either, for five minutes.
    says.openai = "out";
    await press(host, { picture: await picture() });
    const out = await checkerLine("openai");
    check("a photo finds the first service out: its five minutes start, and the second service answers", out?.outUntil?.getTime() === clock + 5 * MIN && tried?.checkedBy === "azure");
    const diarist = await newHost();
    later(1);
    const waiting = await waitingDiaryPicture(diarist, "waiting");
    forget();
    says.openai = "clean";
    await round();
    check("the diary's queue, a minute later, does not ask the service a photo found out; it asks the next one", asked.join() === "azure" && (await db.select().from(pictures).where(eq(pictures.id, waiting.id)))[0].state === "shown", asked);
    // The other way round: the queue finds a service out, and its five minutes hold for a photo.
    await db.delete(schema.pictureCheckers);
    later(60);
    const queued = await waitingDiaryPicture(diarist, "queued");
    says.openai = "out";
    forget();
    await round();
    says.openai = "clean";
    const outByQueue = await checkerLine("openai");
    check("(the queue found the first service out, and the second answered its picture)", asked.join() === "openai,azure" && outByQueue?.outUntil?.getTime() === clock + 5 * MIN && (await db.select().from(pictures).where(eq(pictures.id, queued.id)))[0].state === "shown", asked);
    forget();
    later(1);
    const during = await press(await newHost());
    check("a service in its five minutes after the queue found it out is not asked for a photo", during === "shown" && asked.join() === "azure", { during, asked });
    later(5);
    forget();
    check("and is asked again once they are over", (await press(await newHost())) === "shown" && asked.join() === "openai", asked);
    // A fault: the founder is told once, whoever met it.
    await db.delete(schema.pictureCheckers);
    says.openai = "fault";
    const before = await mails(admin.email, "A picture checking service has a fault: openai");
    await press(await newHost());
    const second = await newHost();
    await press(second);
    const again = await waitingDiaryPicture(diarist, "again");
    await round();
    check("a fault met by two photos and then by the diary's queue: the founder is emailed once, and nobody's picture is passed on", (await mails(admin.email, "A picture checking service has a fault: openai")) === before + 1 && !(await photoOf(second)) && (await db.select().from(pictures).where(eq(pictures.id, again.id)))[0].state === "waiting", { mails: (await mails(admin.email, "A picture checking service has a fault: openai")) - before });
    says.openai = "clean";
    later(2);
    check("when the service answers properly again, for a photo, its fault is over", (await press(second)) === "shown" && (await checkerLine("openai"))?.faultSince === null);
  });

  // ------------------------------------------------------------------------
  if (only && (only.length === 0 || only.some((n) => !Number.isInteger(n) || n < 1 || n > journeys.length))) throw new Error(`--only takes journey numbers from 1 to ${journeys.length}.`);
  const checkersBefore = await db.select().from(schema.pictureCheckers).orderBy(schema.pictureCheckers.service);

  /** Everything this run made, removed: the newest kind of line first, so nothing points at a line that is gone. */
  async function wipe(): Promise<void> {
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `hp-${RUN}-%`))).map((row) => row.id);
    // Emails this run caused, also the ones about a checking service written to the real admins of this test database.
    await db.delete(schema.emailOutbox).where(and(gte(schema.emailOutbox.createdAt, startedAt), or(like(schema.emailOutbox.dedupeKey, "picture-%"), like(schema.emailOutbox.dedupeKey, "pictures-nudity-only:%"), like(schema.emailOutbox.dedupeKey, "host-photo-%"), like(schema.emailOutbox.to, `photocheck-${RUN}-%`))));
    if (ids.length === 0) return;
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.adminActions).where(or(inArray(schema.adminActions.adminId, ids), inArray(schema.adminActions.targetUserId, ids)));
    await db.delete(photos).where(inArray(photos.userId, ids));
    await db.delete(tries).where(inArray(tries.userId, ids));
    await db.delete(schema.bioChecks).where(inArray(schema.bioChecks.userId, ids));
    const pictureIds = (await db.select({ id: pictures.id }).from(pictures).where(inArray(pictures.hostId, ids))).map((row) => row.id);
    if (pictureIds.length > 0) await db.delete(schema.projectPictureFiles).where(inArray(schema.projectPictureFiles.pictureId, pictureIds));
    await db.delete(pictures).where(inArray(pictures.hostId, ids));
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    if (projectIds.length > 0) await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.hostId, ids));
    await db.delete(schema.socialAccounts).where(inArray(schema.socialAccounts.userId, ids));
    await db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
    await db.update(schema.hostProfiles).set({ decidedBy: null }).where(inArray(schema.hostProfiles.decidedBy, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.admins).where(inArray(schema.admins.userId, ids));
    await db.delete(schema.session).where(inArray(schema.session.userId, ids));
    await db.delete(schema.account).where(inArray(schema.account.userId, ids));
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }

  try {
    for (const [index, [title, run]] of journeys.entries()) {
      if (only && !only.includes(index + 1)) continue;
      console.log(`\n${index + 1}. ${title}`);
      try {
        await run();
      } catch (error) {
        check("the journey ran to its end", false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
      }
    }
  } finally {
    // Each part of the putting back is tried, whatever happens to another, and what failed is said.
    const puttingBack: Array<[string, () => Promise<unknown>]> = [
      // In one step: the lines are never left deleted without the earlier ones written back.
      ["the lines about the checking services", () => db.transaction(async (tx) => {
        await tx.delete(schema.pictureCheckers);
        if (checkersBefore.length > 0) await tx.insert(schema.pictureCheckers).values(checkersBefore);
      })],
      ["what this run made", wipe],
    ];
    for (const [what, work] of puttingBack) await work().catch((error) => check(`afterwards: ${what} could be put back`, false, String(error)));
  }
  check("afterwards: the lines about the checking services are as they were", JSON.stringify(await db.select().from(schema.pictureCheckers).orderBy(schema.pictureCheckers.service)) === JSON.stringify(checkersBefore));
  check("afterwards: no photo and no email of this run is left", (await db.select({ id: photos.id }).from(photos).where(like(photos.userId, `hp-${RUN}-%`))).length === 0 && (await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(like(schema.emailOutbox.to, `photocheck-${RUN}-%`))).length === 0);
  check("afterwards: nothing this run made is left", (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `hp-${RUN}-%`))).length === 0 && (await db.select({ id: tries.id }).from(tries).where(like(tries.userId, `hp-${RUN}-%`))).length === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
