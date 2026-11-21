/**
 * The rules for answering a bank (plans/47-bank-disputes.md, part 2). No database and no network:
 * plain rules, so each can be tested.
 */
import { stageOf, standingOf, type Stage } from "./status";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The host has this long to choose (the founder's rule). */
export const ASK_MS = 24 * HOUR;
/** The host's time never reaches closer than this to the bank's own deadline: the app needs room to send its answer. */
export const BEFORE_DUE_MS = 3 * DAY;
/** While Stripe's own memory of a request's label is certain, the same request can be sent again under it. */
export const LABEL_SAFE_MS = 23 * HOUR;
/** After a clear "no" from Stripe, a new request is made this much later. */
export const RETRY_AFTER_NO_MS = HOUR;
/** A dispute that still waits for an answer this close to the bank's deadline is a fault the founder is told of. */
export const LATE_MS = DAY;

/**
 * From which disputed amount the app fights a compliance dispute, in cents, or null for never.
 * Fighting one costs 500 dollars of Connect's money, returned only on a win. The founder's decision
 * of 20 November 2026: "do the $5,000 line". It is a setting: `DISPUTE_COMPLIANCE_FIGHT_FROM_DOLLARS`
 * holds another amount in whole dollars, or the word "never".
 */
export function complianceFightFromCents(setting: string | undefined = process.env.DISPUTE_COMPLIANCE_FIGHT_FROM_DOLLARS): number | null {
  const given = (setting ?? "").trim().toLowerCase();
  if (given === "never") return null;
  const dollars = Number(given);
  return given !== "" && Number.isInteger(dollars) && dollars > 0 ? dollars * 100 : 500_000;
}

/**
 * What the app does about a stage that waits for an answer:
 *   leave   nothing is sent: the bank takes no answer, or it is a compliance dispute under the founder's line
 *   answer  the app sends its proof at once, and nobody is asked: a bank's question
 *   ask     the host chooses; no answer in time counts as "fight"
 * A compliance dispute is looked at first, before anything else, also when it comes as a question.
 */
export type Plan = "leave" | "answer" | "ask";

export function planFor(dispute: { stage: string; compliance: boolean; amountCents: number; noAnswer: boolean }, fightComplianceFrom: number | null = complianceFightFromCents()): Plan {
  if (dispute.noAnswer) return "leave";
  if (dispute.compliance && (fightComplianceFrom === null || dispute.amountCents < fightComplianceFrom)) return "leave";
  return dispute.stage === "question" ? "answer" : "ask";
}

/**
 * Until when the host can choose: 24 hours from now, but never later than 3 days before the bank's
 * own deadline. Null when nobody is asked: the host's account is closed, or that leaves no time at
 * all (then the app fights at once).
 */
export function askUntilFor(input: { now: Date; dueBy: Date | null; hostCanChoose: boolean }): Date | null {
  if (!input.hostCanChoose) return null;
  const byTheClock = input.now.getTime() + ASK_MS;
  const until = input.dueBy ? Math.min(byTheClock, input.dueBy.getTime() - BEFORE_DUE_MS) : byTheClock;
  return until > input.now.getTime() ? new Date(until) : null;
}

/** Whether Stripe's status says this stage waits for an answer. */
export function waits(status: string): boolean {
  return standingOf(status) === "waiting";
}

/**
 * What is due to be sent now for a stage that waits, or null if nothing is (yet).
 *   - "leave": never anything.
 *   - "answer": the proof, at once.
 *   - "ask": what the host chose; with no choice, the proof once their time is up (or at once when nobody was asked).
 */
export function dueNow(input: { plan: Plan; choice: string | null; askUntil: Date | null; now: Date }): "proof" | "give_in" | null {
  if (input.plan === "leave") return null;
  if (input.plan === "answer") return "proof";
  if (input.choice === "give_back") return "give_in";
  if (input.choice === "fight") return "proof";
  return !input.askUntil || input.now.getTime() >= input.askUntil.getTime() ? "proof" : null;
}

/** Whether the host can still choose, at this moment. */
export function canChoose(dispute: { stage: string; status: string; compliance: boolean; amountCents: number; noAnswer: boolean; choice: string | null; answer: string; askUntil: Date | null }, now: Date, fightComplianceFrom: number | null = complianceFightFromCents()): boolean {
  return (
    dispute.stage === "chargeback" &&
    waits(dispute.status) &&
    planFor(dispute, fightComplianceFrom) === "ask" &&
    dispute.choice === null &&
    dispute.answer === "none" &&
    dispute.askUntil !== null &&
    now.getTime() < dispute.askUntil.getTime()
  );
}

/** The label of a request to Stripe: it names the dispute, the stage, the kind of answer and the attempt. */
export function answerLabel(dispute: { id: string; stage: string }, kind: "proof" | "give_in", attempt: number): string {
  return `dispute:${dispute.id}:${dispute.stage}:${kind}:${attempt}`;
}

/** The stage Stripe's status belongs to, checked against the stage a request was written down for. */
export function sameStage(status: string, stage: string): boolean {
  return stageOf(status) === (stage as Stage);
}

/**
 * Whether this dispute keeps its customer from making a new agreement to pay (plans/47, decision 9):
 *   - a chargeback that has not ended;
 *   - a chargeback the bank decided for the customer after the app's own proof went out,
 *     until the founder allows paying again.
 * A bank's question never does. Nor does a lost dispute the app did not fight (the host gave the
 * money back, the app left it alone, somebody else answered, or nobody did in time).
 */
export function stopsPaying(dispute: { stage: string; outcome: string | null; answer: string; payingAllowedAt: Date | null }): "open" | "lost" | null {
  if (dispute.stage !== "chargeback") return null;
  if (dispute.outcome === null) return "open";
  if (dispute.outcome === "lost" && dispute.answer === "proof" && dispute.payingAllowedAt === null) return "lost";
  return null;
}
