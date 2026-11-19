/**
 * Host profiles and social media names: everything that changes them goes
 * through here, so the rules are in one place. (Closing accounts is in closing.ts.)
 */
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lockCalendar } from "@/lib/membership/locks";
import { memberPriceFloor } from "@/lib/membership/room";
import { cleanUpEndedMemberships, endMembershipsOf } from "@/lib/membership/state";
import { priceProblem } from "@/lib/payments/hold";
import { identityState } from "@/lib/safety/identity";
import { HOME_COUNTRY, isHostCountry } from "./countries";
import { bioHasCode, bioSettings, isAutomatic, readBio, type BioNetwork, type BioReader, type BioSettings } from "./bio-check";
import { queueProfileDecisionEmail } from "./emails";
import { handleKey, handleProblem, tidyHandle } from "./handles";
import { isNetwork, NETWORKS, readSocialName, type Network } from "./social";
import { tiktokSignInOn } from "./tiktok";

/** A problem the person can fix. Its message is safe to show them. */
export class ProfileError extends Error {}

export const ABOUT_MAX = 300;
export const NAME_MIN = 2;
export const NAME_MAX = 50;
const MAX_PRICE_PER_15_CENTS = 100_000; // $1,000
const SOCIAL_CODE_DAYS = 7;

export type ProfileStatus = "pending" | "approved" | "declined" | "suspended";

export const NO_CONFIRMED_ACCOUNT = "This host has no confirmed social media account yet, so the profile cannot be approved.";
export const LAST_CONFIRMED_ACCOUNT = "Your page needs one confirmed account. Confirm another one first, or write to us.";
const TAKEN_BY_ANOTHER_HOST = "That account is already confirmed for another host. If it is yours, write to us.";
/** While TikTok's sign-in is switched on, a TikTok account is proven there and no longer with a code. */
export const USE_TIKTOK_SIGN_IN = "Press \"Connect your TikTok\" to confirm a TikTok account.";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The person and their host profile, both locked until the surrounding step ends. Everything that
 * decides on a profile or takes a confirmed account away asks for these locks first, and only then
 * reads the accounts, so two of them at the same moment happen one after the other. The order is
 * always: the person, the profile, the social account (closing an account works in that order too).
 *
 * The person's row is locked also when there is no profile yet, so a profile made and approved in
 * the meantime cannot slip past. It is locked in the way that still lets other rows point at the
 * person (adding a social account does), which a full lock would make wait, and deadlock.
 */
async function lockedProfile(tx: Tx, userId: string): Promise<{ closed: boolean; paused: boolean; profile: { status: string } | undefined }> {
  const [person] = await tx
    .select({ closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .for("no key update");
  const [profile] = await tx.select({ status: schema.hostProfiles.status }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId)).for("update");
  return { closed: Boolean(person?.closedAt), paused: Boolean(person?.pausedAt), profile };
}

async function confirmedAccounts(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.userId, userId), isNotNull(schema.socialAccounts.confirmedAt)));
  return row.n;
}

/** Refuses to leave an approved host without a confirmed account. Call it with the profile's lock held. */
async function keepOneConfirmed(tx: Tx, userId: string, profile: { status: string } | undefined): Promise<void> {
  if (profile?.status === "approved" && (await confirmedAccounts(tx, userId)) <= 1) throw new ProfileError(LAST_CONFIRMED_ACCOUNT);
}

