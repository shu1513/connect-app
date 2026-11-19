/**
 * The months a monthly contribution skipped: one that the host, the founder or the contributor
 * let go, one whose day passed while the founder's switch did not cover the host, and one the
 * helper came too late for. A skipped month is never charged afterwards. (A small file of its
 * own, so that the code that charges and the code that writes months down can both use it.)
 */
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { Contribution } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";

/** The numbers of the months that were skipped, as they are kept on a contribution. */
export function skippedOf(contribution: Pick<Contribution, "skippedMonths">): number[] {
  try {
    const parsed: unknown = JSON.parse(contribution.skippedMonths);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/**
 * Adds months to the ones a contribution skipped, inside the caller's step, with the contribution
 * locked. `alsoLastWritten` moves the number of the last month that was dealt with forward, for
 * months that were never written down at all.
 */
export async function addSkipped(tx: Tx, contribution: Contribution, months: number[], now: Date, alsoLastWritten?: number): Promise<void> {
  if (months.length === 0 && alsoLastWritten === undefined) return;
  const skipped = [...new Set([...skippedOf(contribution), ...months])].sort((a, b) => a - b);
  await tx
    .update(schema.contributions)
    .set({ skippedMonths: JSON.stringify(skipped), ...(alsoLastWritten !== undefined && alsoLastWritten > contribution.lastWrittenMonth ? { lastWrittenMonth: alsoLastWritten } : {}), updatedAt: now })
    .where(eq(schema.contributions.id, contribution.id));
}
