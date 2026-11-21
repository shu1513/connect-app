/**
 * The host chooses what Connect does about a chargeback (plans/47-bank-disputes.md, decisions 4 and 5).
 *
 * "Fight it": the app sends the bank its record of the payment. "Give the money back": the app tells
 * the bank it does not contest. That is not a refund: the bank has already taken the money from
 * Connect, and it goes back to the customer through the bank.
 *
 * The first choice stands. The press and the helper's "time is up" both hold the dispute's row and
 * read the clock after they have it, so exactly one of them decides.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canChoose } from "./rules";

/** Refused for a reason a person can read. Nothing was changed. */
export class ChoiceError extends Error {}

export type Choice = "fight" | "give_back";

export async function chooseAnswer(input: { disputeId: string; by: string; choice: string; now?: Date }): Promise<void> {
  if (input.choice !== "fight" && input.choice !== "give_back") throw new ChoiceError("Choose one of the two.");
  const choice: Choice = input.choice;
  await db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, input.disputeId)).for("update");
    // Someone else's dispute and one that does not exist are the same answer.
    if (!dispute || dispute.hostId !== input.by) throw new ChoiceError("Dispute not found.");
    // The clock is read with the row held.
    const now = input.now ?? new Date();
    if (dispute.choice) throw new ChoiceError("This has already been chosen. The first choice stands.");
    if (!canChoose(dispute, now)) throw new ChoiceError("There is nothing to choose here any more: the time to choose is over, or the bank is no longer waiting for an answer.");
    await tx.update(schema.disputes).set({ choice, chosenAs: "host", chosenAt: now }).where(eq(schema.disputes.id, dispute.id));
  });
}