/** True when the database refused a row because a unique value is already taken. */
function isTaken(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function cleanText(typed: string): string {
  // No control, invisible or line-breaking characters; single spaces.
  return typed.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
}

function checkedDetails(input: { displayName: string; about: string; pricePer15Cents: number }) {
  const displayName = cleanText(input.displayName);
  const about = cleanText(input.about);
  if (displayName.length < NAME_MIN || displayName.length > NAME_MAX) {
    throw new ProfileError(`Your display name must be ${NAME_MIN} to ${NAME_MAX} characters long.`);
  }
  if (about.length > ABOUT_MAX) throw new ProfileError(`The "about" text can be at most ${ABOUT_MAX} characters.`);
  const problem = priceProblem(input.pricePer15Cents);
  if (problem) throw new ProfileError(problem);
  if (input.pricePer15Cents > MAX_PRICE_PER_15_CENTS) throw new ProfileError("The price is too high.");
  return { displayName, about, pricePer15Cents: input.pricePer15Cents };
}

/**
 * A person applies to host. The profile waits for the founder's approval before anyone can see it.
 *
 * `country` is where they say they are based: it must be given, and be one of the countries a
 * host can be paid in (countries.ts). It is never guessed, and the host cannot change it later:
 * their payout account at Stripe is opened for it (plans/27-hosts-abroad.md).
 */
export async function createHostProfile(
  userId: string,
  input: { handle: string; displayName: string; about: string; pricePer15Cents: number; country: string },
): Promise<void> {
  const details = checkedDetails(input);
  const handle = tidyHandle(input.handle);
  const problem = handleProblem(handle);
  if (problem) throw new ProfileError(problem);
  const country = input.country;
  if (!isHostCountry(country)) throw new ProfileError("Choose the country you are based in from the list. For now, hosts can only be paid in those countries.");
  // Someone who started payout setup before applying has a payout account in the United States (only that could be
  // opened without a profile). It cannot serve a host in another country.
  const [started] = await db.select({ accountId: schema.hostSettings.stripeAccountId }).from(schema.hostSettings).where(eq(schema.hostSettings.userId, userId));
  if (started?.accountId && country !== HOME_COUNTRY) {
    throw new ProfileError("You started setting up a payout account for the United States, so you cannot apply from another country here. Please write to support.");
  }
  try {
    await db.insert(schema.hostProfiles).values({ userId, handle, handleKey: handleKey(handle), ...details, country, usConfirmedAt: new Date() });
  } catch (error) {
    if (!isTaken(error)) throw error;
    const [mine] = await db.select({ id: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId));
    // Taken, blocked and look-alike handles all get the same answer.
    throw new ProfileError(mine ? "You already have a host profile." : "That handle is not available.");
  }
}

/** The host edits their profile. The handle cannot be changed here. */
export async function updateHostProfile(
  userId: string,
  input: { displayName: string; about: string; pricePer15Cents: number },
): Promise<void> {
  const details = checkedDetails(input);
  await db.transaction(async (tx) => {
    // The host's calendar lock first: a membership month is written down under the same lock while it
    // reads this price, so a month can never start at a price above the regular one.
    await lockCalendar(tx, userId);
    const [profile] = await tx.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId)).for("update");
    if (!profile) throw new ProfileError("You do not have a host profile yet.");
    const floor = await memberPriceFloor(tx, userId);
    if (floor > 0 && details.pricePer15Cents < floor) {
      throw new ProfileError(
        details.pricePer15Cents === 0
          ? "You offer a membership, or a member's month is still running, so your calls cannot be free."
          : `Your regular price cannot be lower than your member price ($${(floor / 100).toFixed(2)} per 15 minutes). Lower the member price first. Your regular price can follow when the months at the old price have ended.`,
      );
    }
    // A new name must be approved again, so an approved profile cannot be renamed into someone famous.
    // A declined profile that is edited goes back in the queue. A suspended one stays suspended.
    const renamed = details.displayName !== profile.displayName;
    const status =
      profile.status === "declined" || (profile.status === "approved" && renamed) ? "pending" : profile.status;
    await tx
      .update(schema.hostProfiles)
      .set({ ...details, status, updatedAt: new Date() })
      .where(eq(schema.hostProfiles.userId, userId));
  });
}

/** The host's own switch. Hiding stops people finding the profile; calls already booked still happen. */
export async function setProfileHidden(userId: string, hidden: boolean): Promise<void> {
  await db.update(schema.hostProfiles).set({ hidden, updatedAt: new Date() }).where(eq(schema.hostProfiles.userId, userId));
}

/**
 * The founder approves, declines or suspends a profile. An approval names
 * what the founder was looking at: if the host changed the name or the text
 * in the meantime, nothing is approved.
 */
