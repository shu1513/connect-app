/**
 * Emails to followers (plans/31): "Anna is available now" and "Anna wrote in her diary", each
 * only to a follower who said yes for that host and that kind.
 *
 * Every email is written by one small step for one follower (`tellFollower`), under the lock
 * named after the follower, with everything asked again inside the step. So the limits hold
 * whatever else is running, and a yes that is taken back at the same moment either comes first
 * (nothing is written) or second (what was written is dropped).
 *
 * The whole of it is switched off while there is no postal address for the last line of these
 * emails (`followEmailsOn`): then nothing is written, and nothing that exists is sent.
 *
 * The emails carry the host's name and nothing a host wrote.
 */
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { instantOffer } from "@/lib/booking/bookings";
import { whenFor } from "@/lib/booking/emails";
import { queueEmail } from "@/lib/email";
import { isUnsubscribeToken, unsubscribeHeaders, unsubscribeTokenFor, unsubscribeUrl } from "@/lib/notifications/unsubscribe";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { dropWaiting, FollowError, lockFollowers } from "./follows";
import { EMAILS, followEmailsAddress, followEmailsOn, insideHours } from "./rules";

type Reader = Pick<typeof db, "select">;
type Kind = "online" | "post";

const HOUR = 3_600_000;
const MINUTE = 60_000;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

const pair = (followerId: string, hostId: string) => and(eq(schema.follows.followerId, followerId), eq(schema.follows.hostId, hostId));
const addressOf = (email: string) => email.trim().toLowerCase();

type Standing =
  | { problem: string }
  | {
      problem: null;
      line: typeof schema.follows.$inferSelect;
      follower: { id: string; name: string; email: string; timeZone: string | null; unsubscribeToken: string | null };
      host: { displayName: string; handle: string };
    };

/**
 * Whether an email of this kind about this host may go to this follower right now, as far as the
 * two people and their choices go. Asked when an email is written and again right before it is
 * sent; the words of a problem are what the outbox shows for an email that was dropped.
 */
