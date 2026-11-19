/**
 * Testing tool: plays hosts, a visitor and the founder through a project and its diary, against
 * the local database, and checks every result. Part one (plans/24): the project, its posts with
 * text and YouTube links, who can read what, reports of a post, the founder's page and switch
 * (1a); and pictures (1b): taking an upload in, the checking queue with stand-in checkers whose
 * answers this script controls, who gets a picture, the founder's tools, the child-safety rule
 * with a stand-in tool, Connect's own checker for real, and the two addresses through the running
 * app. No money yet. No outside checking service is ever called from here.
 *
 * The journey about the two addresses needs the app running (`npm run dev`).
 *
 * It works on this computer's test database only, makes its own people (their ids start "pc-"),
 * sets the founder's projects switch for its journeys, and at the end puts the switch, the lines
 * about the checking services and the child-safety tool's switch back as it found them, and
 * removes everything it made. It must have the test database to itself while it runs: no always-on
 * helper and no second check script beside it.
 *
 * Usage: npx tsx scripts/project-check.ts            (everything)
 *        npx tsx scripts/project-check.ts --only=4   (one journey)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createHash, randomBytes, randomUUID } from "node:crypto";
import net from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { and, desc, eq, gte, inArray, like, or } from "drizzle-orm";
import type { Checker } from "../src/lib/projects/checks/types";
import type { ChildAnswer } from "../src/lib/projects/child-safety";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${!ok && detail !== "" ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const P = await import("../src/lib/projects/projects");
  const Posts = await import("../src/lib/projects/posts");
  const { ProjectError, PROJECT, PICTURE, linksOf } = await import("../src/lib/projects/rules");
  const sharp = (await import("sharp")).default;
  const Pics = await import("../src/lib/projects/pictures");
  const Mod = await import("../src/lib/projects/moderation");
  const Steps = await import("../src/lib/projects/picture-steps");
  const Q = await import("../src/lib/projects/queue");
  const Child = await import("../src/lib/projects/child-safety");
  const { ownChecker, stopOwnChecker } = await import("../src/lib/projects/checks/own");
  const { publicProfile } = await import("../src/lib/profiles/profiles");
  const { createReport, closeReport, ReportError } = await import("../src/lib/safety/reports");
  const { projectsOnFor, setSwitches, switches } = await import("../src/lib/safety/switches");

  const RUN = randomUUID().slice(0, 8);
  const MIN = 60_000;
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",").map(Number);
  type Person = { id: string; name: string; email: string; handle?: string };
  let made = 0;
  const VIDEO = "dQw4w9WgXcQ";
  const BASE = "http://localhost:3000";
  const startedAt = new Date();
  /** Everyone this run made. The checking rounds of this script only ever touch their pictures. */
  const people: string[] = [];
  /** People made through the app's own sign-up (the journey about the two addresses): their ids do not start "pc-". */
  const signedUp: string[] = [];
  const pictures = schema.projectPictures;
  const files = schema.projectPictureFiles;

  // ------------------------------------------------------------------------
  // Making people
  // ------------------------------------------------------------------------
  async function person(kind: string): Promise<Person> {
    const id = `pc-${RUN}-${++made}-${kind}`;
    const stamp = new Date();
    const row = { id, name: `Project check ${kind} ${made}`, email: `projectcheck-${RUN}-${made}@example.test` };
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
    people.push(id);
    return row;
  }
  /** A host whose page is approved and whose payout account is marked ready, unless asked otherwise. */
  async function newHost(opts: { status?: string; payoutsReady?: boolean } = {}): Promise<Person & { handle: string }> {
    const p = await person("host");
    const handle = `pc${RUN}${made}`;
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle, handleKey: handle, displayName: `Host ${made}`, pricePer15Cents: 1000, status: opts.status ?? "approved", usConfirmedAt: new Date() });
    // (Marked as able to be paid: a payout account cannot be made ready from a script, and part 1a moves no money.)
    await db.insert(schema.hostSettings).values({ userId: p.id, payoutsReady: opts.payoutsReady ?? true }).onConflictDoNothing();
    return { ...p, handle };
  }
  /** Everything this run made, removed: the newest kind of line first, so nothing points at a line that is gone. */
  async function wipe(): Promise<void> {
    const ids = [...(await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `pc-${RUN}-%`))).map((row) => row.id), ...signedUp];
    // Emails this run caused, also the ones the checking rounds wrote to the real admins of this test database.
    await db.delete(schema.emailOutbox).where(and(gte(schema.emailOutbox.createdAt, startedAt), or(like(schema.emailOutbox.dedupeKey, "picture-%"), like(schema.emailOutbox.dedupeKey, "pictures-nudity-only:%"), like(schema.emailOutbox.to, `projectcheck-${RUN}-%`))));
    if (ids.length === 0) return;
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.adminActions).where(or(inArray(schema.adminActions.adminId, ids), inArray(schema.adminActions.targetUserId, ids)));
    const pictureIds = (await db.select({ id: pictures.id }).from(pictures).where(inArray(pictures.hostId, ids))).map((row) => row.id);
    if (pictureIds.length > 0) await db.delete(files).where(inArray(files.pictureId, pictureIds));
    await db.delete(pictures).where(inArray(pictures.hostId, ids));
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    if (projectIds.length > 0) await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.hostId, ids));
    await db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.admins).where(inArray(schema.admins.userId, ids));
    await db.delete(schema.session).where(inArray(schema.session.userId, ids));
    await db.delete(schema.account).where(inArray(schema.account.userId, ids));
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }

  /** The words a refusal came with, or null when the thing went through. Anything that is not a refusal for the person is thrown on. */
  async function refusal(work: Promise<unknown>): Promise<string | null> {
    try {
      await work;
      return null;
    } catch (error) {
      if (error instanceof ProjectError || error instanceof ReportError) return error.message;
      throw error;
    }
  }
  let clock = Date.now() - 60 * 24 * 60 * MIN;
  /** A later moment each time it is asked, so posts written in a row have an order. */
  const tick = () => new Date((clock += MIN));
  const start = (host: Person, name = "My film") => P.startProject({ hostId: host.id, name, description: "A short film about the sea.", now: tick() });
  /** An id that is well formed and belongs to nothing. */
  const NOTHING = "00000000-0000-4000-8000-000000000000";
  // As the page's forms do it: each names the project it was drawn for, here the host's running one at this moment.
  const runningId = async (host: Person) => (await P.runningProjectOf(host.id))?.id ?? NOTHING;
  const write = async (host: Person, text: string, links: string[] = []) => Posts.writePost({ hostId: host.id, projectId: await runningId(host), text, links, now: tick() });
  const change = async (host: Person, name: string, description = "") => P.changeProject({ hostId: host.id, projectId: await runningId(host), name, description, now: tick() });
  const end = async (host: Person) => P.endProject({ hostId: host.id, projectId: await runningId(host), now: tick() });

  const journeys: Array<[string, () => Promise<void>]> = [];
  const journey = (title: string, run: () => Promise<void>) => journeys.push([title, run]);

  // ========================================================================
  journey("Starting: only a host whose page is approved and whose payout account is ready, and one project at a time", async () => {
    const pending = await newHost({ status: "pending" });
    check("a host whose page waits for approval cannot start a project", /must be approved/.test((await refusal(start(pending))) ?? ""));
    const noPayouts = await newHost({ payoutsReady: false });
    check("a host whose payout account is not ready cannot start a project", /payout account must be ready/.test((await refusal(start(noPayouts))) ?? ""));
    const paused = await newHost();
    await db.update(schema.user).set({ pausedAt: new Date(), pausedReason: "check" }).where(eq(schema.user.id, paused.id));
    check("a paused host cannot start a project", /paused/.test((await refusal(start(paused))) ?? ""));
    const customer = await person("customer");
    check("someone who is not a host cannot start a project", /must be approved/.test((await refusal(start(customer))) ?? ""));
    check("nothing was written for any of them", (await db.select().from(schema.projects).where(inArray(schema.projects.hostId, [pending.id, noPayouts.id, paused.id, customer.id]))).length === 0);

    const host = await newHost();
    check("startProblem says nothing stands in the way of an approved, payable host", (await P.startProblem(host.id)) === null);
    const project = await start(host, "  My \n film  ");
    check("an approved host with a ready payout account starts a project, its name tidied to one line", project.status === "running" && project.name === "My film" && project.hostId === host.id && project.endedAt === null);
    check("it is her running project", (await P.runningProjectOf(host.id))?.id === project.id);
    check("a second project is refused while one is running", /already have a project/.test((await refusal(start(host, "Another"))) ?? ""));

    const twice = await newHost();
    const both = await Promise.allSettled([start(twice, "One"), start(twice, "Two")]);
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.hostId, twice.id));
    check("two starts at the same moment make one project, and the other is told why", rows.length === 1 && both.filter((r) => r.status === "fulfilled").length === 1 && both.some((r) => r.status === "rejected" && r.reason instanceof ProjectError && /already have a project/.test(r.reason.message)), both.map((r) => r.status));

    check("a name is needed, and not too long", /name/.test((await refusal(start(await newHost(), " "))) ?? "") && /80/.test((await refusal(start(await newHost(), "x".repeat(PROJECT.nameMax + 1)))) ?? ""));
    check("a description over 1,000 characters is refused", /1000/.test((await refusal(P.startProject({ hostId: (await newHost()).id, name: "Fine", description: "y".repeat(PROJECT.descriptionMax + 1), now: tick() }))) ?? ""));
  });

  // ========================================================================
  journey("Changing the project, and its posts: text and YouTube links, hers alone", async () => {
    const host = await newHost();
    const other = await newHost();
    check("with no project there is nothing to change", /not running any more/.test((await refusal(change(host, "New", ""))) ?? ""));
    check("and no post can be written", /not running any more/.test((await refusal(write(host, "Hello"))) ?? ""));
    const project = await start(host);
    await change(host, "My second film", "Now about the mountains.\r\nLine two.");
    const changed = await P.runningProjectOf(host.id);
    check("she changes the name and description", changed?.name === "My second film" && changed.description === "Now about the mountains.\nLine two.");

    const post = await write(host, "  Day one.\r\nWe started.  ", ["", `youtu.be/${VIDEO}`, `https://www.youtube.com/watch?v=${VIDEO}&list=PL1`]);
    check("a post keeps its tidied text and its YouTube links, rebuilt by us", post.text === "Day one.\nWe started." && JSON.stringify(linksOf(post.links)) === JSON.stringify([`https://youtu.be/${VIDEO}`, `https://www.youtube.com/watch?v=${VIDEO}`]) && post.projectId === project.id, post.links);
    check("an empty post is refused", /Write something/.test((await refusal(write(host, "  \n "))) ?? ""));
    check("a post over 5,000 characters is refused", /5000/.test((await refusal(write(host, "x".repeat(PROJECT.postTextMax + 1)))) ?? ""));
    check("a link that is not a YouTube address is refused, and nothing is written", /YouTube/.test((await refusal(write(host, "Look", ["https://example.com/watch?v=" + VIDEO]))) ?? "") && /YouTube/.test((await refusal(write(host, "Look", ["javascript:alert(1)"]))) ?? ""));
    check("four links are refused", /up to 3/.test((await refusal(write(host, "Look", ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map((id) => `https://youtu.be/${id}`)))) ?? ""));
    check("only the one post exists", (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.projectId, project.id))).length === 1);

    await Posts.changePost({ hostId: host.id, postId: post.id, text: "Day one, corrected.", links: [], now: tick() });
    const [after] = await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, post.id));
    check("she changes her post", after.text === "Day one, corrected." && after.links === "" && after.updatedAt > after.createdAt);

    await start(other, "Other project");
    check("another host cannot change her post: it looks as if it did not exist", (await refusal(Posts.changePost({ hostId: other.id, postId: post.id, text: "Mine now", links: [], now: tick() }))) === "Post not found.");
    check("or remove it", (await refusal(Posts.removePost({ hostId: other.id, postId: post.id, now: tick() }))) === "Post not found.");
    check("or open it on her own pages", (await Posts.postForHost(other.id, post.id)) === null && (await Posts.postForHost(host.id, post.id))?.post.id === post.id);
    check("an id that is not an id is never looked up", (await refusal(Posts.changePost({ hostId: host.id, postId: "1; drop table", text: "x", links: [], now: tick() }))) === "Post not found." && (await Posts.postForHost(host.id, "nope")) === null);
    const [untouched] = await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, post.id));
    check("her post is as she left it", untouched.text === "Day one, corrected." && untouched.removedAt === null);

    await Posts.removePost({ hostId: host.id, postId: post.id, now: tick() });
    check("she removes her post: it is in no list, and its line stays", (await Posts.postsOf(project.id, { forHost: true })).posts.length === 0 && (await Posts.postsOf(project.id)).posts.length === 0 && (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, post.id)))[0].removedAt !== null);
    check("a removed post cannot be changed, removed again or opened", (await refusal(Posts.changePost({ hostId: host.id, postId: post.id, text: "Back", links: [], now: tick() }))) === "Post not found." && (await refusal(Posts.removePost({ hostId: host.id, postId: post.id, now: tick() }))) === "Post not found." && (await Posts.postForHost(host.id, post.id)) === null);
  });

  // ========================================================================
  journey("Who can read the diary: everyone while her page is open, and nobody when it is not", async () => {
    const host = await newHost();
    const project = await start(host);
    const written = [];
    for (let n = 1; n <= 12; n++) written.push(await write(host, `Post number ${n}`));
    const diary = await P.diaryFor(host.handle);
    check("anyone can open the diary by her handle: it is her running project", diary?.project.id === project.id && diary.profile.handle === host.handle);
    const first = await Posts.postsOf(project.id);
    const second = await Posts.postsOf(project.id, { page: 2 });
    check("ten posts a page, the newest first, with older ones behind", first.posts.length === 10 && first.older && first.posts[0].text === "Post number 12" && first.posts[9].text === "Post number 3" && second.posts.map((p) => p.text).join() === "Post number 2,Post number 1" && !second.older);
    check("a page that does not exist is empty, and a page number that is not one counts as the first", (await Posts.postsOf(project.id, { page: 9 })).posts.length === 0 && (await Posts.postsOf(project.id, { page: -1 })).posts[0].text === "Post number 12" && (await Posts.postsOf(project.id, { page: 1.5 })).posts[0].text === "Post number 12");
    check("the handle is read as her page's is: with an @, in capitals", (await P.diaryFor(`@${host.handle.toUpperCase()}`))?.project.id === project.id);

    const other = await newHost();
    const otherProject = await start(other, "Other project");
    check("by its id: exactly that project", (await P.diaryFor(host.handle, project.id))?.project.id === project.id);
    check("another host's project does not open under her address", (await P.diaryFor(host.handle, otherProject.id)) === null && (await P.diaryFor(other.handle, project.id)) === null);
    check("an id that is not an id, or of no project, opens nothing", (await P.diaryFor(host.handle, "x")) === null && (await P.diaryFor(host.handle, randomUUID())) === null);
    check("a handle that does not exist, and a host without a project, have no diary", (await P.diaryFor("nosuchhandle" + RUN)) === null && (await P.diaryFor((await newHost()).handle)) === null);
    check("each post can be reported while it can be read", (await Posts.publicPost(written[0].id))?.handle === host.handle);

    for (const [why, change, undo] of [
      ["hidden by her", { hidden: true }, { hidden: false }],
      ["suspended", { status: "suspended" }, { status: "approved" }],
      ["waiting for approval", { status: "pending" }, { status: "approved" }],
      ["declined", { status: "declined" }, { status: "approved" }],
    ] as const) {
      await db.update(schema.hostProfiles).set(change).where(eq(schema.hostProfiles.userId, host.id));
      check(`a page that is ${why} has no diary, by handle or by id, and its posts cannot be reported`, (await publicProfile(host.handle)) === null && (await P.diaryFor(host.handle)) === null && (await P.diaryFor(host.handle, project.id)) === null && (await Posts.publicPost(written[0].id)) === null);
      await db.update(schema.hostProfiles).set(undo).where(eq(schema.hostProfiles.userId, host.id));
    }
    await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, host.id));
    check("a closed account has no diary", (await P.diaryFor(host.handle)) === null && (await Posts.publicPost(written[0].id)) === null);
    await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, host.id));
    check("and the diary is back when her page is", (await P.diaryFor(host.handle))?.project.id === project.id && (await Posts.publicPostCount(project.id)) === 12);
  });

  // ========================================================================
  journey("Ending a project: its diary stays readable at its own address, and she can start a new one", async () => {
    const host = await newHost();
    const first = await start(host, "First");
    const post = await write(host, "The only post of the first project");
    check("there is no project to end for someone without one", /not running any more/.test((await refusal(end(await newHost()))) ?? ""));
    const ended = await end(host);
    check("she ends it: ended, by her, with the moment", ended.id === first.id && ended.status === "ended" && ended.endedBy === "host" && ended.endedAt !== null && (await P.runningProjectOf(host.id)) === null);
    check("ending twice is refused", /not running any more/.test((await refusal(end(host))) ?? ""));
    check("with none running, her address shows the one that ended last, marked ended, with its posts", (await P.diaryFor(host.handle))?.project.id === first.id && (await P.diaryFor(host.handle))?.project.status === "ended" && (await Posts.postsOf(first.id)).posts.length === 1);
    check("nothing can be written into it any more", /not running any more/.test((await refusal(write(host, "Too late"))) ?? ""));
    check("and its posts cannot be changed", /has ended/.test((await refusal(Posts.changePost({ hostId: host.id, postId: post.id, text: "Changed", links: [], now: tick() }))) ?? ""));
    check("nor its name", /not running any more/.test((await refusal(change(host, "Renamed", ""))) ?? ""));

    const second = await start(host, "Second");
    await write(host, "The first post of the second project");
    check("she starts a new project: her address now shows the new one", second.id !== first.id && (await P.diaryFor(host.handle))?.project.id === second.id);
    check("and the old one is still readable at its own address", (await P.diaryFor(host.handle, first.id))?.project.id === first.id && (await Posts.postsOf(first.id)).posts[0].text === "The only post of the first project");
    check("her list has both, the newest first", (await P.projectsOf(host.id)).map((p) => p.name).join() === "Second,First");
    const admin = await person("admin");
    await Posts.hidePost({ adminId: admin.id, postId: post.id, note: "", now: tick() });
    check("her own list of the ended project still has its posts, also one the founder hid", (await Posts.postsOf(first.id, { forHost: true })).posts.map((p) => p.id).join() === post.id && (await Posts.postsOf(first.id)).posts.length === 0 && (await P.projectsOf(host.id)).some((p) => p.id === first.id && p.status === "ended"));
    await Posts.removePost({ hostId: host.id, postId: post.id, now: tick() });
    check("she can still remove a post of the ended project", (await Posts.postsOf(first.id, { forHost: true })).posts.length === 0);
    const again = await end(host);
    check("ending again ends the new one, and the first stays as it was", again.id === second.id && (await P.projectsOf(host.id)).every((p) => p.status === "ended") && (await P.diaryFor(host.handle))?.project.id === second.id);
  });

  // ========================================================================
  journey("A form left open in an old tab can never act on a newer project, and the database keeps its own rules", async () => {
    const host = await newHost();
    const other = await newHost();
    const a = await start(host, "Project A");
    // The page with A's forms stays open in one tab. In another she ends A and starts B.
    await end(host);
    const b = await start(host, "Project B");
    const theirs = await start(other, "Someone else's project");
    check("the old tab's \"End this project\" does not end B", /not running any more/.test((await refusal(P.endProject({ hostId: host.id, projectId: a.id, now: tick() }))) ?? "") && (await P.runningProjectOf(host.id))?.id === b.id);
    check("its \"Save\" does not rename B", /not running any more/.test((await refusal(P.changeProject({ hostId: host.id, projectId: a.id, name: "Renamed from an old tab", description: "", now: tick() }))) ?? "") && (await P.runningProjectOf(host.id))?.name === "Project B");
    check("its \"Add to the diary\" writes nothing into B", /not running any more/.test((await refusal(Posts.writePost({ hostId: host.id, projectId: a.id, text: "Meant for A", links: [], now: tick() }))) ?? "") && (await Posts.postsOf(b.id, { forHost: true })).posts.length === 0 && (await Posts.postsOf(a.id, { forHost: true })).posts.length === 0);
    check("a form naming someone else's project does nothing to it", /not running any more/.test((await refusal(P.endProject({ hostId: host.id, projectId: theirs.id, now: tick() }))) ?? "") && /not running any more/.test((await refusal(P.changeProject({ hostId: host.id, projectId: theirs.id, name: "Taken over", description: "", now: tick() }))) ?? "") && /not running any more/.test((await refusal(Posts.writePost({ hostId: host.id, projectId: theirs.id, text: "In your diary", links: [], now: tick() }))) ?? "") && (await P.runningProjectOf(other.id))?.name === "Someone else's project" && (await Posts.postsOf(theirs.id, { forHost: true })).posts.length === 0);
    check("a form naming nothing, or something that is not an id, changes nothing", /not running any more/.test((await refusal(P.endProject({ hostId: host.id, projectId: "", now: tick() }))) ?? "") && /not running any more/.test((await refusal(P.endProject({ hostId: host.id, projectId: "x'; --", now: tick() }))) ?? "") && /not running any more/.test((await refusal(P.endProject({ hostId: host.id, projectId: NOTHING, now: tick() }))) ?? "") && (await P.runningProjectOf(host.id))?.id === b.id);
    check("the form drawn for B works", (await P.endProject({ hostId: host.id, projectId: b.id, now: tick() })).id === b.id);

    // The database's own word, tried directly, past the code.
    // Which of the database's rules said no: its error code and the rule's own name. Any other failure does not count.
    const brokenRule = async (work: Promise<unknown>): Promise<string> =>
      work.then(
        () => "nothing refused it",
        (error: { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } }) => `${error.cause?.code ?? error.code}:${error.cause?.constraint_name ?? error.constraint_name}`,
      );
    const c = await start(host, "Project C");
    const second = await brokenRule(db.insert(schema.projects).values({ hostId: host.id, name: "Second running", startedAt: new Date() }));
    check("the database refuses a second running project for one host, by its own rule", second === "23505:projects_one_running_uq", second);
    const shapes = [await brokenRule(db.update(schema.projects).set({ status: "ended" }).where(eq(schema.projects.id, c.id))), await brokenRule(db.update(schema.projects).set({ endedAt: new Date() }).where(eq(schema.projects.id, c.id))), await brokenRule(db.update(schema.projects).set({ status: "paused", endedAt: new Date() }).where(eq(schema.projects.id, c.id)))];
    check("and a project that is ended without a moment, or running with one, or in a state that does not exist", shapes[0] === "23514:projects_ended_shape" && shapes[1] === "23514:projects_ended_shape" && shapes[2] === "23514:projects_status", shapes);
    check("the project is as it was after those tries", (await P.runningProjectOf(host.id))?.id === c.id && (await P.runningProjectOf(host.id))?.endedAt === null);
  });

  // ========================================================================
  journey("The founder hides a post and shows it again, and it is written down", async () => {
    const host = await newHost();
    const admin = await person("admin");
    const project = await start(host);
    const kept = await write(host, "A fine post");
    const bad = await write(host, "A post the founder hides");
    await Posts.hidePost({ adminId: admin.id, postId: bad.id, note: "  Please read\nthe rules.  ", now: tick() });
    const [hidden] = await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, bad.id));
    check("a hidden post carries who hid it, when, and the note on one line", hidden.hiddenAt !== null && hidden.hiddenBy === admin.id && hidden.hiddenNote === "Please read the rules.");
    check("visitors do not see it; she does, marked", (await Posts.postsOf(project.id)).posts.map((p) => p.id).join() === kept.id && (await Posts.postsOf(project.id, { forHost: true })).posts.some((p) => p.id === bad.id && p.hiddenAt !== null) && (await Posts.publicPostCount(project.id)) === 1);
    check("it cannot be reported any more", (await Posts.publicPost(bad.id)) === null && (await Posts.publicPost(kept.id)) !== null);
    check("she cannot change a hidden post", /hidden by Connect/.test((await refusal(Posts.changePost({ hostId: host.id, postId: bad.id, text: "Fixed", links: [], now: tick() }))) ?? ""));
    check("hiding it twice is refused", /already hidden/.test((await refusal(Posts.hidePost({ adminId: admin.id, postId: bad.id, note: "", now: tick() }))) ?? ""));
    const lists = await Posts.postsForAdmin();
    check("the founder's lists have it under hidden, and not among the newest", lists.hidden.some((e) => e.post.id === bad.id && e.handle === host.handle) && lists.latest.every((e) => e.post.id !== bad.id));
    check("the founder can open any post by its id", (await Posts.postForAdmin(bad.id))?.projectName === project.name && (await Posts.postForAdmin("nope")) === null);
    await Posts.showPost({ adminId: admin.id, postId: bad.id, now: tick() });
    check("shown again: everyone sees it, and nothing of the hiding is left on it", (await Posts.postsOf(project.id)).posts.length === 2 && (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, bad.id)))[0].hiddenNote === null);
    check("showing a post that is not hidden is refused", /not hidden/.test((await refusal(Posts.showPost({ adminId: admin.id, postId: bad.id, now: tick() }))) ?? ""));
    const record = await db.select().from(schema.adminActions).where(eq(schema.adminActions.adminId, admin.id));
    check("both decisions are in the record of the founder's actions, about her and that post", record.length === 2 && record.some((r) => r.action === "diary post hidden" && r.targetUserId === host.id && r.targetId === bad.id && r.detail === "Please read the rules.") && record.some((r) => r.action === "diary post shown again"), record.map((r) => r.action));
    await Posts.hidePost({ adminId: admin.id, postId: bad.id, note: "", now: tick() });
    for (let n = 1; n <= 10; n++) await write(host, `Filler ${n}`);
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
    const every = await Posts.projectPostsForAdmin(project.id);
    const rest = await Posts.projectPostsForAdmin(project.id, 2);
    check("the founder reaches every post of a project, page by page, hidden ones too, also while her page is not open", (await P.diaryFor(host.handle)) === null && every?.posts.length === 10 && every.older && rest?.posts.length === 2 && !rest.older && [...every.posts, ...rest.posts].some((e) => e.post.id === bad.id && e.post.hiddenAt !== null) && [...every.posts, ...rest.posts].some((e) => e.post.id === kept.id));
    check("a project that does not exist has no such list", (await Posts.projectPostsForAdmin(randomUUID())) === null && (await Posts.projectPostsForAdmin("nope")) === null);
    await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));
    await Posts.removePost({ hostId: host.id, postId: bad.id, now: tick() });
    check("a post she removed is no longer in the founder's list of the project", [...(await Posts.projectPostsForAdmin(project.id))!.posts, ...(await Posts.projectPostsForAdmin(project.id, 2))!.posts].every((e) => e.post.id !== bad.id) && (await Posts.postForAdmin(bad.id))?.post.removedAt !== null);
    check("she can remove a post the founder has hidden", (await Posts.postsOf(project.id, { forHost: true })).posts.every((p) => p.id !== bad.id) && (await Posts.postsForAdmin()).hidden.every((e) => e.post.id !== bad.id));
  });

  // ========================================================================
  journey("Reporting a post: it reaches the founder with what the post said, and blocks nobody", async () => {
    const host = await newHost();
    const reader = await person("reader");
    const project = await start(host);
    const post = await write(host, "A post someone reports", [`https://youtu.be/${VIDEO}`]);
    const { reference } = await createReport({ reporterId: reader.id, context: "post", contextId: post.id, reason: "other", text: "  This\nlooks wrong.  ", now: new Date() });
    const [report] = await db.select().from(schema.reports).where(eq(schema.reports.reference, reference));
    const kept = JSON.parse(report.snapshot) as { post?: { id: string; projectId: string; projectName: string; text: string; links: string[] } };
    check("the report names the host as the person reported, from a post", report.reportedId === host.id && report.reporterId === reader.id && report.context === "post" && report.contextId === post.id && report.status === "open" && report.text === "This looks wrong.");
    check("it keeps the post as it was: its text, its links and its project", kept.post?.id === post.id && kept.post.text === "A post someone reports" && kept.post.links.join() === `https://youtu.be/${VIDEO}` && kept.post.projectId === project.id && kept.post.projectName === project.name, kept);
    check("reporting a post does not block its host", (await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, reader.id), eq(schema.blocks.blockedId, host.id)))).length === 0);
    await Posts.changePost({ hostId: host.id, postId: post.id, text: "Changed after the report", links: [], now: tick() });
    check("what was reported is still there after she changes the post", (JSON.parse((await db.select().from(schema.reports).where(eq(schema.reports.id, report.id)))[0].snapshot) as typeof kept).post?.text === "A post someone reports");

    check("nobody reports their own post", /cannot report yourself/.test((await refusal(createReport({ reporterId: host.id, context: "post", contextId: post.id, reason: "other", text: "", now: new Date() }))) ?? ""));
    check("a post that does not exist cannot be reported", (await refusal(createReport({ reporterId: reader.id, context: "post", contextId: randomUUID(), reason: "other", text: "", now: new Date() }))) === "Post not found." && (await refusal(createReport({ reporterId: reader.id, context: "post", contextId: "nope", reason: "other", text: "", now: new Date() }))) === "Post not found.");
    const admin = await person("admin");
    const hiddenPost = await write(host, "Hidden by the founder");
    await Posts.hidePost({ adminId: admin.id, postId: hiddenPost.id, note: "", now: tick() });
    const removedPost = await write(host, "Removed by her");
    await Posts.removePost({ hostId: host.id, postId: removedPost.id, now: tick() });
    check("a hidden post and a removed post cannot be reported: they look as if they did not exist", (await refusal(createReport({ reporterId: reader.id, context: "post", contextId: hiddenPost.id, reason: "other", text: "", now: new Date() }))) === "Post not found." && (await refusal(createReport({ reporterId: reader.id, context: "post", contextId: removedPost.id, reason: "other", text: "", now: new Date() }))) === "Post not found.");
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
    check("nor a post on a page that is not open", (await refusal(createReport({ reporterId: reader.id, context: "post", contextId: post.id, reason: "other", text: "", now: new Date() }))) === "Post not found.");
    await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));
    check("only the one report was written", (await db.select().from(schema.reports).where(eq(schema.reports.reporterId, reader.id))).length === 1);

    // The control: reporting the person, from her page, still blocks, exactly as before.
    const second = await person("reader");
    await createReport({ reporterId: second.id, context: "profile", contextId: host.handle, reason: "other", text: "", now: new Date() });
    check("reporting a host from her page still blocks her, as before", (await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, second.id), eq(schema.blocks.blockedId, host.id)))).length === 1);
  });

  // ========================================================================
  journey("The founder's switch: off stops writing and starting, and nothing that is written disappears", async () => {
    const host = await newHost();
    const other = await newHost();
    const project = await start(host);
    const post = await write(host, "Written while projects were on");
    await setSwitches({ projects: "off" });
    check("off: projects are on for nobody", !(await projectsOnFor(host.id)) && !(await projectsOnFor(other.id)));
    check("nobody can start a project, and is told why", (await P.startProblem(other.id)) === P.PROJECTS_OFF && (await refusal(start(other))) === P.PROJECTS_OFF);
    check("she cannot write a post, change one, or change her project", (await refusal(write(host, "No"))) === P.PROJECTS_OFF && (await refusal(Posts.changePost({ hostId: host.id, postId: post.id, text: "No", links: [], now: tick() }))) === P.PROJECTS_OFF && (await refusal(change(host, "No", ""))) === P.PROJECTS_OFF);
    check("what she wrote stays readable", (await P.diaryFor(host.handle))?.project.id === project.id && (await Posts.postsOf(project.id)).posts[0].text === "Written while projects were on");
    const admin = await person("admin");
    await Posts.hidePost({ adminId: admin.id, postId: post.id, note: "", now: tick() });
    check("the founder can still hide a post: it is gone for visitors at once, and written down", (await Posts.postsOf(project.id)).posts.length === 0 && (await db.select().from(schema.adminActions).where(eq(schema.adminActions.adminId, admin.id))).some((r) => r.action === "diary post hidden" && r.targetId === post.id));
    await Posts.showPost({ adminId: admin.id, postId: post.id, now: tick() });
    check("and show it again", (await Posts.postsOf(project.id)).posts.length === 1 && (await db.select().from(schema.adminActions).where(eq(schema.adminActions.adminId, admin.id))).length === 2);
    const extra = await db.insert(schema.projectPosts).values({ projectId: project.id, text: "A second post", createdAt: tick(), updatedAt: new Date() }).returning();
    await Posts.removePost({ hostId: host.id, postId: extra[0].id, now: tick() });
    check("she can still remove a post", (await Posts.postsOf(project.id, { forHost: true })).posts.length === 1);

    await setSwitches({ projects: "named", projectsHosts: [] });
    check("named with nobody named: on for nobody", !(await projectsOnFor(host.id)));
    await setSwitches({ projects: "named", projectsHosts: [host.id] });
    check("named: on for the host the founder names, off for everyone else", (await projectsOnFor(host.id)) && !(await projectsOnFor(other.id)) && (await refusal(start(other))) === P.PROJECTS_OFF);
    await write(host, "Written as a named host");
    check("the named host writes again", (await Posts.postsOf(project.id)).posts.length === 2);
    await setSwitches({ projects: "off" });
    check("off again keeps the list, and the list alone opens nothing", (await switches()).projectsHosts.join() === host.id && !(await projectsOnFor(host.id)));
    const ended = await end(host);
    check("she can still end her project while projects are off", ended.status === "ended");
    await setSwitches({ projects: "everyone" });
    check("on for everyone: the other host starts one", (await start(other)).status === "running");
    const memberships = await switches();
    check("the projects switch never touches the memberships switch", memberships.memberships === before.memberships && memberships.membershipsHosts.join() === before.membershipsHosts.join());
  });

  // ------------------------------------------------------------------------
  // Pictures (1b): what the journeys below share
  // ------------------------------------------------------------------------
  let shade = 0;
  /** A small picture of a colour of its own each time, or the same one again when a number is given. */
  const file = (n = ++shade) => sharp({ create: { width: 160, height: 120, channels: 3, background: { r: (n * 37) % 256, g: (n * 91) % 256, b: (n * 53) % 256 } } }).png().toBuffer();
  /** The queue's clock. The script moves it; nothing here waits for real minutes. */
  let qclock = Date.now();
  const qnow = () => new Date(qclock);
  const later = (minutes: number) => void (qclock += minutes * MIN);
  const upload = async (host: Person, postId: string, n?: number) => Pics.acceptUpload({ hostId: host.id, postId, original: await file(n), now: qnow() });
  const withPost = async () => {
    const host = await newHost();
    await start(host);
    return { host, post: await write(host, "A post with pictures") };
  };
  const pic = async (id: string) => (await db.select().from(pictures).where(eq(pictures.id, id)))[0];
  const hasBytes = async (id: string) => (await db.select({ id: files.pictureId }).from(files).where(eq(files.pictureId, id))).length === 1;
  const fingerprint = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const asHost = (host: Person) => ({ id: host.id, admin: false });
  const sees = async (viewer: { id: string; admin: boolean } | null, id: string) => Boolean(await Pics.pictureFor(viewer, id));
  const mails = async (to: string, part: string) => (await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${part}%`)))).length;
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 250 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!done()) throw new Error("Waited five seconds for something that did not happen.");
  };
  let adminMade: Person | null = null;
  /** The founder of this run: an admin of its own, so the emails "to the founder" can be counted. */
  const theAdmin = async () => {
    if (!adminMade) {
      adminMade = await person("admin");
      await db.insert(schema.admins).values({ userId: adminMade.id });
    }
    return { ...adminMade, viewer: { id: adminMade.id, admin: true } };
  };

  // The stand-in checkers. What each answers, and with which key, is set by the journey.
  type Kind = "clean" | "flagged" | "out" | "fault";
  type Name = "openai" | "azure" | "sightengine" | "own";
  let says: Record<Name, Kind | ((jpeg: Buffer) => Kind | Promise<Kind>)>;
  let keys: Record<Name, string | null>;
  /** Who was asked, in order, and about which picture (the fingerprint of its bytes). */
  let asked: Name[] = [];
  let askedAbout: string[] = [];
  /** Stand-ins whose "flagged" comes with parts of the answer missing. */
  let partial = new Set<Name>();
  const standIn = (name: Name): Checker => ({
    name,
    get keyMark() {
      return keys[name];
    },
    check: async (jpeg) => {
      asked.push(name);
      askedAbout.push(fingerprint(jpeg));
      const say = says[name];
      const kind = typeof say === "function" ? await say(jpeg) : say;
      return { kind, detail: `${name} said ${kind}`, ...(kind === "flagged" && partial.has(name) ? { partial: true } : {}) };
    },
  });
  const forget = () => {
    asked = [];
    askedAbout = [];
  };
  /** Where in `people` the journey that is running began: its rounds only touch the pictures of the people it made itself. */
  let since = 0;
  /** A clean start for a journey about the queue: every stand-in answers "clean", no service has a history, the tool is not switched on. */
  const fresh = async () => {
    since = people.length;
    says = { openai: "clean", azure: "clean", sightengine: "clean", own: "clean" };
    keys = { openai: "key-1", azure: "key-1", sightengine: "key-1", own: "own" };
    partial = new Set();
    forget();
    qclock = Date.now();
    await db.delete(schema.pictureCheckers);
    await db.update(schema.siteSwitches).set({ childCheckOnAt: null });
  };
  type Tool = { ask: (jpeg: Buffer) => Promise<ChildAnswer> };
  /** One round of the queue, with the stand-ins, on this run's pictures only. No child-safety tool unless one is handed in. */
  const round = (tool: Tool | null = null, toolWithinMs?: number) => Q.runPictureRound({ now: qnow, services: [standIn("openai"), standIn("azure"), standIn("sightengine")], own: standIn("own"), tool, onlyHosts: people.slice(since), toolWithinMs });
  const checkerLine = async (name: Name) => (await db.select().from(schema.pictureCheckers).where(eq(schema.pictureCheckers.service, name)))[0];

  // ========================================================================
  journey("Pictures: taking one in, the four of a post and the twenty of a day", async () => {
    await fresh();
    const admin = await theAdmin();
    const { host, post } = await withPost();
    const first = await upload(host, post.id);
    check("an upload is stored as waiting, with its size and the mark that the child-safety tool is not set up", first.state === "waiting" && first.childCheck === "not_set_up" && first.width === 160 && first.height === 120 && first.byteLength > 0 && first.byteLength <= PICTURE.maxBytes && first.nextTryAt !== null);
    const [stored] = await db.select().from(files).where(eq(files.pictureId, first.id));
    const kept = await sharp(stored.bytes).metadata();
    check("what is kept is Connect's own JPEG copy, and its fingerprint is on the picture's line", kept.format === "jpeg" && fingerprint(stored.bytes) === first.sha256 && stored.bytes.length === first.byteLength);
    const count = async (postId: string) => (await db.select({ id: pictures.id }).from(pictures).where(eq(pictures.postId, postId))).length;
    check("a file that is not a picture is refused in words for the host, and nothing is stored", /JPEG, PNG or WebP/.test((await refusal(Pics.acceptUpload({ hostId: host.id, postId: post.id, original: Buffer.from("not a picture"), now: qnow() }))) ?? "") && (await count(post.id)) === 1);

    const other = await newHost();
    check("nobody adds a picture to someone else's post", /Post not found/.test((await refusal(upload(other, post.id))) ?? ""));
    check("or to a post that does not exist", /Post not found/.test((await refusal(upload(host, NOTHING))) ?? "") && /Post not found/.test((await refusal(upload(host, "nonsense"))) ?? ""));
    await Posts.hidePost({ adminId: admin.id, postId: post.id, note: "", now: tick() });
    check("not to a post Connect has hidden", /hidden by Connect/.test((await refusal(upload(host, post.id))) ?? ""));
    await Posts.showPost({ adminId: admin.id, postId: post.id, now: tick() });
    await setSwitches({ projects: "off" });
    check("not while the founder's switch is off for her", (await refusal(upload(host, post.id))) === P.PROJECTS_OFF);
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    const gone = await write(host, "A post she removes");
    await Posts.removePost({ hostId: host.id, postId: gone.id, now: tick() });
    check("not to a post she has removed", /Post not found/.test((await refusal(upload(host, gone.id))) ?? ""));
    const ended = await withPost();
    await end(ended.host);
    check("and not once the project has ended", /has ended/.test((await refusal(upload(ended.host, ended.post.id))) ?? ""));
    check("none of these refusals stored anything", (await count(post.id)) === 1 && (await count(gone.id)) === 0 && (await count(ended.post.id)) === 0);

    const four = await write(host, "Five pictures at once");
    const five = await Promise.allSettled([1, 2, 3, 4, 5].map(() => upload(host, four.id)));
    check("five uploads to one post at the same moment: four are stored and the fifth is told why", five.filter((r) => r.status === "fulfilled").length === 4 && five.filter((r) => r.status === "rejected" && r.reason instanceof ProjectError && /up to 4 pictures/.test(r.reason.message)).length === 1 && (await Pics.pictureCount(four.id)) === 4, five.map((r) => r.status));
    const one = five.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>;
    await Pics.removePicture({ hostId: host.id, pictureId: one.value.id, now: qnow() });
    const removed = await pic(one.value.id);
    check("she removes one: it is gone for everyone, its bytes are deleted, its line stays", removed.state === "removed" && removed.removedBy === "host" && !(await hasBytes(removed.id)) && !(await sees(asHost(host), removed.id)) && (await Pics.pictureCount(four.id)) === 3);
    check("removing it twice is refused, and so is removing someone else's", /Picture not found/.test((await refusal(Pics.removePicture({ hostId: host.id, pictureId: removed.id, now: qnow() }))) ?? "") && /Picture not found/.test((await refusal(Pics.removePicture({ hostId: other.id, pictureId: first.id, now: qnow() }))) ?? ""));
    check("and there is room for one more again", (await upload(host, four.id)).state === "waiting" && (await Pics.pictureCount(four.id)) === 4);

    // The day's twenty. Eighteen lines are written straight in, as removed and refused ones: every upload counts, whatever became of it.
    const busy = await newHost();
    await start(busy);
    const posts = [await write(busy, "One"), await write(busy, "Two"), await write(busy, "Three")];
    const line = (i: number, uploadedAt: Date) => ({ postId: posts[0].id, hostId: busy.id, width: 1, height: 1, byteLength: 1, sha256: `none-${i}`, uploadedAt, state: i % 2 ? "removed" : "refused" });
    await db.insert(pictures).values([...Array.from({ length: 18 }, (_, i) => line(i, new Date(qclock - 60 * MIN))), line(99, new Date(qclock - 25 * 60 * MIN))]);
    const three = await Promise.allSettled(posts.map((p) => upload(busy, p.id)));
    check("the day's limit holds for uploads sent at the same moment to different posts: with 18 already, two of three go through", three.filter((r) => r.status === "fulfilled").length === 2 && three.filter((r) => r.status === "rejected" && r.reason instanceof ProjectError && /20 pictures in the last 24 hours/.test(r.reason.message)).length === 1, three.map((r) => r.status));
    check("the twenty-first is refused, removed and refused ones counted, one from 25 hours ago not", /20 pictures/.test((await refusal(upload(busy, posts[2].id))) ?? ""));
    later(23 * 60 + 1);
    check("a day after the eighteen, there is room again", (await upload(busy, posts[2].id)).state === "waiting");
  });

  // ========================================================================
  journey("The checking queue: what each answer does to a picture", async () => {
    await fresh();
    const admin = await theAdmin();
    const { host, post } = await withPost();
    const stranger = await person("customer");
    const forHost = async (postId: string) => (await Pics.picturesOf([postId], { forHost: true })).get(postId) ?? [];
    const forAll = async (postId: string) => (await Pics.picturesOf([postId])).get(postId) ?? [];

    const a = await upload(host, post.id);
    check("before its check only its host and the founder get a picture", !(await sees(null, a.id)) && !(await sees(asHost(stranger), a.id)) && (await sees(asHost(host), a.id)) && (await sees(admin.viewer, a.id)) && (await forAll(post.id)).length === 0);
    await round();
    let row = await pic(a.id);
    check("the first service finds nothing: shown, fully checked, and nobody else was asked", row.state === "shown" && row.level === "full" && row.checkedBy === "openai" && row.rulesVersion === PICTURE.rulesVersion && asked.join() === "openai" && row.claimId === null && row.nextTryAt === null, asked);
    check("now anyone gets it, and it is in the diary", (await Pics.pictureFor(null, a.id))?.open === true && (await forAll(post.id)).map((p) => p.id).join() === a.id);
    check("the service is remembered as having worked with the key it has", (await checkerLine("openai"))?.lastGoodKey === "key-1");

    forget();
    says.openai = "flagged";
    const b = await upload(host, post.id, 200);
    await round();
    row = await pic(b.id);
    check("a flag refuses the picture by itself: nobody gets it, its bytes are deleted, and nobody else was asked", row.state === "refused" && row.refusedByChecker && row.checkedBy === "openai" && !(await hasBytes(b.id)) && asked.join() === "openai" && !(await sees(asHost(host), b.id)) && !(await sees(admin.viewer, b.id)) && !(await sees(null, b.id)));
    check("its host is told on the post's page, and it does not count toward the post's four", (await forHost(post.id)).some((p) => p.id === b.id && p.state === "refused") && (await forAll(post.id)).every((p) => p.id !== b.id) && (await Pics.pictureCount(post.id)) === 1);
    check("nothing about it goes to the founder", (await mails(admin.email, "icture")) === 0);
    forget();
    says.openai = "clean";
    const again = await upload(host, post.id, 200);
    await round();
    check("the same picture uploaded again is refused on the spot: no checker is asked and nothing is kept", again.state === "refused" && !(await hasBytes(again.id)) && asked.length === 0);
    await Pics.removePicture({ hostId: host.id, pictureId: b.id, now: qnow() });
    await Pics.removePicture({ hostId: host.id, pictureId: again.id, now: qnow() });
    check("also after she has cleared the refused ones away", (await upload(host, post.id, 200)).state === "refused" && (await forHost(post.id)).filter((p) => p.state === "refused").length === 1);
    const elsewhere = await withPost();
    const theirs = await upload(elsewhere.host, elsewhere.post.id, 200);
    await round();
    check("another host's upload of the very same picture is judged on its own", theirs.state === "waiting" && (await pic(theirs.id)).state === "shown");

    forget();
    says.openai = "out";
    const c = await upload(host, post.id);
    await round();
    row = await pic(c.id);
    check("a service that is used up is passed over: the next one answers", row.state === "shown" && row.level === "full" && row.checkedBy === "azure" && asked.join() === "openai,azure", asked);
    forget();
    const d = await upload(host, post.id);
    await round();
    check("for five minutes it is not asked again", asked.join() === "azure" && (await pic(d.id)).checkedBy === "azure", asked);
    later(6);
    forget();
    says.openai = "clean";
    const e = await upload(host, post.id);
    await round();
    check("after that it is asked again", asked.join() === "openai" && (await pic(e.id)).checkedBy === "openai", asked);

    // A fault: a broken answer or a refused key.
    const second = await write(host, "A second post");
    forget();
    says.openai = "fault";
    const f = await upload(host, second.id);
    await round();
    row = await pic(f.id);
    check("a broken answer is not an outage: the picture waits, nobody else is asked, and it is tried again in a minute", row.state === "waiting" && asked.join() === "openai" && row.tries === 1 && row.nextTryAt?.getTime() === qclock + MIN && /fault/.test(row.checkDetail ?? "") && row.claimId === null, { asked, row });
    check("the fault is written down, and the founder is emailed at once", Boolean((await checkerLine("openai"))?.faultSince) && (await mails(admin.email, "has a fault")) === 1);
    forget();
    await round();
    check("it is not tried before its time", asked.length === 0);
    later(1);
    await round();
    row = await pic(f.id);
    check("then again, and next in five minutes", row.tries === 2 && row.nextTryAt?.getTime() === qclock + 5 * MIN);
    later(5);
    await round();
    row = await pic(f.id);
    check("then every fifteen", row.tries === 3 && row.nextTryAt?.getTime() === qclock + 15 * MIN);
    check("one email, not one for each try", (await mails(admin.email, "has a fault")) === 1);
    later(24 * 60);
    await round();
    check("and one more a day later, while it lasts", (await mails(admin.email, "has a fault")) === 2);
    later(15);
    says.openai = "clean";
    await round();
    check("when the service answers properly again, the picture is shown and the fault is gone", (await pic(f.id)).state === "shown" && (await checkerLine("openai"))?.faultSince === null);

    // Connect's own checker: only when every service with a key is out, and one of them has worked with its key.
    forget();
    keys = { openai: null, azure: null, sightengine: null, own: "own" };
    const g = await upload(host, second.id);
    await round();
    check("with no service set up, a picture waits and Connect's own checker is never asked", (await pic(g.id)).state === "waiting" && asked.length === 0);
    keys = { openai: "key-2", azure: "key-2", sightengine: "key-2", own: "own" };
    says = { openai: "out", azure: "out", sightengine: "out", own: "clean" };
    later(1);
    await round();
    check("every service out, and none has ever worked with the key it has now: it waits, and the own checker is not asked", (await pic(g.id)).state === "waiting" && asked.join() === "openai,azure,sightengine", asked);
    await db.update(schema.pictureCheckers).set({ lastGoodAt: qnow(), lastGoodKey: "key-2" }).where(eq(schema.pictureCheckers.service, "azure"));
    forget();
    later(6);
    await round();
    row = await pic(g.id);
    check("one has worked, every one is out: the own checker passes it, shown but marked as checked for nudity only", row.state === "shown" && row.level === "nudity_only" && row.checkedBy === "own" && asked.join() === "openai,azure,sightengine,own" && (await Pics.pictureFor(null, g.id))?.open === true, asked);
    check("the founder is told that such a picture is being shown", (await mails(admin.email, "nudity only")) === 1);
    check("and sees it in a list of its own", (await Mod.picturesForAdmin()).nudityOnly.some((entry) => entry.picture.id === g.id));

    const third = await write(host, "A third post");
    forget();
    later(6);
    says.own = "flagged";
    says.openai = "out";
    const h = await upload(host, third.id);
    // Only the new one is due: the one shown for nudity only was looked at a moment ago.
    await db.update(pictures).set({ nextTryAt: new Date(qclock + 60 * MIN) }).where(eq(pictures.id, g.id));
    await round();
    row = await pic(h.id);
    check("when the own checker finds nudity the picture is refused like any other", row.state === "refused" && row.checkedBy === "own" && !(await hasBytes(h.id)), row);
    later(6);
    says.own = "fault";
    const i = await upload(host, third.id);
    await round();
    check("when the own checker itself fails, the picture waits", (await pic(i.id)).state === "waiting");
    later(6);
    forget();
    keys.azure = "key-3";
    await db.update(pictures).set({ nextTryAt: qnow() }).where(eq(pictures.id, i.id));
    says.own = "clean";
    await round();
    check("a service whose key was changed has not worked yet with the new one: the own checker is not asked", (await pic(i.id)).state === "waiting" && !asked.includes("own"), asked);
    keys.azure = "key-2";

    // The ones that were only checked for nudity come first, and get their full check.
    later(20);
    forget();
    says = { openai: "clean", azure: "out", sightengine: "out", own: "clean" };
    await db.update(pictures).set({ nextTryAt: qnow() }).where(inArray(pictures.id, [g.id, i.id]));
    await round();
    row = await pic(g.id);
    check("when a service answers again, the picture that was only checked for nudity is asked about first", askedAbout[0] === row.sha256 && asked[0] === "openai", asked);
    check("and a clean answer makes its check a full one", row.state === "shown" && row.level === "full" && row.checkedBy === "openai" && row.nextTryAt === null);
    check("no list of nudity-only pictures holds it any more", (await Mod.picturesForAdmin()).nudityOnly.every((entry) => entry.picture.id !== g.id));

    const fourth = await write(host, "A fourth post");
    const makeNudityOnly = async () => {
      later(6);
      says = { openai: "out", azure: "out", sightengine: "out", own: "clean" };
      const made = await upload(host, fourth.id);
      await round();
      return made;
    };
    const j = await makeNudityOnly();
    check("(another picture shown for nudity only)", (await pic(j.id)).level === "nudity_only");
    later(6);
    forget();
    await round();
    row = await pic(j.id);
    check("while every service is still out it stays as it is, shown, and the own checker is not asked a second time", row.state === "shown" && row.level === "nudity_only" && asked.join() === "openai,azure,sightengine" && row.nextTryAt?.getTime() === qclock + 5 * MIN, asked);
    later(6);
    says.openai = "fault";
    await round();
    check("a fault leaves it as it is too", (await pic(j.id)).level === "nudity_only" && (await pic(j.id)).state === "shown");
    later(6);
    says.openai = "flagged";
    await round();
    row = await pic(j.id);
    check("a flag at its full check takes it down at once: refused, gone from the diary, its bytes deleted", row.state === "refused" && row.checkedBy === "openai" && !(await hasBytes(j.id)) && !(await sees(null, j.id)) && (await forAll(fourth.id)).length === 0);

    // A flag that comes with parts of the answer missing refuses the picture, but does not show that the service works.
    await db.delete(schema.pictureCheckers);
    later(30);
    partial = new Set<Name>(["openai"]);
    says = { openai: "flagged", azure: "out", sightengine: "out", own: "clean" };
    const fifth = await write(host, "A fifth post");
    const k = await upload(host, fifth.id);
    await round();
    check("a flag in an incomplete answer still refuses the picture", (await pic(k.id)).state === "refused");
    check("but is not taken as the service having worked with its key", !(await checkerLine("openai"))?.lastGoodKey);
    forget();
    says.openai = "out";
    const l = await upload(host, fifth.id);
    await round();
    check("so with every service out afterwards, the own checker still may not pass a picture", (await pic(l.id)).state === "waiting" && !asked.includes("own"), asked);

    // A service's last answer says how it stands. A fault is never waited out; "out" after a fault starts the five minutes again.
    partial = new Set();
    await db.delete(schema.pictureCheckers);
    later(30);
    // (The picture that is still waiting from above is kept out of these rounds.)
    await db.update(pictures).set({ nextTryAt: new Date(qclock + 600 * MIN) }).where(eq(pictures.id, l.id));
    says = { openai: "fault", azure: "clean", sightengine: "clean", own: "clean" };
    forget();
    // As when two rounds were asking at once: while this one waits for its answer, the other one's "out" is written, and then this one's fault.
    says.openai = async (): Promise<Kind> => {
      await db.insert(schema.pictureCheckers).values({ service: "openai", outUntil: new Date(qclock + 4 * MIN) }).onConflictDoUpdate({ target: schema.pictureCheckers.service, set: { outUntil: new Date(qclock + 4 * MIN) } });
      return "fault";
    };
    const m = await upload(host, fifth.id);
    await round();
    check("recording a fault leaves no five minutes running, also when an \"out\" was written a moment before", asked.join() === "openai" && (await pic(m.id)).state === "waiting" && (await checkerLine("openai"))?.outUntil === null && Boolean((await checkerLine("openai"))?.faultSince), asked);
    forget();
    says.openai = "fault";
    later(1);
    await round();
    check("so the service is asked again for the next try, not passed over, and the picture waits", asked.join() === "openai" && (await pic(m.id)).state === "waiting", asked);
    later(5);
    forget();
    says.openai = "out";
    await round();
    const afterOut = await checkerLine("openai");
    check("when it then says \"not now\", that is its state: no fault any more, five minutes running, and the next service answers", asked.join() === "openai,azure" && afterOut?.faultSince === null && Boolean(afterOut?.outUntil) && (await pic(m.id)).checkedBy === "azure", asked);
    forget();
    const n = await upload(host, fifth.id);
    await round();
    check("and in those five minutes it is not asked", asked.join() === "azure" && (await pic(n.id)).state === "shown", asked);

    // The moment any service answers properly again, a picture shown for nudity only is due, whatever its own time says.
    await db.delete(schema.pictureCheckers);
    await db.insert(schema.pictureCheckers).values({ service: "azure", lastGoodAt: qnow(), lastGoodKey: "key-2" });
    later(30);
    says = { openai: "fault", azure: "out", sightengine: "out", own: "clean" };
    const seventh = await write(host, "A seventh post");
    await db.delete(schema.pictureCheckers).where(eq(schema.pictureCheckers.service, "openai"));
    says.openai = "out";
    const o = await upload(host, seventh.id);
    await round();
    check("(a picture shown for nudity only)", (await pic(o.id)).level === "nudity_only");
    later(6);
    says.openai = "fault";
    await round();
    const notYet = (await pic(o.id)).nextTryAt;
    later(1);
    says.openai = "clean";
    forget();
    const q = await upload(host, seventh.id);
    await round();
    check("a service recovers from a fault before that picture's own time: the newer waiting picture is checked, and the one shown for nudity only gets its full check in the same round", notYet !== null && notYet.getTime() > qclock && (await pic(q.id)).state === "shown" && (await pic(o.id)).level === "full", { asked, level: (await pic(o.id)).level });

    // Tidying: pictures whose bytes cannot be freed yet do not hold up one whose bytes can.
    const sixth = await write(host, "A sixth post");
    const stuck = [await upload(host, sixth.id), await upload(host, sixth.id), await upload(host, sixth.id)];
    const free = await upload(host, sixth.id);
    for (const p of [...stuck, free]) await db.update(pictures).set({ state: "removed", removedAt: qnow(), removedBy: "host", nextTryAt: null }).where(eq(pictures.id, p.id));
    await db.update(pictures).set({ claimId: randomUUID(), claimedUntil: new Date(qclock + 60 * MIN) }).where(inArray(pictures.id, stuck.map((p) => p.id)));
    const next = await Steps.goneWithBytes(1, qnow(), inArray(pictures.hostId, [host.id]));
    check("the list for tidying holds only pictures whose bytes can go now", next.join() === free.id, next);
    await round();
    check("and the round deletes exactly those", !(await hasBytes(free.id)) && (await hasBytes(stuck[0].id)) && (await hasBytes(stuck[2].id)));
  });

  // ========================================================================
  journey("The checking queue: never two answers for one picture", async () => {
    await fresh();
    const admin = await theAdmin();
    const { host, post } = await withPost();

    const a = await upload(host, post.id);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    says.openai = async (): Promise<Kind> => {
      await gate;
      return "clean";
    };
    const first = round();
    await until(() => asked.length === 1);
    await round();
    check("a second round at the same moment leaves alone a picture the first one holds", asked.length === 1 && (await pic(a.id)).state === "waiting");
    open();
    await first;
    check("and the first round's answer is the one that is written", (await pic(a.id)).state === "shown" && asked.length === 1);

    const b = await upload(host, post.id);
    let keptMeanwhile = false;
    says.openai = async (): Promise<Kind> => {
      await Pics.removePicture({ hostId: host.id, pictureId: b.id, now: qnow() });
      keptMeanwhile = (await hasBytes(b.id)) && !(await sees(asHost(host), b.id));
      return "clean";
    };
    await round();
    let row = await pic(b.id);
    check("the host removes a picture while it is being checked: it is gone for everyone at once, and its bytes stay only until that check is back", keptMeanwhile && !(await hasBytes(b.id)));
    check("the answer that comes back afterwards changes nothing", row.state === "removed" && row.level === null && row.claimId === null);

    const c = await upload(host, post.id);
    says.openai = async (): Promise<Kind> => {
      await Mod.setSuspected({ adminId: admin.id, pictureId: c.id, on: true, now: qnow() });
      return "clean";
    };
    await round();
    row = await pic(c.id);
    check("the founder holds a picture while it is being checked: the clean answer that comes back does not show it", row.state === "waiting" && row.suspectedByFounder && row.claimId === null);
    forget();
    says.openai = "clean";
    later(2);
    await round();
    check("while it is held, no checker is sent it", asked.length === 0 && (await pic(c.id)).state === "waiting");
    await Mod.setSuspected({ adminId: admin.id, pictureId: c.id, on: false, now: qnow() });
    await round();
    check("once the hold is lifted it is checked like any other", (await pic(c.id)).state === "shown" && asked.join() === "openai");

    // The same hold, but the first service is out: without asking again, the picture would go on to the next service.
    const held = await write(host, "A post with a picture that gets held");
    const c2 = await upload(host, held.id);
    forget();
    says.openai = async (): Promise<Kind> => {
      await Mod.setSuspected({ adminId: admin.id, pictureId: c2.id, on: true, now: qnow() });
      return "out";
    };
    await round();
    check("held while the first service is being asked, which then is out: the picture is sent to no further service", asked.join() === "openai" && (await pic(c2.id)).state === "waiting", asked);
    forget();
    says.openai = async (): Promise<Kind> => {
      await Mod.lockAndReport({ adminId: admin.id, pictureId: c3.id, now: qnow() });
      return "out";
    };
    later(6);
    const c3 = await upload(host, held.id);
    await round();
    check("the same when it is removed and reported meanwhile: no further service, and it stays locked with its bytes", asked.join() === "openai" && (await pic(c3.id)).state === "locked" && (await hasBytes(c3.id)), asked);
    await db.delete(schema.pictureCheckers);
    says.openai = "clean";

    const d = await upload(host, post.id);
    says.openai = () => {
      later(3);
      return "flagged";
    };
    await round();
    row = await pic(d.id);
    check("an answer that comes back after the round's time has run out is not written", row.state === "waiting" && !row.refusedByChecker && row.claimId === null && (await hasBytes(d.id)));
    says.openai = "clean";
    await round();
    check("the picture is simply asked about again", (await pic(d.id)).state === "shown");

    const second = await write(host, "A second post");
    const e = await upload(host, second.id);
    await db.update(pictures).set({ claimId: randomUUID(), claimedUntil: new Date(qclock + 2 * MIN) }).where(eq(pictures.id, e.id));
    forget();
    await round();
    check("a picture held by a round that died is left alone while that round's time runs", asked.length === 0 && (await pic(e.id)).state === "waiting");
    later(3);
    await round();
    check("and is taken up afresh when it has run out", (await pic(e.id)).state === "shown");

    const f = await upload(host, second.id);
    await db.update(pictures).set({ claimId: randomUUID(), claimedUntil: new Date(qclock + 2 * MIN) }).where(eq(pictures.id, f.id));
    await Pics.removePicture({ hostId: host.id, pictureId: f.id, now: qnow() });
    await round();
    check("removed while a round that died still holds it: gone for everyone, bytes kept for now", (await pic(f.id)).state === "removed" && (await hasBytes(f.id)) && !(await sees(asHost(host), f.id)) && !(await sees(admin.viewer, f.id)));
    later(3);
    await round();
    check("and deleted by the next round once that time has run out", !(await hasBytes(f.id)));
  });

  // ========================================================================
  journey("Who is handed a picture, in every state (the one function the picture's address asks)", async () => {
    await fresh();
    const admin = await theAdmin();
    const { host, post } = await withPost();
    const stranger = await person("customer");
    /** Who gets it: a visitor, a logged-in stranger, its host, the founder. */
    const who = async (id: string) => [await sees(null, id), await sees(asHost(stranger), id), await sees(asHost(host), id), await sees(admin.viewer, id)].map((yes) => (yes ? "yes" : "no")).join(" ");

    const shown = await upload(host, post.id);
    await round();
    check("shown, its post up, her page open: everyone", (await who(shown.id)) === "yes yes yes yes" && (await Pics.pictureFor(null, shown.id))?.open === true);
    await Posts.hidePost({ adminId: admin.id, postId: post.id, note: "", now: tick() });
    check("shown, but its post is hidden by Connect: its host and the founder", (await who(shown.id)) === "no no yes yes" && (await Pics.pictureFor(asHost(host), shown.id))?.open === false);
    await Posts.showPost({ adminId: admin.id, postId: post.id, now: tick() });
    await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, host.id));
    check("shown, but her page is not open: its host and the founder", (await who(shown.id)) === "no no yes yes");
    await db.update(schema.hostProfiles).set({ status: "approved" }).where(eq(schema.hostProfiles.userId, host.id));
    check("(open again: everyone)", (await who(shown.id)) === "yes yes yes yes");

    await Mod.setSuspected({ adminId: admin.id, pictureId: shown.id, on: true, now: qnow() });
    check("held as suspected by the founder: the founder alone", (await who(shown.id)) === "no no no yes" && ((await Pics.picturesOf([post.id])).get(post.id) ?? []).length === 0);
    check("its host is told that Connect is looking at it", ((await Pics.picturesOf([post.id], { forHost: true })).get(post.id) ?? []).some((p) => p.id === shown.id && p.held));
    check("the founder sees it in the list of held pictures", (await Mod.picturesForAdmin()).held.some((entry) => entry.picture.id === shown.id));
    await Mod.setSuspected({ adminId: admin.id, pictureId: shown.id, on: false, now: qnow() });

    const waiting = await upload(host, post.id);
    check("waiting for its check: its host and the founder", (await who(waiting.id)) === "no no yes yes" && (await Pics.pictureFor(asHost(host), waiting.id))?.open === false);
    check("an admin's login without the second step counts as nobody's", !(await sees({ id: admin.id, admin: false }, waiting.id)));

    says.openai = "flagged";
    const refused = await upload(host, post.id);
    await db.update(pictures).set({ nextTryAt: new Date(qclock + 60 * MIN) }).where(eq(pictures.id, waiting.id));
    await round();
    check("refused: nobody", (await pic(refused.id)).state === "refused" && (await who(refused.id)) === "no no no no");
    says.openai = "clean";

    const removed = await upload(host, post.id);
    await Pics.removePicture({ hostId: host.id, pictureId: removed.id, now: qnow() });
    check("removed: nobody", (await who(removed.id)) === "no no no no");

    const second = await write(host, "A second post");
    const locked = await upload(host, second.id);
    await Mod.lockAndReport({ adminId: admin.id, pictureId: locked.id, now: qnow() });
    check("locked: nobody, although its bytes are kept", (await who(locked.id)) === "no no no no" && (await hasBytes(locked.id)));

    check("an address that names no picture gives nothing", !(await sees(admin.viewer, NOTHING)) && !(await sees(admin.viewer, "nonsense")));
    // (These were uploaded at the same moment of the script's clock, so they are compared without their order.)
    const lists = { all: ((await Pics.picturesOf([post.id, second.id])).get(post.id) ?? []).map((p) => p.id), hers: ((await Pics.picturesOf([post.id, second.id], { forHost: true })).get(post.id) ?? []).map((p) => `${p.id}:${p.state}`).sort() };
    check("the diary's list holds the shown ones only; her own page also the waiting and the refused, never a removed or locked one", lists.all.join() === shown.id && lists.hers.join() === [`${shown.id}:shown`, `${waiting.id}:waiting`, `${refused.id}:refused`].sort().join() && !(await Pics.picturesOf([second.id], { forHost: true })).has(second.id), lists);

    await Posts.removePost({ hostId: host.id, postId: post.id, now: tick() });
    const after = [await pic(shown.id), await pic(waiting.id), await pic(refused.id)];
    check("she removes the post: its pictures are removed with it, and nobody gets them any more", after.every((p) => p.state === "removed") && (await who(shown.id)) === "no no no no" && !(await hasBytes(shown.id)) && !(await hasBytes(waiting.id)));
  });

  // ========================================================================
  journey("The founder and a picture: remove, hold, and remove and report", async () => {
    await fresh();
    const admin = await theAdmin();
    const { host, post } = await withPost();
    /** How often this was written into the record of the founder's actions, about this picture. */
    const actions = async (action: string, pictureId: string) => (await db.select().from(schema.adminActions).where(and(eq(schema.adminActions.adminId, admin.id), eq(schema.adminActions.action, action), eq(schema.adminActions.targetId, pictureId)))).length;

    const a = await upload(host, post.id);
    await round();
    await Mod.removePictureAsFounder({ adminId: admin.id, pictureId: a.id, now: qnow() });
    let row = await pic(a.id);
    check("the founder removes a shown picture: gone for everyone, bytes deleted, written into the record", row.state === "removed" && row.removedBy === "founder" && !(await hasBytes(a.id)) && !(await sees(null, a.id)) && (await actions("diary picture removed", a.id)) === 1);
    check("a second time is refused", /no longer there/.test((await refusal(Mod.removePictureAsFounder({ adminId: admin.id, pictureId: a.id, now: qnow() }))) ?? ""));

    const b = await upload(host, post.id, 210);
    const c = await upload(host, post.id);
    await round();
    const before = (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, post.id)))[0];
    await Mod.lockAndReport({ adminId: admin.id, pictureId: b.id, now: qnow() });
    row = await pic(b.id);
    const hidden = (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, post.id)))[0];
    check("remove and report: the picture is locked, its bytes kept, and nobody gets it, the founder included", row.state === "locked" && row.lockedBy === admin.id && row.lockedAt !== null && (await hasBytes(b.id)) && !(await sees(admin.viewer, b.id)) && !(await sees(asHost(host), b.id)) && (await actions("diary picture removed and reported", b.id)) === 1);
    check("its post is hidden in the same step and kept as it was", hidden.hiddenAt !== null && hidden.hiddenBy === admin.id && JSON.parse(row.lockedPost ?? "{}").text === before.text && JSON.parse(row.lockedPost ?? "{}").id === post.id);
    check("the other picture of that post is hidden with it from visitors, not from her", !(await sees(null, c.id)) && (await sees(asHost(host), c.id)));
    check("the founder sees it in the list of removed and reported pictures", (await Mod.picturesForAdmin()).locked.some((entry) => entry.picture.id === b.id));

    check("the host cannot remove a locked picture", /Picture not found/.test((await refusal(Pics.removePicture({ hostId: host.id, pictureId: b.id, now: qnow() }))) ?? ""));
    check("neither can the founder's ordinary Remove, and it cannot be held or locked a second time", /no longer there/.test((await refusal(Mod.removePictureAsFounder({ adminId: admin.id, pictureId: b.id, now: qnow() }))) ?? "") && /no longer there/.test((await refusal(Mod.setSuspected({ adminId: admin.id, pictureId: b.id, on: true, now: qnow() }))) ?? "") && /already/.test((await refusal(Mod.lockAndReport({ adminId: admin.id, pictureId: b.id, now: qnow() }))) ?? ""));
    check("its post cannot be removed, changed or shown again", /kept by Connect/.test((await refusal(Posts.removePost({ hostId: host.id, postId: post.id, now: tick() }))) ?? "") && /hidden by Connect/.test((await refusal(Posts.changePost({ hostId: host.id, postId: post.id, text: "Changed", links: [], now: tick() }))) ?? "") && /stays hidden/.test((await refusal(Posts.showPost({ adminId: admin.id, postId: post.id, now: tick() }))) ?? ""));
    check("and no round of the queue touches it", (await round(), (await pic(b.id)).state === "locked" && (await hasBytes(b.id))));

    check("the time of the report cannot lie in the future, and is needed", /not come yet/.test((await refusal(Mod.recordReportMade({ adminId: admin.id, pictureId: b.id, madeAt: new Date(qclock + 60 * MIN), now: qnow() }))) ?? "") && /day and time/.test((await refusal(Mod.recordReportMade({ adminId: admin.id, pictureId: b.id, madeAt: new Date(Number.NaN), now: qnow() }))) ?? ""));
    const madeAt = new Date(qclock - 30 * MIN);
    await Mod.recordReportMade({ adminId: admin.id, pictureId: b.id, madeAt, now: qnow() });
    check("\"I have made the report\" writes down the time the founder gives, not the time of the click", (await pic(b.id)).reportMadeAt?.getTime() === madeAt.getTime() && (await actions("report of a diary picture recorded", b.id)) === 1);
    check("only a locked picture has a report", /Only a picture that was removed and reported/.test((await refusal(Mod.recordReportMade({ adminId: admin.id, pictureId: c.id, madeAt, now: qnow() }))) ?? ""));

    const second = await write(host, "A second post");
    const same = await upload(host, second.id, 210);
    const secondNow = (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, second.id)))[0];
    check("the same picture uploaded again is locked in the full sense at once: kept, its post hidden, the founder emailed", same.state === "locked" && same.lockedBy === null && (await hasBytes(same.id)) && secondNow.hiddenAt !== null && (await mails(admin.email, "locked picture was uploaded again")) === 1 && !(await sees(asHost(host), same.id)));

    says.openai = "flagged";
    const third = await write(host, "A third post");
    const refused = await upload(host, third.id);
    await round();
    check("a picture whose bytes are no longer kept cannot be locked", /no longer kept/.test((await refusal(Mod.lockAndReport({ adminId: admin.id, pictureId: refused.id, now: qnow() }))) ?? ""));

    await end(host);
    check("ending the project leaves a locked picture and its bytes alone", (await pic(b.id)).state === "locked" && (await hasBytes(b.id)) && (await hasBytes(same.id)));
    check("a picture that does not exist is refused", /Picture not found/.test((await refusal(Mod.lockAndReport({ adminId: admin.id, pictureId: NOTHING, now: qnow() }))) ?? "") && /Picture not found/.test((await refusal(Mod.setSuspected({ adminId: admin.id, pictureId: "nonsense", on: true, now: qnow() }))) ?? ""));
  });

  // ========================================================================
  journey("A report for \"someone under 18\" and the pictures of the post", async () => {
    await fresh();
    const admin = await theAdmin();
    const { host, post } = await withPost();
    const reporter = await person("customer");
    const another = await person("customer");
    const report = async (by: Person, reason: string) => {
      await createReport({ reporterId: by.id, context: "post", contextId: post.id, reason, text: "", now: new Date() });
      return (await db.select().from(schema.reports).where(and(eq(schema.reports.reporterId, by.id), eq(schema.reports.contextId, post.id))).orderBy(desc(schema.reports.createdAt)))[0];
    };
    const close = (reportId: string) => closeReport({ reportId, adminId: admin.id, note: "looked at" });

    const a = await upload(host, post.id);
    await round();
    const b = await upload(host, post.id);
    const plain = await report(reporter, "sexual");
    check("a report keeps the ids of the pictures the post was showing", JSON.stringify(JSON.parse(plain.snapshot).post.pictures) === JSON.stringify([a.id]));
    check("an ordinary report marks no picture", !(await pic(a.id)).suspectedByReport && !(await pic(b.id)).suspectedByReport);
    await close(plain.id);

    const versions = [(await pic(a.id)).version, (await pic(b.id)).version];
    const first = await report(reporter, "under18");
    check("a report for \"someone under 18\" marks the post's pictures as suspected, and moves their counters", (await pic(a.id)).suspectedByReport && (await pic(b.id)).suspectedByReport && (await pic(a.id)).version === versions[0] + 1 && (await pic(b.id)).version === versions[1] + 1);
    check("the mark hides nothing by itself: a visitor still gets the shown picture", await sees(null, a.id));
    forget();
    await round();
    check("but no checking service is sent a suspected picture", asked.length === 0 && (await pic(b.id)).state === "waiting");
    const second = await report(another, "under18");
    await close(first.id);
    check("closing one such report leaves the mark while another is open", (await pic(b.id)).suspectedByReport);
    await close(second.id);
    check("closing the last one lifts it", !(await pic(a.id)).suspectedByReport && !(await pic(b.id)).suspectedByReport);
    await round();
    check("and the waiting picture is checked again", asked.join() === "openai" && (await pic(b.id)).state === "shown");

    // While such a report is open, a picture added to the post is suspected from the start: removing one and uploading it again is no way round.
    const open1 = await report(reporter, "under18");
    forget();
    const added = await upload(host, post.id);
    await Pics.removePicture({ hostId: host.id, pictureId: b.id, now: qnow() });
    const again = await upload(host, post.id);
    await round();
    check("a picture uploaded while such a report is open carries the mark, and no checking service is sent it", added.suspectedByReport && again.suspectedByReport && asked.length === 0 && (await pic(added.id)).state === "waiting");
    // Two such reports closed at the same moment: the mark comes off, once, and nothing is left hanging.
    const open2 = await report(another, "under18");
    const both = await Promise.allSettled([close(open1.id), close(open2.id)]);
    check("two such reports closed at the same moment: both close, and the mark is lifted", both.every((r) => r.status === "fulfilled") && !(await pic(added.id)).suspectedByReport && !(await pic(again.id)).suspectedByReport && !(await pic(a.id)).suspectedByReport, both.map((r) => r.status));
    // One is closed while another is made, many times over: whatever the order, the mark ends up saying what the open reports say.
    let agree = true;
    for (let i = 0; i < 6 && agree; i++) {
      const open3 = await report(reporter, "under18");
      const reporterN = await person("customer");
      const pair = await Promise.allSettled([close(open3.id), createReport({ reporterId: reporterN.id, context: "post", contextId: post.id, reason: "under18", text: "", now: new Date() })]);
      agree = pair.every((r) => r.status === "fulfilled");
      const stillOpen = (await db.select().from(schema.reports).where(and(eq(schema.reports.contextId, post.id), eq(schema.reports.reason, "under18"), eq(schema.reports.status, "open")))).length > 0;
      agree = agree && stillOpen && (await pic(added.id)).suspectedByReport && (await pic(a.id)).suspectedByReport;
      for (const left of await db.select().from(schema.reports).where(and(eq(schema.reports.contextId, post.id), eq(schema.reports.status, "open")))) await close(left.id);
      agree = agree && !(await pic(added.id)).suspectedByReport;
    }
    check("one closed while another is made, six times: both go through, and the mark always says what the open reports say", agree);

    await Mod.setSuspected({ adminId: admin.id, pictureId: a.id, on: true, now: qnow() });
    const third = await report(reporter, "under18");
    await close(third.id);
    check("closing a report never lifts the founder's own mark", (await pic(a.id)).suspectedByFounder && !(await pic(a.id)).suspectedByReport && !(await sees(null, a.id)));
  });

  // ========================================================================
  journey("The check against known pictures of child abuse, with a stand-in tool", async () => {
    await fresh();
    const admin = await theAdmin();
    const { host, post } = await withPost();
    const second = await write(host, "A second post");
    const answers = new Map<string, ChildAnswer>();
    let toolAsked: string[] = [];
    const tool: Tool = {
      ask: async (jpeg) => {
        toolAsked.push(fingerprint(jpeg));
        return answers.get(fingerprint(jpeg)) ?? "clear";
      },
    };

    const old = await upload(host, post.id);
    const oldMatch = await upload(host, second.id, 220);
    const gone = await upload(host, post.id);
    await round();
    await Pics.removePicture({ hostId: host.id, pictureId: gone.id, now: qnow() });
    check("before Connect has the tool, pictures do not wait for it: they are checked and shown", (await pic(old.id)).state === "shown" && (await pic(old.id)).childCheck === "not_set_up" && !(await Child.childCheckOn()) && !(await hasBytes(gone.id)));

    answers.set(oldMatch.sha256, "match");
    await round(tool);
    check("the tool's first real answer switches it on, for good", await Child.childCheckOn());
    check("a picture from before that day stays as it was and gets its answer afterwards", (await pic(old.id)).state === "shown" && (await pic(old.id)).childCheck === "clear" && (await sees(null, old.id)));
    let row = await pic(oldMatch.id);
    const itsPost = (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, second.id)))[0];
    check("a match among them is locked at once: kept, its post hidden, nobody gets it, the founder emailed", row.state === "locked" && row.childCheck === "match" && row.lockedBy === null && (await hasBytes(oldMatch.id)) && itsPost.hiddenAt !== null && !(await sees(admin.viewer, oldMatch.id)) && (await mails(admin.email, "matched the list")) === 1);
    check("a picture removed before that day is left alone: its bytes were gone, and its line only says the tool never saw it", (await pic(gone.id)).childCheck === "not_set_up" && !toolAsked.includes(gone.sha256));
    toolAsked = [];
    await round(tool);
    check("and the catching-up comes to its end: nothing is left to ask about", toolAsked.length === 0);

    forget();
    const fresh1 = await upload(host, post.id);
    check("from then on a new picture waits for the tool, and nobody gets it before, its host and the founder included", fresh1.childCheck === "waiting" && !(await sees(asHost(host), fresh1.id)) && !(await sees(admin.viewer, fresh1.id)));
    check("its host is told that Connect is looking at it", ((await Pics.picturesOf([post.id], { forHost: true })).get(post.id) ?? []).some((p) => p.id === fresh1.id && p.held));
    await round(null);
    check("with the tool's settings gone it keeps waiting, and no everyday checker is sent it", (await pic(fresh1.id)).childCheck === "waiting" && (await pic(fresh1.id)).state === "waiting" && asked.length === 0 && (await Child.childCheckOn()));
    answers.set(fresh1.sha256, "unreachable");
    await round(tool);
    check("the same while the tool cannot be reached", (await pic(fresh1.id)).childCheck === "waiting" && asked.length === 0);
    answers.delete(fresh1.sha256);
    await round(tool);
    check("once the tool says clear, it goes on to the everyday checkers and is shown", (await pic(fresh1.id)).childCheck === "clear" && (await pic(fresh1.id)).state === "shown" && asked.join() === "openai");

    const fresh2 = await upload(host, post.id);
    await Pics.removePicture({ hostId: host.id, pictureId: fresh2.id, now: qnow() });
    check("removed before the tool has answered: gone for everyone, but its bytes are kept until it has", (await pic(fresh2.id)).state === "removed" && (await hasBytes(fresh2.id)));
    await round(null);
    check("also across a round without the tool", await hasBytes(fresh2.id));
    await round(tool);
    check("the tool's clear answer frees them", (await pic(fresh2.id)).childCheck === "clear" && !(await hasBytes(fresh2.id)));

    // A picture a checker refuses: the tool must have seen it before its bytes go.
    const fifth = await write(host, "A fifth post");
    await db.update(schema.siteSwitches).set({ childCheckOnAt: null });
    const early = await upload(host, fifth.id, 230);
    await Child.switchChildCheckOn(qnow());
    says.openai = "flagged";
    await round(null);
    check("a picture from before that day that a checker refuses keeps its bytes until the tool has seen it", (await pic(early.id)).state === "refused" && (await pic(early.id)).childCheck === "not_set_up" && (await hasBytes(early.id)) && !(await sees(asHost(host), early.id)) && !(await sees(admin.viewer, early.id)));
    await round(tool);
    check("the tool's clear answer frees them", (await pic(early.id)).childCheck === "clear" && !(await hasBytes(early.id)) && (await pic(early.id)).state === "refused");
    const sameAgain = await upload(host, fifth.id, 230);
    check("the same picture again is refused on the spot, and while the tool is on its bytes are kept for the tool all the same", sameAgain.state === "refused" && sameAgain.childCheck === "waiting" && (await hasBytes(sameAgain.id)) && !(await sees(asHost(host), sameAgain.id)));
    answers.set(sameAgain.sha256, "match");
    await round(tool);
    check("and a match on a refused picture locks it", (await pic(sameAgain.id)).state === "locked" && (await hasBytes(sameAgain.id)) && (await mails(admin.email, "matched the list")) === 2);
    answers.delete(sameAgain.sha256);
    says.openai = "clean";

    const third = await write(host, "A third post");
    const fresh3 = await upload(host, third.id, 221);
    await Pics.removePicture({ hostId: host.id, pictureId: fresh3.id, now: qnow() });
    answers.set(fresh3.sha256, "match");
    await round(tool);
    row = await pic(fresh3.id);
    check("a match always counts, also for a picture removed in between: it is locked and kept", row.state === "locked" && row.childCheck === "match" && (await hasBytes(fresh3.id)) && (await mails(admin.email, "matched the list")) === 3);

    const fourth = await write(host, "A fourth post");
    const late = await upload(host, fourth.id, 222);
    const slow: Tool = {
      ask: async () => {
        later(5);
        return "match";
      },
    };
    await round(slow);
    check("and however late: an answer that comes back after the round's time has run out still locks the picture", (await pic(late.id)).state === "locked" && (await hasBytes(late.id)));

    // A "clear" that comes in after a match changes nothing: the first asking runs over its time, a second one answers "match" meanwhile.
    const sixth = await write(host, "A sixth post");
    const twice = await upload(host, sixth.id, 223);
    let asks = 0;
    const overlapping: Tool = {
      ask: async () => {
        if (++asks > 1) return "match";
        later(5);
        await round(overlapping);
        return "clear";
      },
    };
    await round(overlapping);
    row = await pic(twice.id);
    check("a clear answer that comes in after a match does not take the match back", asks === 2 && row.state === "locked" && row.childCheck === "match" && (await hasBytes(twice.id)), { asks, state: row.state, childCheck: row.childCheck });

    // The round stops waiting for a slow tool, by the real clock, and its answer is still written when it comes.
    const seventh = await write(host, "A seventh post");
    const slowOne = await upload(host, seventh.id, 224);
    let answered = false;
    const dawdling: Tool = {
      ask: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        answered = true;
        return "match";
      },
    };
    await round(dawdling, 50);
    row = await pic(slowOne.id);
    check("a tool that takes longer than the round waits: the round goes on, the picture stays held and is not locked yet", !answered && row.state !== "locked" && row.claimId !== null && (await hasBytes(slowOne.id)));
    await until(() => answered);
    await new Promise((resolve) => setTimeout(resolve, 300));
    row = await pic(slowOne.id);
    check("its match, when it comes, still locks the picture and tells the founder", row.state === "locked" && row.childCheck === "match" && (await hasBytes(slowOne.id)));
    await db.update(schema.siteSwitches).set({ childCheckOnAt: null });
  });

  // ========================================================================
  journey("Connect's own checker for real, in its thread", async () => {
    const real = ownChecker();
    const one = await sharp(await file()).jpeg().toBuffer();
    const dots = Buffer.alloc(640 * 480 * 3);
    for (let i = 0; i < dots.length; i++) dots[i] = (i * 31 + ((i / 7) | 0) * 17 + ((i * i) % 251)) % 256;
    const two = await sharp(dots, { raw: { width: 640, height: 480, channels: 3 } }).jpeg().toBuffer();
    const valid = (answer: { kind: string }) => answer.kind === "clean" || answer.kind === "flagged";
    try {
      const started = Date.now();
      const first = await real.check(one);
      check("it starts in its thread and answers for a picture", valid(first), first);
      check("a plain picture of one colour is not taken for nudity", first.kind === "clean", first);
      console.log(`      (the thread was ready and answered in ${Date.now() - started} ms)`);
      for (let i = 0; i < 10; i++) await real.check(i % 2 ? one : two);
      const before = process.memoryUsage().rss;
      const from = Date.now();
      let allValid = true;
      for (let i = 0; i < 100; i++) allValid = valid(await real.check(i % 2 ? one : two)) && allValid;
      const each = (Date.now() - from) / 100;
      const grown = (process.memoryUsage().rss - before) / 1_048_576;
      console.log(`      (100 pictures: ${each.toFixed(0)} ms each, memory changed by ${grown.toFixed(0)} MB)`);
      check("a hundred pictures in a row are all answered, in well under a second each on average", allValid && each < 1000, each);
      check("and the helper's memory is not more than 80 MB larger afterwards", grown < 80, grown);
      const five = await Promise.all([one, two, one, two, one].map((jpeg) => real.check(jpeg)));
      check("pictures handed over together are all answered", five.every(valid));
      check("what is not a picture is a fault, not an answer", (await real.check(Buffer.from("not a picture"))).kind === "fault");
      check("and the thread goes on after it", valid(await real.check(one)));
      stopOwnChecker();
      check("after its thread was stopped, the way its idle timer stops it, it starts fresh for the next picture", valid(await real.check(one)));
      stopOwnChecker();
      const broken = await ownChecker("/nowhere/own-thread-start.mjs").check(one);
      check("a thread that cannot start is a fault: the picture waits", broken.kind === "fault" && /could not start/.test(broken.detail), broken);
      check("and the next picture gets a fresh thread", valid(await real.check(one)));
    } finally {
      stopOwnChecker();
    }
  });

  // ========================================================================
  journey("The two addresses, through the running app: uploading a picture, and fetching one", async () => {
    await fresh();
    const up = await fetch(`${BASE}/login`).catch(() => null);
    if (!up || up.status !== 200) throw new Error("The app is not running. Start it with `npm run dev` first.");
    // Attempt limits are per network address, and every request here comes from the same one.
    await db.delete(schema.rateLimit);

    type Jar = Map<string, string>;
    const cookieOf = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const keep = (response: Response, jar: Jar) => {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair, ...attributes] = cookie.split(";");
        const at = pair.indexOf("=");
        const value = pair.slice(at + 1);
        if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(pair.slice(0, at).trim());
        else jar.set(pair.slice(0, at).trim(), value);
      }
    };
    const auth = async (path: string, body: unknown, jar: Jar) => {
      const response = await fetch(`${BASE}/api/auth${path}`, { method: "POST", headers: { origin: BASE, "content-type": "application/json", cookie: cookieOf(jar) }, body: JSON.stringify(body), redirect: "manual" });
      keep(response, jar);
      return response.status;
    };
    /** Someone who signs up through the app itself, with a password made here, and is then let past the confirmation and welcome steps. */
    const signUp = async (kind: string) => {
      const who = { name: `Project check ${kind}`, email: `projectcheck-${RUN}-${kind}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
      await auth("/sign-up/email", { name: who.name, email: who.email, password: who.password, callbackURL: "/welcome" }, new Map());
      const [row] = await db.select().from(schema.user).where(eq(schema.user.email, who.email));
      if (!row) throw new Error("Signing up through the app did not make an account.");
      signedUp.push(row.id);
      people.push(row.id);
      const stamp = new Date();
      await db.update(schema.user).set({ emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
      const status = await auth("/sign-in/email", { email: who.email, password: who.password }, who.jar);
      if (status !== 200) throw new Error(`Logging in through the app answered ${status}.`);
      return { ...who, id: row.id };
    };
    const host = await signUp("host");
    const handle = `pc${RUN}web`;
    await db.insert(schema.hostProfiles).values({ userId: host.id, handle, handleKey: handle, displayName: "Host on the web", pricePer15Cents: 1000, status: "approved", usConfirmedAt: new Date() });
    await db.insert(schema.hostSettings).values({ userId: host.id, payoutsReady: true }).onConflictDoNothing();
    await start(host);
    const post = await write(host, "A post with pictures");
    const stranger = await signUp("stranger");

    const address = (postId: string) => `${BASE}/host/project/posts/${postId}/pictures`;
    const form = async (parts: Array<[string, Buffer | string]>) => {
      const data = new FormData();
      for (const [name, value] of parts) {
        if (typeof value === "string") data.append(name, value);
        else data.append(name, new Blob([new Uint8Array(value)], { type: "image/png" }), "picture.png");
      }
      return data;
    };
    type Sent = { status: number; to: string; says: string };
    const send = async (postId: string, body: BodyInit, more: { jar?: Jar; headers?: Record<string, string>; duplex?: boolean } = {}): Promise<Sent> => {
      const response = await fetch(address(postId), { method: "POST", headers: { origin: BASE, cookie: cookieOf(more.jar ?? host.jar), ...more.headers }, body, redirect: "manual", ...(more.duplex ? { duplex: "half" } : {}) } as RequestInit);
      const location = response.headers.get("location") ?? "";
      const text = await response.text();
      return { status: response.status, to: location.split("?")[0], says: location.includes("notice=") ? (new URL(location, BASE).searchParams.get("notice") ?? "") : text };
    };
    const stored = async (postId: string) => (await db.select({ id: pictures.id }).from(pictures).where(eq(pictures.postId, postId))).length;
    const page = `/host/project/posts/${post.id}`;

    const good = await send(post.id, await form([["picture", await file()]]));
    check("a host adds a picture through the app: she is sent back to her post with a sentence, and it is stored as waiting", good.status === 303 && good.to === page && /Your picture was added/.test(good.says) && (await stored(post.id)) === 1, good);
    const [added] = await db.select().from(pictures).where(eq(pictures.postId, post.id));

    const outside = await fetch(address(post.id), { method: "POST", headers: { cookie: cookieOf(host.jar), "sec-fetch-site": "cross-site", origin: "https://elsewhere.example" }, body: await form([["picture", await file()]]), redirect: "manual" });
    check("an upload sent from another website through her browser is refused", outside.status === 403 && (await stored(post.id)) === 1);
    const nobody = await send(post.id, await form([["picture", await file()]]), { jar: new Map() });
    check("someone who is not logged in is sent to log in", nobody.status === 303 && nobody.to === "/login" && (await stored(post.id)) === 1, nobody);
    const notHers = await send(post.id, await form([["picture", await file()]]), { jar: stranger.jar });
    check("someone else's post is \"not found\"", notHers.status === 404 && (await stored(post.id)) === 1, notHers);
    await db.update(schema.user).set({ pausedAt: new Date(), pausedReason: "check" }).where(eq(schema.user.id, host.id));
    const paused = await send(post.id, await form([["picture", await file()]]));
    await db.update(schema.user).set({ pausedAt: null, pausedReason: null }).where(eq(schema.user.id, host.id));
    check("a paused host is sent to the page about the pause", paused.status === 303 && paused.to === "/paused" && (await stored(post.id)) === 1, paused);

    const two = await send(post.id, await form([["picture", await file()], ["picture", await file()]]));
    check("two files in one form are refused", two.status === 303 && /choose one picture/.test(two.says) && (await stored(post.id)) === 1, two);
    const extra = await send(post.id, await form([["picture", await file()], ["postId", NOTHING]]));
    check("so is anything else beside the file", extra.status === 303 && /choose one picture/.test(extra.says) && (await stored(post.id)) === 1, extra);
    const plain = await send(post.id, "picture=hello", { headers: { "content-type": "application/x-www-form-urlencoded" } });
    check("and what is not a file form at all", plain.status === 303 && /choose a picture/.test(plain.says), plain);
    const text = await send(post.id, await form([["picture", Buffer.from("just words, called a picture")]]));
    check("a file that is not a picture is refused in words for the host", text.status === 303 && /JPEG, PNG or WebP/.test(text.says) && (await stored(post.id)) === 1, text);

    const limit = PICTURE.uploadMaxBytes + PICTURE.formOverheadBytes;
    const boundary = "check-boundary";
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="picture"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const tooBig = Buffer.concat([head, Buffer.alloc(limit + 1024, 7), tail]);
    const statedBig = await send(post.id, tooBig, { headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }).catch((error) => ({ status: 0, to: "", says: String(error) }));
    check("a request that says it is over the limit is refused before it is read", statedBig.status === 303 && /up to 10 MB/.test(statedBig.says), statedBig);
    // No length stated: the request is sent in pieces, and only the reading can find out.
    const pieces = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < tooBig.length; at += 256 * 1024) controller.enqueue(new Uint8Array(tooBig.subarray(at, at + 256 * 1024)));
        controller.close();
      },
    });
    const unstated = await send(post.id, pieces, { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, duplex: true }).catch((error) => ({ status: 0, to: "", says: String(error) }));
    check("a request without a stated length is cut off while it is read, once it is over the limit", unstated.status === 303 && /up to 10 MB/.test(unstated.says), unstated);
    const elevenMb = Buffer.concat([head, Buffer.alloc(PICTURE.uploadMaxBytes + 1, 7), tail]);
    const fileTooBig = await send(post.id, elevenMb, { headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    check("a file a little over 10 MB inside an allowed request is refused too", fileTooBig.status === 303 && /up to 10 MB/.test(fileTooBig.says), fileTooBig);
    // Sent by hand, byte for byte, to say what a browser would not: a length that is not the real one.
    const whole = Buffer.concat([head, await file(), tail]);
    const byHand = (stated: number, body: Buffer) =>
      new Promise<string>((resolve, reject) => {
        const socket = net.connect(3000, "localhost", () => {
          socket.write(`POST /host/project/posts/${post.id}/pictures HTTP/1.1\r\nHost: localhost:3000\r\nOrigin: ${BASE}\r\nCookie: ${cookieOf(host.jar)}\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${stated}\r\nConnection: close\r\n\r\n`);
          socket.write(body);
        });
        let answer = "";
        socket.on("data", (chunk) => (answer += chunk.toString("latin1")));
        socket.on("close", () => resolve(answer));
        socket.on("error", reject);
        setTimeout(() => resolve(answer), 10_000);
      });
    const lie = await byHand(head.length + 20, whole);
    check("a request that says it is shorter than it is gets a refusal, and nothing is stored", /^HTTP\/1\.1 (303|400)/.test(lie) && (await stored(post.id)) === 1, lie.slice(0, 200));
    const cut = await byHand(head.length + 20, whole.subarray(0, head.length + 20));
    check("a form that arrives cut short is refused in words for the host", /^HTTP\/1\.1 303/.test(cut) && /could%20not%20be%20read|choose%20one%20picture|JPEG%2C%20PNG/.test(cut) && (await stored(post.id)) === 1, cut.slice(0, 300));
    check("after all of these, one picture is stored for the post", (await stored(post.id)) === 1);

    const crowd = await write(host, "Five at once");
    const five = await Promise.all((await Promise.all([1, 2, 3, 4, 5].map(async () => form([["picture", await file()]])))).map((data) => send(crowd.id, data)));
    const went = five.filter((r) => /Your picture was added/.test(r.says)).length;
    check("five uploads at the same moment: each is answered, one picture is worked on at a time, and no more are stored than went through", five.every((r) => r.status === 303 && (/Your picture was added/.test(r.says) || /try again in a moment/.test(r.says) || /up to 4 pictures/.test(r.says))) && went >= 1 && went <= 4 && (await stored(crowd.id)) === went, five.map((r) => r.says));
    for (let i = 0; i < 6 && (await stored(crowd.id)) < 4; i++) await send(crowd.id, await form([["picture", await file()]]));
    const fifth = await send(crowd.id, await form([["picture", await file()]]));
    check("a post takes four, and the fifth is told so", (await stored(crowd.id)) === 4 && /up to 4 pictures/.test(fifth.says), fifth);

    // Fetching.
    const get = async (id: string, jar: Jar | null, headers: Record<string, string> = {}) => {
      const response = await fetch(`${BASE}/pictures/${id}`, { headers: { ...(jar ? { cookie: cookieOf(jar) } : {}), ...headers }, redirect: "manual" });
      const body = Buffer.from(await response.arrayBuffer());
      return { status: response.status, type: response.headers.get("content-type") ?? "", cache: response.headers.get("cache-control") ?? "", sniff: response.headers.get("x-content-type-options"), policy: response.headers.get("content-security-policy") ?? "", validators: [response.headers.get("etag"), response.headers.get("last-modified")].filter(Boolean), body };
    };
    const [kept] = await db.select().from(files).where(eq(files.pictureId, added.id));
    const hers = await get(added.id, host.jar);
    check("while it waits, its host gets the picture at its address: the JPEG itself, never to be kept by a browser", hers.status === 200 && hers.type === "image/jpeg" && hers.body.equals(kept.bytes) && hers.cache === "no-store", { ...hers, body: hers.body.length });
    check("the answer tells the browser not to guess its kind, lets nothing in it run, and carries nothing to ask \"is it still the same\" with", hers.sniff === "nosniff" && /default-src 'none'/.test(hers.policy) && /sandbox/.test(hers.policy) && hers.validators.length === 0, hers.validators);
    const theirs = [await get(added.id, null), await get(added.id, stranger.jar)];
    check("a visitor and a logged-in stranger get \"not found\", which is not kept either", theirs.every((r) => r.status === 404 && r.cache === "no-store" && !r.body.equals(kept.bytes)), theirs.map((r) => r.status));
    // The pictures of the other post stay waiting: one of them is fetched below.
    // (The app stored these by the real clock, which has moved on since this journey set the script's.)
    qclock = Date.now();
    await db.update(pictures).set({ nextTryAt: new Date(qclock + 60 * MIN) }).where(eq(pictures.postId, crowd.id));
    await round();
    const open = await get(added.id, null);
    check("once it is shown, a visitor gets it, to be kept by their own browser for five minutes and by nobody in between", (await pic(added.id)).state === "shown" && open.status === 200 && open.body.equals(kept.bytes) && open.cache === "private, max-age=300" && open.validators.length === 0, { status: open.status, cache: open.cache });
    const shrunk = await fetch(`${BASE}/_next/image?url=${encodeURIComponent(`/pictures/${added.id}`)}&w=640&q=75`);
    check("the framework's own address for making and keeping smaller copies refuses a diary picture, also a shown one", shrunk.status === 400, shrunk.status);
    const asked304 = await get(added.id, null, { "if-none-match": "*", "if-modified-since": new Date().toUTCString() });
    check("the address never answers \"you already have it\": every fetch is decided afresh", asked304.status === 200 && asked304.body.equals(kept.bytes));
    const bad = [await get("nonsense", host.jar), await get(NOTHING, host.jar)];
    check("an address that names no picture is \"not found\"", bad.every((r) => r.status === 404));

    const waiting = (await db.select().from(pictures).where(and(eq(pictures.postId, crowd.id), eq(pictures.state, "waiting"))))[0];
    check("(a waiting picture its host can fetch)", (await get(waiting.id, host.jar)).status === 200);
    const oldJar = new Map(host.jar);
    await auth("/sign-out", {}, host.jar);
    check("right after she logs out, the same browser no longer gets it", (await get(waiting.id, oldJar)).status === 404 && (await get(waiting.id, host.jar)).status === 404);

    const diary = await (await fetch(`${BASE}/h/${handle}/project`)).text();
    check("the diary shows the shown picture from its address, and none of the waiting ones", diary.includes(`/pictures/${added.id}`) && !diary.includes(`/pictures/${waiting.id}`));
  });

  // ========================================================================
  journey("Who can reach what, as far as the source text shows: which files use this code, and how each action begins", async () => {
    const uses: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (/projects\/(projects|posts|pictures|moderation|picture-steps|queue|child-safety|checks\/[\w-]+)["']/.test(text)) uses.push({ path, text });
        }
      }
    };
    walk("src/app");
    const hostsOwn = ["src/app/host/page.tsx", "src/app/host/project/actions.ts", "src/app/host/project/page.tsx", "src/app/host/project/posts/[id]/page.tsx", "src/app/host/project/posts/[id]/pictures/route.ts"];
    const readersOwn = ["src/app/h/[handle]/page.tsx", "src/app/h/[handle]/project/diary.tsx", "src/app/pictures/[id]/route.ts"];
    const foundersOwn = ["src/app/admin/projects/actions.ts", "src/app/admin/projects/page.tsx"];
    const expected = [...hostsOwn, ...readersOwn, ...foundersOwn];
    const elsewhere = uses.filter((file) => !expected.includes(file.path)).map((file) => file.path);
    check("only the host's, the reader's and the founder's pages and the two picture addresses reach the code of projects, posts and pictures", elsewhere.length === 0 && uses.length === expected.length, { elsewhere, found: uses.map((file) => file.path) });

    const actionsOf = (file: { text: string }) => file.text.split(/^export async function /m).slice(1);
    const hostActions = uses.find((file) => file.path === "src/app/host/project/actions.ts");
    const writes = /\b(startProject|changeProject|writePost|changePost)\(/;
    const tidies = /\b(endProject|removePost|removePicture)\(/;
    const host = hostActions ? actionsOf(hostActions) : [];
    const asksActive = (action: string) => /const user = await requireActiveUser\(/.test(action);
    const asksSignedIn = (action: string) => /const user = await requireUser\(/.test(action);
    // Starting and changing a project send a paused account to the page about the pause. The two actions of the post form
    // refuse a paused account in the form itself, before anything is written, so that a draft is kept.
    const refusesPaused = (action: string) => asksSignedIn(action) && /if \(user\.paused\) return refused\(PAUSED, formData\);\n  try \{/.test(action);
    check("each of the host's four writing actions asks for a signed-in account that is not paused", host.filter((a) => writes.test(a)).length === 4 && host.filter((a) => /\b(startProject|changeProject)\(/.test(a)).every(asksActive) && host.filter((a) => /\b(writePost|changePost)\(/.test(a)).every(refusesPaused), host.map((a) => a.split("(")[0]));
    check("ending a project, removing a post and removing a picture ask who is signed in, and work for a paused host too", host.filter((a) => tidies.test(a)).length === 3 && host.filter((a) => tidies.test(a)).every(asksSignedIn));
    const named = /\b(changeProject|endProject|writePost)\(/;
    check("the three forms that change a project name the project they were drawn for", host.filter((a) => named.test(a)).length === 3 && host.filter((a) => named.test(a)).every((a) => /projectId: projectOf\(formData\)/.test(a)));
    const hostPage = uses.find((file) => file.path === "src/app/host/project/page.tsx")?.text ?? "";
    check("and the page puts that id into each of the three forms", (hostPage.match(/<input type="hidden" name="projectId" value=\{running\.id\} \/>/g) ?? []).length === 2 && (hostPage.match(/<PostForm action=\{writePostAction\} hidden=\{\{ name: "projectId", value: running\.id \}\}/g) ?? []).length === 1);
    const postActions = host.filter((a) => /\b(writePost|changePost)\(/.test(a));
    check("the two actions of the post form answer a refusal with what was typed, and never send the browser on with it", postActions.length === 2 && postActions.every((a) => /return refused\(error, formData\);/.test(a) && !/redirect\(/.test(a)) && /function refused\(error: unknown, formData: FormData\): PostFormState \{\n  return \{ error: problem\(error\), text: String\(formData\.get\("text"\) \?\? ""\), links: linksOf\(formData\) \};/.test(hostActions?.text ?? ""));
    check("no host action takes the host from the form: always from the login", host.length === 7 && host.every((a) => /hostId: user\.id/.test(a)) && !/formData\.get\("hostId"\)/.test(hostActions?.text ?? "x"));
    const adminActions = uses.find((file) => file.path === "src/app/admin/projects/actions.ts");
    const admin = adminActions ? actionsOf(adminActions) : [];
    check("the founder's switch and its line in the record are saved in one step", (adminActions?.text.match(/await db\.transaction\(async \(tx\) => \{\n\s+await setSwitches\(\{[^}]*\}, tx\);\n\s+await recordAdminAction\(\{[^}]*\}, tx\);\n\s+\}\);/g) ?? []).length === 2 && !/await setSwitches\(\{[^}]*\}\);/.test(adminActions?.text ?? ""));
    check("each of the founder's actions asks for the founder's login first", admin.length === 8 && admin.every((a) => /^\w+\(formData: FormData\) \{\n  const admin = await requireAdmin\(\);/.test(a)), admin.map((a) => a.split("(")[0]));
    // "Starting is an action; loading is only reading": nothing that is drawn on opening a page may write.
    const writing = /import \{[^}]*\b(startProject|changeProject|endProject|endProjectInStep|writePost|changePost|removePost|hidePost|showPost|acceptUpload|removePicture|removePictureAsFounder|lockAndReport|setSuspected|recordReportMade)\b[^}]*\} from "@\/lib\/projects/;
    // An address that only answers a form that was sent (POST) is an action, not a page being opened.
    const onlyAnswersForms = (file: { path: string; text: string }) => file.path.endsWith("/route.ts") && /export async function POST\(/.test(file.text) && !/export async function GET\(/.test(file.text);
    const pagesThatWrite = uses.filter((file) => !file.text.startsWith("\"use server\"") && !onlyAnswersForms(file) && writing.test(file.text)).map((file) => file.path);
    check("no page that is only being opened can start, change, end, write, upload, remove, hide, show or lock anything", pagesThatWrite.length === 0, pagesThatWrite);

    // Pictures.
    const uploadRoute = readFileSync("src/app/host/project/posts/[id]/pictures/route.ts", "utf8");
    const steps = ["if (!fromThisSite(request.headers))", "const user = await getUser();", "if (user.paused)", "await postForHost(user.id, id)", "request.headers.get(\"content-length\")", "if (!takePlace())", "await readWithin(request, REQUEST_MAX)", "await acceptUpload({ hostId: user.id"].map((step) => uploadRoute.indexOf(step));
    check("the upload address checks, in this order: our own page, the login, the pause, her own post, the stated size, the one place; only then does it read, and the host comes from the login", steps.every((at, i) => at > 0 && (i === 0 || at > steps[i - 1])) && /\} finally \{\n    givePlace\(\);/.test(uploadRoute), steps);
    const pictureRoute = readFileSync("src/app/pictures/[id]/route.ts", "utf8");
    check("the picture's address hands out nothing but what pictureFor gives it", /const found = await pictureFor\(/.test(pictureRoute) && !/projectPictureFiles/.test(pictureRoute));
    const inApp: string[] = [];
    const heavy: string[] = [];
    const look = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) look(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (/projectPictureFiles/.test(text)) inApp.push(path);
          if (/projects\/queue["']|checks\/own|nsfwjs|tensorflow/.test(text)) heavy.push(path);
        }
      }
    };
    look("src/app");
    look("src/components");
    check("no page reads a picture's bytes itself", inApp.length === 0, inApp);
    check("no page loads the checking queue or Connect's own checker: only the always-on helper does", heavy.length === 0 && /await import\("\.\.\/src\/lib\/projects\/queue"\)/.test(readFileSync("worker/closer.ts", "utf8")), heavy);
    const moderation = readFileSync("src/lib/projects/moderation.ts", "utf8");
    check("the code of each of the founder's four decisions about a picture has its line for the record, written with the same database step", (moderation.match(/^    await recordAdminAction\(\{.*\}, tx\);$/gm) ?? []).length === 4);
    const report = readFileSync("src/lib/safety/reports.ts", "utf8");
    check("the report code blocks for a person and not for a post, in one place", (report.match(/await block\(/g) ?? []).length === 1 && /if \(input\.context !== "post"\) await block\(/.test(report));
  });

  // ------------------------------------------------------------------------
  if (only && (only.length === 0 || only.some((n) => !Number.isInteger(n) || n < 1 || n > journeys.length))) throw new Error(`--only takes journey numbers from 1 to ${journeys.length}.`);
  // This script sets the founder's projects switch. Whatever position it finds is remembered here and put back at the
  // end; its journeys start from "on for everyone", the position the feature has unless the founder says otherwise.
  const before = await switches();
  // The same for what the picture journeys set: the lines about the checking services, and the moment the child-safety tool was switched on.
  const checkersBefore = await db.select().from(schema.pictureCheckers);
  const [toolBefore] = await db.select({ at: schema.siteSwitches.childCheckOnAt }).from(schema.siteSwitches);
  console.log(`(The founder's projects switch is "${before.projects}"${before.projectsHosts.length > 0 ? ` with ${before.projectsHosts.length} named` : ""}; it is put back at the end.)`);
  try {
    for (const [index, [title, run]] of journeys.entries()) {
      if (only && !only.includes(index + 1)) continue;
      console.log(`\n${index + 1}. ${title}`);
      await setSwitches({ projects: "everyone", projectsHosts: [] });
      try {
        await run();
      } catch (error) {
        check("the journey ran to its end", false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
      }
    }
  } finally {
    stopOwnChecker();
    await setSwitches({ projects: before.projects, projectsHosts: before.projectsHosts });
    await db.delete(schema.pictureCheckers);
    if (checkersBefore.length > 0) await db.insert(schema.pictureCheckers).values(checkersBefore);
    await db.update(schema.siteSwitches).set({ childCheckOnAt: toolBefore?.at ?? null });
    await wipe();
  }
  const afterwards = await switches();
  check("afterwards: the founder's projects switch is as it was before the script, with the same hosts named", afterwards.projects === before.projects && afterwards.projectsHosts.join(",") === before.projectsHosts.join(","));
  const [toolAfter] = await db.select({ at: schema.siteSwitches.childCheckOnAt }).from(schema.siteSwitches);
  check("afterwards: the lines about the checking services and the child-safety tool's switch are as they were", JSON.stringify(await db.select().from(schema.pictureCheckers)) === JSON.stringify(checkersBefore) && (toolAfter?.at?.getTime() ?? null) === (toolBefore?.at?.getTime() ?? null));
  check("afterwards: nothing this run made is left", (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `pc-${RUN}-%`))).length === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