export async function decideProfile(input: {
  userId: string;
  decision: Exclude<ProfileStatus, "pending">;
  by: string;
  seen?: { displayName: string; about: string; identityCheckId?: string };
}): Promise<void> {
  if (!["approved", "declined", "suspended"].includes(input.decision)) throw new ProfileError("Unknown decision.");
  if (input.decision === "approved" && !input.seen) throw new ProfileError("Open the profile again before approving it.");
  if (input.decision === "approved") {
    const identity = await identityState(input.userId);
    if (!identity.passed) throw new ProfileError("This host has not passed the identity check yet, so the profile cannot be approved.");
    if (input.seen?.identityCheckId && identity.checkId !== input.seen.identityCheckId) {
      throw new ProfileError("The identity result changed while you were looking at it. Check it again.");
    }
  }
  const stillAsSeen =
    input.decision === "approved"
      ? and(eq(schema.hostProfiles.displayName, input.seen!.displayName), eq(schema.hostProfiles.about, input.seen!.about))
      : undefined;
  const decidedAt = new Date();
  let endedMemberships: string[] = [];
  let givenUpPayments: string[] = [];
  // The decision and the email that tells the host about it are saved together, or not at all.
  await db.transaction(async (tx) => {
    // Read under a lock, so two presses of the same button are two steps, one after the other.
    const { closed, profile: before } = await lockedProfile(tx, input.userId);
    // Closing an account suspends its profile. With the person locked first, an approval and a
    // closure at the same moment happen one after the other, and the closure always wins.
    if (input.decision === "approved" && closed) throw new ProfileError("This account is closed. Open it again before approving its profile.");
    if (!before) throw new ProfileError("Profile not found.");
    if (input.decision === "approved" && (await confirmedAccounts(tx, input.userId)) === 0) throw new ProfileError(NO_CONFIRMED_ACCOUNT);
    const changed = await tx
      .update(schema.hostProfiles)
      .set({ status: input.decision, decidedBy: input.by, decidedAt, updatedAt: decidedAt })
      .where(and(eq(schema.hostProfiles.userId, input.userId), stillAsSeen))
      .returning({ userId: schema.hostProfiles.userId });
    if (changed.length === 0) {
      throw new ProfileError(
        input.decision === "approved" ? "That profile was changed while you were looking at it. Check it again." : "Profile not found.",
      );
    }
    // The host is told when the answer changes, not when the same answer is given again.
    if (before.status !== input.decision) await queueProfileDecisionEmail(tx, { userId: input.userId, decision: input.decision });
    // A suspended host's memberships end at once and for good, in this same step. (Her own memberships with other hosts go on.)
    if (input.decision === "suspended") endedMemberships = await endMembershipsOf(tx, input.userId, { by: "connect", reason: "the host can no longer be booked", asHostOnly: true }, decidedAt);
    // So do the contributions to her project. (What she contributes to other hosts goes on.) Loaded here, not at
    // the top: that code talks to Stripe, and this file stays free of that.
    if (input.decision === "suspended") givenUpPayments = await (await import("@/lib/contributions/ending")).endContributionsOf(tx, input.userId, "suspended", decidedAt, { asHostOnly: true });
  });
  await cleanUpEndedMemberships(endedMemberships, decidedAt);
  if (givenUpPayments.length > 0) await (await import("@/lib/contributions/ending")).letGoAll(givenUpPayments, decidedAt);
}

export type PublicProfile = {
  /** Used by the server to look up open times. Never put in a page. */
  userId: string;
  handle: string;
  displayName: string;
  about: string;
  pricePer15Cents: number;
  freeCancelMinutes: number;
  socials: Array<{ network: Network; label: string; name: string; url: string }>;
};

/**
 * What anyone may see of a host, or null. Null for a handle that does not
 * exist and for a profile that is waiting, declined, hidden or suspended, or
 * whose account is closed: from outside they all look the same.
 */
export async function publicProfile(typedHandle: string): Promise<PublicProfile | null> {
  const handle = tidyHandle(typedHandle);
  if (handleProblem(handle)) return null;
  // Only the columns that are public are ever read here.
  const [row] = await db
    .select({
      userId: schema.hostProfiles.userId,
      handle: schema.hostProfiles.handle,
      displayName: schema.hostProfiles.displayName,
      about: schema.hostProfiles.about,
      pricePer15Cents: schema.hostProfiles.pricePer15Cents,
      freeCancelMinutes: schema.hostSettings.freeCancelMinutes,
    })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .leftJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.hostProfiles.userId))
    .where(
      and(
        eq(schema.hostProfiles.handle, handle),
        eq(schema.hostProfiles.status, "approved"),
        eq(schema.hostProfiles.hidden, false),
        isNull(schema.user.closedAt),
      ),
    );
  if (!row) return null;
  const socials = await db
    .select({ network: schema.socialAccounts.network, nameKey: schema.socialAccounts.nameKey, url: schema.socialAccounts.url })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.userId, row.userId), isNotNull(schema.socialAccounts.confirmedAt)));
  return {
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
    about: row.about,
    pricePer15Cents: row.pricePer15Cents,
    freeCancelMinutes: row.freeCancelMinutes ?? 0,
    socials: socials
      .filter((s) => isNetwork(s.network))
      .map((s) => ({ network: s.network as Network, label: NETWORKS[s.network as Network].label, name: s.nameKey, url: s.url })),
  };
}

