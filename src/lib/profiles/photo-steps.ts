/**
 * The steps on a host's photo that other files need inside their own database step (plans/29):
 * deleting it, stopping a try that is under way, and dropping it when the account it came from is
 * no longer the host's confirmed account. This file imports neither profiles.ts nor photo.ts, so
 * both can use it.
 *
 * A locked photo ("Remove and report") is never touched by anything here.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sameAccount } from "./photo-rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const photos = schema.hostPhotos;
const tries = schema.hostPhotoTries;

/** Deletes the host's photo, if they have one that is not locked. Says whether there was one. */
export async function deletePhotoInStep(tx: Tx, userId: string): Promise<boolean> {
  const gone = await tx.delete(photos).where(and(eq(photos.userId, userId), isNull(photos.lockedAt))).returning({ id: photos.id });
  return gone.length > 0;
}

/** Stops every try of this host that is still running: whatever it brings back later is not written. */
export async function stopTriesInStep(tx: Tx, userId: string, now: Date, why: string): Promise<void> {
  await tx.update(tries).set({ result: "stopped", detail: why, endedAt: now }).where(and(eq(tries.userId, userId), isNull(tries.result)));
}

/**
 * Called at the end of every step that changes a host's confirmed accounts, with the profile's
 * lock held: typing another name, removing an account, and a sign-in that confirms one.
 *
 * - If the photo's account is no longer the host's confirmed account on that network
 *   (`sameAccount`), the photo goes in this same step. An uploaded photo came from no account,
 *   and is left alone.
 * - A try that is under way is stopped when the confirmed entry it started from is no longer
 *   there with the same name and number. The try compares these itself before it writes, but
 *   that alone would miss an account that was changed and changed back in between.
 */
export async function dropPhotoIfSourceGone(tx: Tx, userId: string, now: Date = new Date()): Promise<void> {
  const confirmed = await tx
    .select({ network: schema.socialAccounts.network, nameKey: schema.socialAccounts.nameKey, providerAccountId: schema.socialAccounts.providerAccountId })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.userId, userId), isNotNull(schema.socialAccounts.confirmedAt)));
  const entryOn = (network: string) => confirmed.find((entry) => entry.network === network) ?? null;

  const running = await tx.select({ id: tries.id, network: tries.network, entryNameKey: tries.entryNameKey, entryAccountId: tries.entryAccountId }).from(tries).where(and(eq(tries.userId, userId), isNull(tries.result)));
  for (const one of running) {
    // An upload was started from no account, so no change of an account stops it (plans/35).
    if (one.network === "upload") continue;
    const entry = entryOn(one.network);
    if (entry && entry.nameKey === one.entryNameKey && entry.providerAccountId === one.entryAccountId) continue;
    await tx.update(tries).set({ result: "stopped", detail: "the account changed meanwhile", endedAt: now }).where(and(eq(tries.id, one.id), isNull(tries.result)));
  }

  const [photo] = await tx
    .select({ network: photos.network, sourceNameKey: photos.sourceNameKey, sourceAccountId: photos.sourceAccountId })
    .from(photos)
    .where(and(eq(photos.userId, userId), isNull(photos.lockedAt)));
  // An uploaded photo belongs to no account and stays (plans/35). A photo from a network always has its account's
  // name and number; one without them could not be told to be anyone's, and goes.
  if (!photo || photo.network === "upload") return;
  const { sourceNameKey, sourceAccountId } = photo;
  if (!sourceNameKey || !sourceAccountId || !sameAccount({ sourceNameKey, sourceAccountId }, entryOn(photo.network))) await deletePhotoInStep(tx, userId);
}