async function standingOf(reader: Reader, followerId: string, hostId: string, kind: Kind): Promise<Standing> {
  if (!followEmailsOn()) return { problem: "emails to followers are switched off" };
  const [line] = await reader.select().from(schema.follows).where(pair(followerId, hostId));
  if (!line || line.unfollowedAt) return { problem: "they no longer follow this host" };
  if (kind === "online" ? !line.tellOnline : !line.tellPosts) return { problem: "they no longer ask for this email" };
  const [follower] = await reader
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
      timeZone: schema.user.timeZone,
      closedAt: schema.user.closedAt,
      pausedAt: schema.user.pausedAt,
      followEmails: schema.user.followEmails,
      unsubscribeToken: schema.user.unsubscribeToken,
    })
    .from(schema.user)
    .where(eq(schema.user.id, followerId));
  if (!follower || follower.closedAt) return { problem: "the account is closed" };
  if (follower.pausedAt) return { problem: "the account is paused" };
  if (!follower.emailVerified) return { problem: "the address is not confirmed" };
  if (!follower.followEmails) return { problem: "they switched emails about hosts off" };
  const [host] = await reader
    .select({ displayName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle, status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden, closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .where(eq(schema.hostProfiles.userId, hostId));
  if (!host || host.closedAt || host.status !== "approved" || host.hidden) return { problem: "the host's page is not open to everyone" };
  if (host.pausedAt) return { problem: "the host is paused" };
  const [block] = await reader
    .select({ blockerId: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(or(and(eq(schema.blocks.blockerId, followerId), eq(schema.blocks.blockedId, hostId)), and(eq(schema.blocks.blockerId, hostId), eq(schema.blocks.blockedId, followerId))))
    .limit(1);
  if (block) return { problem: "one of the two has blocked the other" };
  return { problem: null, line, follower, host: { displayName: host.displayName, handle: host.handle } };
}

/** The last lines of every one of these emails: who sends it, why they get it, and the two ways to stop. */
function footer(person: { id: string; unsubscribeToken: string | null }, hostName: string): string {
  return [
    "—",
    `Connect · ${followEmailsAddress()} · questions: ${SUPPORT_EMAIL}`,
    `You get this email because you follow ${hostName} and asked for it. To choose your emails for each host: ${appUrl()}/following`,
    `To stop all emails about hosts you follow: ${unsubscribeUrl(person, "follows")}`,
  ].join("\n");
}

type Words = (to: { name: string; timeZone: string | null }, host: { displayName: string; handle: string }) => { subject: string; lines: string[] };

/**
 * Writes one email to one follower, if everything still holds at this moment. One step, under
 * the follower's lock: the follow and its tick, both accounts, blocks, the 20 hours for this
 * host, the 5 in 24 hours for this follower, and for "available now" the follower's hours and
 * that the announcement is still the one this round began with. Returns whether it was written.
 */
async function tellFollower(input: { kind: Kind; followerId: string; hostId: string; key: string; expiresAt: Date; now: Date; /** "available now" only: the announcement being made. */ announceAt?: Date; /** The diary email only: the post it is about. */ postId?: string; words: Words }): Promise<boolean> {
  const { kind, followerId, hostId, now } = input;
  // The secret of the stop link is made before the step (its own small write), so the step only reads it.
  await unsubscribeTokenFor(followerId);
  return db.transaction(async (tx) => {
    await lockFollowers(tx, [followerId]);
    const standing = await standingOf(tx, followerId, hostId, kind);
    if (standing.problem !== null) return false;
    const { line, follower, host } = standing;
    const told = kind === "online" ? line.toldOnlineAt : line.toldPostAt;
    if (told && told.getTime() > now.getTime() - EMAILS.perHostHours * HOUR) return false;
    if (kind === "online") {
      if (!insideHours(now, follower.timeZone, line.hoursFrom, line.hoursTo)) return false;
      // A host who switched off and on again meanwhile has a new announcement, with a minute's wait of its own.
      const [calendar] = await tx.select({ announceAt: schema.hostCalendars.announceAt }).from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hostId));
      if (!calendar?.announceAt || calendar.announceAt.getTime() !== input.announceAt?.getTime()) return false;
    } else {
      // The post is looked at again for each follower: one that was removed or hidden while the round was under way
      // must not use up anyone's email of the day, or their one diary email about this host.
      const [post] = await tx
        .select({ removedAt: schema.projectPosts.removedAt, hiddenAt: schema.projectPosts.hiddenAt, status: schema.projects.status })
        .from(schema.projectPosts)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
        .where(and(eq(schema.projectPosts.id, input.postId ?? ""), eq(schema.projects.hostId, hostId)));
      if (!post || post.removedAt || post.hiddenAt || post.status !== "running") return false;
    }
    const [{ written }] = await tx
      .select({ written: sql<number>`count(*)::int` })
      .from(schema.emailOutbox)
      .where(and(eq(schema.emailOutbox.to, addressOf(follower.email)), eq(schema.emailOutbox.kind, "follow"), gt(schema.emailOutbox.createdAt, new Date(now.getTime() - 24 * HOUR))));
    if (written >= EMAILS.perDay) return false;
    const { subject, lines } = input.words(follower, host);
    await queueEmail(tx, {
      to: follower.email,
      kind: "follow",
      subject,
      text: [`Hi ${follower.name},`, "", ...lines, "", footer(follower, host.displayName)].join("\n"),
      key: input.key,
      expiresAt: input.expiresAt,
      headers: unsubscribeHeaders(follower, "follows"),
    });
    await tx.update(schema.follows).set(kind === "online" ? { toldOnlineAt: now } : { toldPostAt: now }).where(pair(followerId, hostId));
    return true;
  });
}

/** The followers of a host who have this kind ticked. Everything else about each is asked in `tellFollower`. */
async function askedFor(hostId: string, kind: Kind): Promise<string[]> {
  const rows = await db
    .select({ followerId: schema.follows.followerId })
    .from(schema.follows)
    .where(and(eq(schema.follows.hostId, hostId), isNull(schema.follows.unfollowedAt), eq(kind === "online" ? schema.follows.tellOnline : schema.follows.tellPosts, true)));
  return rows.map((row) => row.followerId);
}

/**
 * The helper's round for "available now": every host whose minute's wait is over is told to the
 * followers who asked, if their own page would still show them as available. The calendar is
 * read and never held (the host's page says "still here" every few seconds under its lock). At
 * the end the announcement is emptied only if it is still the one that was read, so one that a
 * host set meanwhile is not lost. A round that stops halfway, or in which writing to a follower
 * failed, leaves the announcement as it is and is simply made again: whoever was told is skipped
 * by the 20 hours and by the email's key. `onlyHosts` is for the check script.
 */
export async function announceAvailable(now: Date, onlyHosts?: string[]): Promise<number> {
  if (!followEmailsOn() || (onlyHosts && onlyHosts.length === 0)) return 0;
  const due = await db
    .select({ hostId: schema.hostCalendars.userId, announceAt: schema.hostCalendars.announceAt })
    .from(schema.hostCalendars)
    .where(and(lte(schema.hostCalendars.announceAt, now), onlyHosts ? inArray(schema.hostCalendars.userId, onlyHosts) : undefined));
  let written = 0;
  for (const { hostId, announceAt } of due) {
    if (!announceAt) continue;
    // The question the host's own page asks: there, with room for a request, and a length that fits.
    const offer = await instantOffer(hostId, now);
    let failed = false;
    if (offer) {
      for (const followerId of await askedFor(hostId, "online")) {
        const done = await tellFollower({
          kind: "online",
          followerId,
          hostId,
          key: `follow-online:${hostId}:${followerId}:${announceAt.getTime()}`,
          // It is no use once the host's time is over.
          expiresAt: offer.availableUntil,
          now,
          announceAt,
          words: (to, host) => ({
            subject: `${host.displayName} is available now on Connect`,
            lines: [
              `${host.displayName} has switched "Available now" on and can take a call right away, until about ${whenFor(to, offer.availableUntil)}.`,
              "",
              `Call now: ${appUrl()}/h/${host.handle}`,
              "",
              `This was so at ${whenFor(to, now)}. Their page always shows whether they are still available.`,
            ],
          }),
        }).catch((error) => {
          console.error(`[follows] could not write an "available now" email about host ${hostId}; the next round tries again`, error);
          failed = true;
          return false;
        });
        if (done) written++;
      }
    }
    // Kept for the next round if anyone could not be written to. (It ends by itself when the host is no longer available.)
    if (failed) continue;
    await db.update(schema.hostCalendars).set({ announceAt: null }).where(and(eq(schema.hostCalendars.userId, hostId), eq(schema.hostCalendars.announceAt, announceAt)));
  }
  return written;
}

/**
 * The helper's round for diary posts: a post that is half an hour old and still there is told to
 * the followers who asked, once. A post that is removed, hidden, in a project that has ended, or
 * too old by now is marked as dealt with and nobody is told. (Whether the host's page is open,
 * whether the post is still there, and everything about each follower, is asked per email.)
 * `onlyPosts` is for the check script.
 */
export async function announcePosts(now: Date, onlyPosts?: string[]): Promise<number> {
  if (!followEmailsOn() || (onlyPosts && onlyPosts.length === 0)) return 0;
  const due = await db
    .select({ post: schema.projectPosts, hostId: schema.projects.hostId, projectId: schema.projects.id, projectStatus: schema.projects.status })
    .from(schema.projectPosts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .where(and(isNull(schema.projectPosts.announcedAt), lte(schema.projectPosts.createdAt, new Date(now.getTime() - EMAILS.postAfterMinutes * MINUTE)), onlyPosts ? inArray(schema.projectPosts.id, onlyPosts) : undefined))
    .orderBy(asc(schema.projectPosts.createdAt))
    .limit(20);
  let written = 0;
  for (const { post, hostId, projectId, projectStatus } of due) {
    const worthTelling = !post.removedAt && !post.hiddenAt && projectStatus === "running" && post.createdAt.getTime() > now.getTime() - EMAILS.postTooOldHours * HOUR;
    let failed = false;
    if (worthTelling) {
      for (const followerId of await askedFor(hostId, "post")) {
        const done = await tellFollower({
          kind: "post",
          followerId,
          hostId,
          key: `follow-post:${hostId}:${followerId}:${post.id}`,
          expiresAt: new Date(now.getTime() + EMAILS.postExpiresHours * HOUR),
          now,
          postId: post.id,
          // Only the host's name: nothing a host wrote ever goes into an inbox under Connect's name.
          words: (_to, host) => ({
            subject: `${host.displayName} wrote in their diary`,
            lines: [`${host.displayName} has written a new post in the diary of their project.`, "", `Read it: ${appUrl()}/h/${host.handle}/project/${projectId}`],
          }),
        }).catch((error) => {
          console.error(`[follows] could not write a diary email about post ${post.id}; the next round tries again`, error);
          failed = true;
          return false;
        });
        if (done) written++;
      }
    }
    // Kept for the next round if anyone could not be written to. (It ends by itself once the post is a day old.)
    if (failed) continue;
    await db.update(schema.projectPosts).set({ announcedAt: now }).where(and(eq(schema.projectPosts.id, post.id), isNull(schema.projectPosts.announcedAt)));
  }
  return written;
}

/**
 * The last look before one of these emails is sent (plans/31, decision 5). `undefined` for an
 * email that is not one of them; otherwise why it must not be sent any more, or null. Everything
 * is asked again as it stands at this moment, and for "available now" also the follower's hours
 * and whether the host's own page would still show them as available. The 5 in 24 hours is
 * counted here from what was really sent, so emails held up by an outage do not arrive together.
 */
export async function followEmailProblem(key: string, at: Date): Promise<string | null | undefined> {
  const parts = key.match(/^follow-(online|post):([^:]+):([^:]+):(.+)$/);
  if (!parts) return undefined;
  const [, kind, hostId, followerId, about] = parts as unknown as [string, Kind, string, string, string];
  const standing = await standingOf(db, followerId, hostId, kind);
  if (standing.problem !== null) return standing.problem;
  const [{ sent }] = await db
    .select({ sent: sql<number>`count(*)::int` })
    .from(schema.emailOutbox)
    .where(and(eq(schema.emailOutbox.to, addressOf(standing.follower.email)), eq(schema.emailOutbox.kind, "follow"), eq(schema.emailOutbox.status, "sent"), gt(schema.emailOutbox.sentAt, new Date(at.getTime() - 24 * HOUR))));
  if (sent >= EMAILS.perDay) return `they have had ${EMAILS.perDay} of these emails in the last 24 hours`;
  if (kind === "online") {
    if (!insideHours(at, standing.follower.timeZone, standing.line.hoursFrom, standing.line.hoursTo)) return "it is outside the hours they chose";
    if (!(await instantOffer(hostId, at))) return "the host is no longer available";
    return null;
  }
  const [post] = await db
    .select({ removedAt: schema.projectPosts.removedAt, hiddenAt: schema.projectPosts.hiddenAt, status: schema.projects.status })
    .from(schema.projectPosts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .where(and(sql`${schema.projectPosts.id}::text = ${about}`, eq(schema.projects.hostId, hostId)));
  if (!post || post.removedAt || post.hiddenAt || post.status !== "running") return "the post is no longer there";
  return null;
}

// ---------------------------------------------------------------------------
// The follower's choices
// ---------------------------------------------------------------------------

/**
 * Saves a follower's choices for one host: the two ticks and the hours. A part that is left out
 * stays as it is. Clearing a tick drops the emails of that kind that were still waiting. A paused
 * person can switch off, not on.
 */
export async function saveChoices(input: { followerId: string; hostId: string; tellOnline?: boolean; tellPosts?: boolean; hours?: { from: number; to: number } | null; now: Date }): Promise<void> {
  const { followerId, hostId } = input;
  if (!followEmailsOn()) throw new FollowError("These emails are not available at the moment. Nothing was changed.");
  await db.transaction(async (tx) => {
    await lockFollowers(tx, [followerId]);
    const [line] = await tx.select().from(schema.follows).where(pair(followerId, hostId));
    if (!line || line.unfollowedAt) throw new FollowError("You do not follow this host. Nothing was changed.");
    const online = input.tellOnline ?? line.tellOnline;
    const posts = input.tellPosts ?? line.tellPosts;
    if ((online && !line.tellOnline) || (posts && !line.tellPosts)) {
      const [me] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, followerId));
      if (!me || me.closedAt || me.pausedAt) throw new FollowError("Your account is paused, so emails can be switched off but not on. Nothing was changed.");
    }
    await tx
      .update(schema.follows)
      .set({ tellOnline: online, tellPosts: posts, ...(input.hours === undefined ? {} : { hoursFrom: input.hours?.from ?? null, hoursTo: input.hours?.to ?? null }) })
      .where(pair(followerId, hostId));
    if (line.tellOnline && !online) await dropWaiting(tx, followerId, hostId, "online");
    if (line.tellPosts && !posts) await dropWaiting(tx, followerId, hostId, "post");
  });
}

/** The account's own switch for all of these emails. Switching off drops every one that was still waiting. The per-host ticks are kept. */
export async function setFollowEmails(userId: string, on: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await lockFollowers(tx, [userId]);
    await tx.update(schema.user).set({ followEmails: on, updatedAt: new Date() }).where(eq(schema.user.id, userId));
    if (!on) await dropWaiting(tx, userId);
  });
}

/** The stop link in these emails: switches them off for the person the secret belongs to, and nothing else. False for an unknown link. */
export async function stopFollowEmailsWithToken(token: string): Promise<boolean> {
  if (!isUnsubscribeToken(token)) return false;
  const [person] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.unsubscribeToken, token));
  if (!person) return false;
  await setFollowEmails(person.id, false);
  return true;
}

/** Whether the account's switch is on, for the account page. */
export async function followEmailsOf(userId: string): Promise<boolean> {
  const [row] = await db.select({ on: schema.user.followEmails }).from(schema.user).where(eq(schema.user.id, userId));
  return row?.on ?? true;
}