// ---------------------------------------------------------------------------
// Social media names
// ---------------------------------------------------------------------------

function newProofCode(): string {
  // Unpredictable, and without letters or digits that look alike.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 10; i++) code += alphabet[randomInt(alphabet.length)];
  return `connect-${code}`;
}

/**
 * A host says "this account is mine". We give them a fresh code to put in
 * that account's bio. Changing the name always starts the proof again, so an
 * approved host cannot change the name of their only confirmed account.
 */
export async function addSocialName(userId: string, network: string, typed: string): Promise<void> {
  if (!isNetwork(network)) throw new ProfileError("Choose one of the listed networks.");
  // Before anything else is looked at, also the name that is already confirmed.
  if (network === "tiktok" && tiktokSignInOn()) throw new ProfileError(USE_TIKTOK_SIGN_IN);
  const read = readSocialName(network, typed);
  if ("problem" in read) throw new ProfileError(read.problem);

  await db.transaction(async (tx) => {
    const { profile } = await lockedProfile(tx, userId);
    const [mine] = await tx
      .select()
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, network)));
    if (mine?.nameKey === read.nameKey && mine.confirmedAt) return; // already confirmed: nothing to do

    const [taken] = await tx
      .select({ id: schema.socialAccounts.id })
      .from(schema.socialAccounts)
      .where(
        and(eq(schema.socialAccounts.network, network), eq(schema.socialAccounts.nameKey, read.nameKey), isNotNull(schema.socialAccounts.confirmedAt)),
      );
    if (taken) throw new ProfileError(TAKEN_BY_ANOTHER_HOST);
    if (mine?.confirmedAt) await keepOneConfirmed(tx, userId, profile);

    const fresh = {
      nameTyped: typed.trim().slice(0, 200),
      nameKey: read.nameKey,
      url: read.url,
      code: newProofCode(),
      codeExpiresAt: new Date(Date.now() + SOCIAL_CODE_DAYS * 24 * 3_600_000),
      claimedAt: null,
      confirmedAt: null,
      confirmedBy: null,
      // A proof by signing in belonged to the old name; it goes with the rest of the old proof.
      providerAccountId: null,
    };
    await tx
      .insert(schema.socialAccounts)
      .values({ userId, network, ...fresh })
      .onConflictDoUpdate({ target: [schema.socialAccounts.userId, schema.socialAccounts.network], set: fresh });
  });
}

/**
 * The host signed in at the network (TikTok), and the network told us which account that is. The
 * account is confirmed for this host at once: there is nothing for the founder to look at.
 * `accountId` is the network's own number for the account, `username` its name today.
 *
 * One write covers every case. Whatever the host's entry for this network was (none, waiting for
 * a code, confirmed by hand, the same account under an older name, or a different account), it
 * becomes this account, confirmed. A confirmed entry is replaced by a confirmed entry in the same
 * step, so the host is never without a confirmed account in between; the rule about an approved
 * host's last confirmed account is therefore not applied here. If the name or the number is
 * confirmed for another host, the database refuses and nothing changes.
 */
