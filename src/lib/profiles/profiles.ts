/**
 * Host profiles and social media names: everything that changes them goes
 * through here, so the rules are in one place. (Closing accounts is in closing.ts.)
 */
import { randomInt } from "node:crypto";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { priceProblem } from "@/lib/payments/hold";
import { handleKey, handleProblem, tidyHandle } from "./handles";
import { isNetwork, NETWORKS, readSocialName, type Network } from "./social";

/** A problem the person can fix. Its message is safe to show them. */
export class ProfileError extends Error {}

export const ABOUT_MAX = 300;
export const NAME_MIN = 2;
export const NAME_MAX = 50;
const MAX_PRICE_PER_15_CENTS = 100_000; // $1,000
const SOCIAL_CODE_DAYS = 7;

export type ProfileStatus = "pending" | "approved" | "declined" | "suspended";

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

/** A person applies to host. The profile waits for the founder's approval before anyone can see it. */
export async function createHostProfile(
  userId: string,
  input: { handle: string; displayName: string; about: string; pricePer15Cents: number; usConfirmed: boolean },
): Promise<void> {
  const details = checkedDetails(input);
  const handle = tidyHandle(input.handle);
  const problem = handleProblem(handle);
  if (problem) throw new ProfileError(problem);
  if (!input.usConfirmed) throw new ProfileError("For now, hosts must be based in the United States.");
  try {
    await db.insert(schema.hostProfiles).values({ userId, handle, handleKey: handleKey(handle), ...details, usConfirmedAt: new Date() });
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
    const [profile] = await tx.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId)).for("update");
    if (!profile) throw new ProfileError("You do not have a host profile yet.");
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
  seen?: { displayName: string; about: string };
}): Promise<void> {
  if (!["approved", "declined", "suspended"].includes(input.decision)) throw new ProfileError("Unknown decision.");
  if (input.decision === "approved" && !input.seen) throw new ProfileError("Open the profile again before approving it.");
  const stillAsSeen =
    input.decision === "approved"
      ? and(eq(schema.hostProfiles.displayName, input.seen!.displayName), eq(schema.hostProfiles.about, input.seen!.about))
      : undefined;
  const changed = await db
    .update(schema.hostProfiles)
    .set({ status: input.decision, decidedBy: input.by, decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.hostProfiles.userId, input.userId), stillAsSeen))
    .returning({ userId: schema.hostProfiles.userId });
  if (changed.length === 0) {
    throw new ProfileError(
      input.decision === "approved" ? "That profile was changed while you were looking at it. Check it again." : "Profile not found.",
    );
  }
}

export type PublicProfile = {
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
 * that account's bio. Changing the name always starts the proof again.
 */
export async function addSocialName(userId: string, network: string, typed: string): Promise<void> {
  if (!isNetwork(network)) throw new ProfileError("Choose one of the listed networks.");
  const read = readSocialName(network, typed);
  if ("problem" in read) throw new ProfileError(read.problem);

  const [mine] = await db
    .select()
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, network)));
  if (mine?.nameKey === read.nameKey && mine.confirmedAt) return; // already confirmed: nothing to do

  const [taken] = await db
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(
      and(eq(schema.socialAccounts.network, network), eq(schema.socialAccounts.nameKey, read.nameKey), isNotNull(schema.socialAccounts.confirmedAt)),
    );
  if (taken) throw new ProfileError("That account is already confirmed for another host. If it is yours, contact support.");

  const fresh = {
    nameTyped: typed.trim().slice(0, 200),
    nameKey: read.nameKey,
    url: read.url,
    code: newProofCode(),
    codeExpiresAt: new Date(Date.now() + SOCIAL_CODE_DAYS * 24 * 3_600_000),
    claimedAt: null,
    confirmedAt: null,
    confirmedBy: null,
  };
  await db
    .insert(schema.socialAccounts)
    .values({ userId, network, ...fresh })
    .onConflictDoUpdate({ target: [schema.socialAccounts.userId, schema.socialAccounts.network], set: fresh });
}

/** The host says the code is now in the account's bio. The founder is then asked to look. */
export async function markSocialNameReady(userId: string, id: string): Promise<void> {
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

export async function removeSocialName(userId: string, id: string): Promise<void> {
  await db.delete(schema.socialAccounts).where(and(eq(schema.socialAccounts.id, id), eq(schema.socialAccounts.userId, userId)));
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
    if (isTaken(error)) throw new ProfileError("That account is already confirmed for another host.");
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
