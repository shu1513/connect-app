/**
 * Testing tool: plays hosts, a visitor and the founder through a project and its diary, against
 * the local database, and checks every result. Part 1a (plans/24): the project, its posts with
 * text and YouTube links, who can read what, reports of a post, the founder's page and switch.
 * No money and no pictures yet.
 *
 * It works on this computer's test database only, makes its own people (their ids start "pc-"),
 * sets the founder's projects switch for its journeys, and at the end puts the switch back as it
 * found it and removes everything it made.
 *
 * Usage: npx tsx scripts/project-check.ts            (everything)
 *        npx tsx scripts/project-check.ts --only=4   (one journey)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { and, eq, inArray, like, or } from "drizzle-orm";
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
  const { ProjectError, PROJECT, linksOf } = await import("../src/lib/projects/rules");
  const { publicProfile } = await import("../src/lib/profiles/profiles");
  const { createReport, ReportError } = await import("../src/lib/safety/reports");
  const { projectsOnFor, setSwitches, switches } = await import("../src/lib/safety/switches");

  const RUN = randomUUID().slice(0, 8);
  const MIN = 60_000;
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",").map(Number);
  type Person = { id: string; name: string; email: string; handle?: string };
  let made = 0;
  const VIDEO = "dQw4w9WgXcQ";

  // ------------------------------------------------------------------------
  // Making people
  // ------------------------------------------------------------------------
  async function person(kind: string): Promise<Person> {
    const id = `pc-${RUN}-${++made}-${kind}`;
    const stamp = new Date();
    const row = { id, name: `Project check ${kind} ${made}`, email: `projectcheck-${RUN}-${made}@example.test` };
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
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
    const mine = like(schema.user.id, `pc-${RUN}-%`);
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(mine)).map((row) => row.id);
    if (ids.length === 0) return;
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.adminActions).where(or(inArray(schema.adminActions.adminId, ids), inArray(schema.adminActions.targetUserId, ids)));
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    if (projectIds.length > 0) await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.hostId, ids));
    await db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.user).where(mine);
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
    check("the founder's lists have it under hidden, and not among the newest", lists.hidden.some((e) => e.post.id === bad.id && e.handle === host.handle) && lists.latest.every((e) => e.post.id !== bad.id) && lists.latest.some((e) => e.post.id === kept.id));
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

  // ========================================================================
  journey("Who can reach what: only the pages meant to, each asking who is signed in", async () => {
    const uses: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (/projects\/(projects|posts)["']/.test(text)) uses.push({ path, text });
        }
      }
    };
    walk("src/app");
    const hostsOwn = ["src/app/host/page.tsx", "src/app/host/project/actions.ts", "src/app/host/project/page.tsx", "src/app/host/project/posts/[id]/page.tsx"];
    const readersOwn = ["src/app/h/[handle]/page.tsx", "src/app/h/[handle]/project/diary.tsx"];
    const foundersOwn = ["src/app/admin/projects/actions.ts", "src/app/admin/projects/page.tsx"];
    const expected = [...hostsOwn, ...readersOwn, ...foundersOwn];
    const elsewhere = uses.filter((file) => !expected.includes(file.path)).map((file) => file.path);
    check("only the host's, the reader's and the founder's pages reach the code of projects and posts", elsewhere.length === 0 && uses.length === expected.length, { elsewhere, found: uses.map((file) => file.path) });

    const actionsOf = (file: { text: string }) => file.text.split(/^export async function /m).slice(1);
    const hostActions = uses.find((file) => file.path === "src/app/host/project/actions.ts");
    const writes = /\b(startProject|changeProject|writePost|changePost)\(/;
    const tidies = /\b(endProject|removePost)\(/;
    const host = hostActions ? actionsOf(hostActions) : [];
    const asksActive = (action: string) => /const user = await requireActiveUser\(/.test(action);
    const asksSignedIn = (action: string) => /const user = await requireUser\(/.test(action);
    check("each of the host's four writing actions asks for a signed-in account that is not paused", host.filter((a) => writes.test(a)).length === 4 && host.filter((a) => writes.test(a)).every(asksActive), host.map((a) => a.split("(")[0]));
    check("ending a project and removing a post ask who is signed in, and work for a paused host too", host.filter((a) => tidies.test(a)).length === 2 && host.filter((a) => tidies.test(a)).every(asksSignedIn));
    const named = /\b(changeProject|endProject|writePost)\(/;
    check("the three forms that change a project name the project they were drawn for", host.filter((a) => named.test(a)).length === 3 && host.filter((a) => named.test(a)).every((a) => /projectId: projectOf\(formData\)/.test(a)));
    const hostPage = uses.find((file) => file.path === "src/app/host/project/page.tsx")?.text ?? "";
    check("and the page puts that id into each of the three forms", (hostPage.match(/<input type="hidden" name="projectId" value=\{running\.id\} \/>/g) ?? []).length === 2 && (hostPage.match(/<PostForm action=\{writePostAction\} hidden=\{\{ name: "projectId", value: running\.id \}\}/g) ?? []).length === 1);
    const postActions = host.filter((a) => /\b(writePost|changePost)\(/.test(a));
    check("the two actions of the post form answer a refusal with what was typed, and never send the browser on with it", postActions.length === 2 && postActions.every((a) => /return refused\(error, formData\);/.test(a) && !/redirect\(/.test(a)) && /function refused\(error: unknown, formData: FormData\): PostFormState \{\n  return \{ error: problem\(error\), text: String\(formData\.get\("text"\) \?\? ""\), links: linksOf\(formData\) \};/.test(hostActions?.text ?? ""));
    check("no host action takes the host from the form: always from the login", host.length === 6 && host.every((a) => /hostId: user\.id/.test(a)) && !/formData\.get\("hostId"\)/.test(hostActions?.text ?? "x"));
    const adminActions = uses.find((file) => file.path === "src/app/admin/projects/actions.ts");
    const admin = adminActions ? actionsOf(adminActions) : [];
    check("each of the founder's actions asks for the founder's login first", admin.length === 3 && admin.every((a) => /^\w+\(formData: FormData\) \{\n  const admin = await requireAdmin\(\);/.test(a)), admin.map((a) => a.split("(")[0]));
    // "Starting is an action; loading is only reading": nothing that is drawn on opening a page may write.
    const writing = /import \{[^}]*\b(startProject|changeProject|endProject|endProjectInStep|writePost|changePost|removePost|hidePost|showPost)\b[^}]*\} from "@\/lib\/projects/;
    const pagesThatWrite = uses.filter((file) => !file.text.startsWith("\"use server\"") && writing.test(file.text)).map((file) => file.path);
    check("no page that is only being opened can start, change, end, write, remove, hide or show anything", pagesThatWrite.length === 0, pagesThatWrite);
    const report = readFileSync("src/lib/safety/reports.ts", "utf8");
    check("the report code blocks for a person and not for a post, in one place", (report.match(/await block\(/g) ?? []).length === 1 && /if \(input\.context !== "post"\) await block\(/.test(report));
  });

  // ------------------------------------------------------------------------
  if (only && (only.length === 0 || only.some((n) => !Number.isInteger(n) || n < 1 || n > journeys.length))) throw new Error(`--only takes journey numbers from 1 to ${journeys.length}.`);
  // This script sets the founder's projects switch. Whatever position it finds is remembered here and put back at the
  // end; its journeys start from "on for everyone", the position the feature has unless the founder says otherwise.
  const before = await switches();
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
    await setSwitches({ projects: before.projects, projectsHosts: before.projectsHosts });
    await wipe();
  }
  const afterwards = await switches();
  check("afterwards: the founder's projects switch is as it was before the script, with the same hosts named", afterwards.projects === before.projects && afterwards.projectsHosts.join(",") === before.projectsHosts.join(","));
  check("afterwards: nothing this run made is left", (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `pc-${RUN}-%`))).length === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