export async function confirmSocialByLogin(input: { userId: string; network: "tiktok"; accountId: string; username: string; now?: Date }): Promise<{ nameKey: string }> {
  const read = readSocialName(input.network, input.username);
  // The number is the network's own text. It is kept exactly as it came, never read as a number.
  if ("problem" in read || !/^[\x21-\x7e]{1,200}$/.test(input.accountId)) throw new ProfileError("TikTok's answer could not be read. Nothing was changed.");
  const now = input.now ?? new Date();
  const confirmed = {
    nameTyped: input.username.slice(0, 200),
    nameKey: read.nameKey,
    url: read.url,
    // The code way is not in play for this entry: a code nobody is shown, already run out.
    code: newProofCode(),
    codeExpiresAt: now,
    claimedAt: null,
    confirmedAt: now,
    confirmedBy: null,
    providerAccountId: input.accountId,
  };
  try {
    await db.transaction(async (tx) => {
      // Checked again with the locks held: the person may have changed while the network was answering.
      const { closed, paused, profile } = await lockedProfile(tx, input.userId);
      if (closed || paused) throw new ProfileError("Your account cannot do this at the moment. Nothing was changed.");
      if (!profile) throw new ProfileError("Fill in your host profile first.");
      await tx
        .insert(schema.socialAccounts)
        .values({ userId: input.userId, network: input.network, ...confirmed })
        .onConflictDoUpdate({ target: [schema.socialAccounts.userId, schema.socialAccounts.network], set: confirmed });
    });
  } catch (error) {
    if (isTaken(error)) throw new ProfileError(TAKEN_BY_ANOTHER_HOST);
    throw error;
  }
  return { nameKey: read.nameKey };
}

/**
 * A network did not accept our own keys or the permissions we ask for, when a host signed in
 * there. Written down for the founder's page (see refusedBioChecks); nothing else about a sign-in
 * is ever written here.
 */
export async function noteRefusedSignIn(userId: string, network: "tiktok", now: Date): Promise<void> {
  await db.insert(schema.bioChecks).values({ userId, network, startedAt: now, result: "refused" });
}

/** One person can have this many automatic checks in an hour, and no two for the same network closer together than this. */
export const BIO_CHECKS_PER_HOUR = 10;
export const BIO_CHECK_SECONDS_APART = 30;
/** All of Instagram together, in an hour: half of what Meta is assumed to allow the whole app. */
export const INSTAGRAM_CHECKS_PER_HOUR = 100;

export type SocialReadyOutcome =
  /** Not an automatic network (or its settings are missing): the founder is asked to look, as before. */
  | "waiting"
  | "confirmed"
  | "not_found"
  | "no_account"
  /** The network could not be asked, or did not accept us. */
  | "unavailable"
  | "too_soon"
  | "limit"
  /** The limit for everyone together is reached. */
  | "busy"
  /** The entry is not there any more, was changed while we looked, or its code has run out. */
  | "gone"
  | "taken";

/**
 * The host says the code is in place. Which way it goes is decided here, from the entry itself and
 * the settings, never from which button was pressed: Instagram and YouTube are looked at by Connect
 * at once (when their settings are there), everything else goes to the founder as before.
 */
export async function socialNameReady(
  userId: string,
  id: string,
  /** Only the check script passes these, to pretend the networks' answers, the settings and the time. */
  options: { read?: BioReader; settings?: BioSettings; clock?: () => Date } = {},
): Promise<{ outcome: SocialReadyOutcome; network: string; nameKey: string }> {
  const gone = "That account is no longer on your profile.";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ProfileError(gone);
  const [entry] = await db
    .select({ network: schema.socialAccounts.network, nameKey: schema.socialAccounts.nameKey })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.id, id), eq(schema.socialAccounts.userId, userId)));
  if (!entry) throw new ProfileError(gone);
  if (!isAutomatic(entry.network, options.settings ?? bioSettings())) {
    await markSocialNameReady(userId, id);
    return { outcome: "waiting", ...entry };
  }
  const checked = await checkBioNow(userId, id, entry.network, options.read ?? readBio, options.clock ?? (() => new Date()));
  return { outcome: checked.outcome, network: entry.network, nameKey: checked.nameKey ?? entry.nameKey };
}

/**
 * Connect looks at the account's bio itself and confirms the entry when the code is there.
 *
 * 1. One short step under two locks (all of Instagram first, then the person): find the entry,
 *    check the limits, and write down that a check starts. Only then is the network asked.
 * 2. The network is asked outside any database step, so nothing is held while waiting for it.
 * 3. The entry is confirmed with one guarded change: only if it is still this person's, with the
 *    name and the code that were looked for, not confirmed, and its code not run out. Confirming
 *    only ever adds a confirmed account, so the locks that guard removing one are not needed.
 * A failure of any kind confirms nothing.
 */
async function checkBioNow(
  userId: string,
  id: string,
  network: BioNetwork,
  read: BioReader,
  clock: () => Date,
): Promise<{ outcome: Exclude<SocialReadyOutcome, "waiting">; nameKey?: string }> {
  const reserved = await db.transaction(async (tx) => {
    if (network === "instagram") await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"bio-check:instagram:global"}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bio-check:user:${userId}`}))`);
    // Read with the locks held, never before waiting for them.
    const now = clock();
    const [entry] = await tx
      .select({ nameKey: schema.socialAccounts.nameKey, code: schema.socialAccounts.code })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.id, id),
          eq(schema.socialAccounts.userId, userId),
          eq(schema.socialAccounts.network, network),
          isNull(schema.socialAccounts.confirmedAt),
          gt(schema.socialAccounts.codeExpiresAt, now),
        ),
      );
    if (!entry) return "gone" as const;
    // A check counts from the moment it starts, whether or not it has ended and however it ended.
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const mine = await tx
      .select({ network: schema.bioChecks.network, startedAt: schema.bioChecks.startedAt })
      .from(schema.bioChecks)
      .where(and(eq(schema.bioChecks.userId, userId), inArray(schema.bioChecks.network, ["instagram", "youtube"]), gt(schema.bioChecks.startedAt, hourAgo)))
      .orderBy(desc(schema.bioChecks.startedAt));
    const lastHere = mine.find((check) => check.network === network);
    if (lastHere && now.getTime() - lastHere.startedAt.getTime() < BIO_CHECK_SECONDS_APART * 1000) return "too_soon" as const;
    if (mine.length >= BIO_CHECKS_PER_HOUR) return "limit" as const;
    if (network === "instagram") {
      const [all] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bioChecks)
        .where(and(eq(schema.bioChecks.network, "instagram"), gt(schema.bioChecks.startedAt, hourAgo)));
      if (all.n >= INSTAGRAM_CHECKS_PER_HOUR) return "busy" as const;
    }
    const [check] = await tx.insert(schema.bioChecks).values({ userId, network, startedAt: now }).returning({ id: schema.bioChecks.id });
    return { checkId: check.id, nameKey: entry.nameKey, code: entry.code };
  });
  if (typeof reserved === "string") return { outcome: reserved };

  const answer = await read(network, reserved.nameKey).catch(() => ({ kind: "unavailable" as const }));
  const found = answer.kind === "bio" && bioHasCode(answer.text, reserved.code);
  const result = answer.kind === "bio" ? (found ? "found" : "not_found") : answer.kind;
  await db.update(schema.bioChecks).set({ result }).where(eq(schema.bioChecks.id, reserved.checkId));
  if (answer.kind !== "bio") return { outcome: answer.kind === "no_account" ? "no_account" : "unavailable", nameKey: reserved.nameKey };
  if (!found) return { outcome: "not_found", nameKey: reserved.nameKey };

  try {
    const at = clock();
    const changed = await db
      .update(schema.socialAccounts)
      .set({ confirmedAt: at, confirmedBy: null, claimedAt: null })
      .where(
        and(
          eq(schema.socialAccounts.id, id),
          eq(schema.socialAccounts.userId, userId),
          eq(schema.socialAccounts.network, network),
          eq(schema.socialAccounts.nameKey, reserved.nameKey),
          eq(schema.socialAccounts.code, reserved.code),
          isNull(schema.socialAccounts.confirmedAt),
          gt(schema.socialAccounts.codeExpiresAt, at),
        ),
      )
      .returning({ id: schema.socialAccounts.id });
    return { outcome: changed.length > 0 ? "confirmed" : "gone", nameKey: reserved.nameKey };
  } catch (error) {
    // The name was confirmed for another host in the meantime: the database itself refuses a second owner.
    if (isTaken(error)) return { outcome: "taken", nameKey: reserved.nameKey };
    throw error;
  }
}

/** How often a network did not accept our own key or permission, in the last 24 hours. For the founder's page. */
export async function refusedBioChecks(now: Date): Promise<Array<{ network: string; count: number }>> {
  return db
    .select({ network: schema.bioChecks.network, count: sql<number>`count(*)::int` })
    .from(schema.bioChecks)
    .where(and(eq(schema.bioChecks.result, "refused"), gt(schema.bioChecks.startedAt, new Date(now.getTime() - 24 * 3_600_000))))
    .groupBy(schema.bioChecks.network)
    .orderBy(schema.bioChecks.network);
}

/**
 * The host says the code is now in the account's bio. The founder is then asked to look.
 * (The by-hand way. The Hosting page goes through socialNameReady, which decides which way applies.)
 */
export async function markSocialNameReady(userId: string, id: string): Promise<void> {
  if (tiktokSignInOn()) {
    // Decided from the entry itself, so a form from an old page cannot put a new TikTok request on the founder's list.
    const [entry] = /^[0-9a-f-]{36}$/i.test(id)
      ? await db.select({ network: schema.socialAccounts.network }).from(schema.socialAccounts).where(and(eq(schema.socialAccounts.id, id), eq(schema.socialAccounts.userId, userId)))
      : [];
    if (entry?.network === "tiktok") throw new ProfileError(USE_TIKTOK_SIGN_IN);
  }
  const changed = await db
    .update(schema.socialAccounts)
    .set({ claimedAt: new Date() })
    .where(
      and(
        eq(schema.socialAccounts.id, id),
        eq(schema.socialAccounts.userId, userId),
        isNull(schema.socialAccounts.confirmedAt),
        gt(schema.socialAccounts.codeExpiresAt, new Date()),
      ),
    )
    .returning({ id: schema.socialAccounts.id });
  if (changed.length === 0) throw new ProfileError("That code has run out. Add the account again to get a new one.");
}

/** The host removes an account. An approved host keeps at least one confirmed account. */
export async function removeSocialName(userId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.transaction(async (tx) => {
    const { profile } = await lockedProfile(tx, userId);
    const [mine] = await tx
      .select({ confirmedAt: schema.socialAccounts.confirmedAt })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.id, id), eq(schema.socialAccounts.userId, userId)));
    if (!mine) return;
    if (mine.confirmedAt) await keepOneConfirmed(tx, userId, profile);
    await tx.delete(schema.socialAccounts).where(and(eq(schema.socialAccounts.id, id), eq(schema.socialAccounts.userId, userId)));
  });
}

/**
 * The founder has seen the code in the bio and confirms the name. `nameKey`
 * and `code` are what the founder was looking at: if the host changed the
 * name, or the code was replaced or has run out, nothing is confirmed.
 */
export async function confirmSocialName(input: { id: string; nameKey: string; code: string; by: string }): Promise<void> {
  try {
    const changed = await db
      .update(schema.socialAccounts)
      .set({ confirmedAt: new Date(), confirmedBy: input.by })
      .where(
        and(
          eq(schema.socialAccounts.id, input.id),
          eq(schema.socialAccounts.nameKey, input.nameKey),
          eq(schema.socialAccounts.code, input.code),
          gt(schema.socialAccounts.codeExpiresAt, new Date()),
          isNotNull(schema.socialAccounts.claimedAt),
          isNull(schema.socialAccounts.confirmedAt),
        ),
      )
      .returning({ id: schema.socialAccounts.id });
    if (changed.length === 0) throw new ProfileError("That request has changed, run out, or is no longer waiting. Nothing was confirmed.");
  } catch (error) {
    if (isTaken(error)) throw new ProfileError(TAKEN_BY_ANOTHER_HOST);
    throw error;
  }
}

/**
 * The founder did not find the code. The host can try again with the same
 * code until it runs out. Like confirming, this only applies to the request
 * the founder was looking at.
 */
export async function rejectSocialName(input: { id: string; nameKey: string; code: string }): Promise<void> {
  const changed = await db
    .update(schema.socialAccounts)
    .set({ claimedAt: null })
    .where(
      and(
        eq(schema.socialAccounts.id, input.id),
        eq(schema.socialAccounts.nameKey, input.nameKey),
        eq(schema.socialAccounts.code, input.code),
        isNull(schema.socialAccounts.confirmedAt),
      ),
    )
    .returning({ id: schema.socialAccounts.id });
  if (changed.length === 0) throw new ProfileError("That request has changed or is no longer waiting. Nothing was changed.");
}
