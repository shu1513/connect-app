import { describe, expect, it } from "vitest";
import { answerLabel, ASK_MS, askUntilFor, BEFORE_DUE_MS, canChoose, complianceFightFromCents, dueNow, planFor, sameStage, stopsPaying } from "./rules";

const at = (iso: string) => new Date(iso);
const NOW = at("2027-01-10T12:00:00Z");
const DAY = 24 * 3_600_000;
const chargeback = { stage: "chargeback", compliance: false, amountCents: 1333, noAnswer: false };

describe("the amount from which a compliance dispute is fought", () => {
  it("is 5,000 dollars unless the setting says otherwise (the founder's decision)", () => {
    expect(complianceFightFromCents(undefined)).toBe(500_000);
    expect(complianceFightFromCents("")).toBe(500_000);
  });

  it("can be another whole amount of dollars, or never", () => {
    expect(complianceFightFromCents("2000")).toBe(200_000);
    expect(complianceFightFromCents("never")).toBeNull();
    expect(complianceFightFromCents(" Never ")).toBeNull();
  });

  it("falls back to 5,000 dollars for a setting that is not an amount", () => {
    for (const odd of ["0", "-5", "12.5", "lots"]) expect(complianceFightFromCents(odd)).toBe(500_000);
  });
});

describe("what the app does about a stage that waits for an answer", () => {
  it("asks the host about a chargeback, and answers a bank's question at once", () => {
    expect(planFor(chargeback)).toBe("ask");
    expect(planFor({ ...chargeback, stage: "question" })).toBe("answer");
  });

  it("sends nothing when the bank takes no answer", () => {
    expect(planFor({ ...chargeback, noAnswer: true })).toBe("leave");
    expect(planFor({ ...chargeback, stage: "question", noAnswer: true })).toBe("leave");
  });

  it("leaves a compliance dispute under the founder's line alone, also when it comes as a question", () => {
    const small = { ...chargeback, compliance: true, amountCents: 499_999 };
    expect(planFor(small, 500_000)).toBe("leave");
    expect(planFor({ ...small, stage: "question" }, 500_000)).toBe("leave");
  });

  it("handles a compliance dispute at or above the line like any other", () => {
    expect(planFor({ ...chargeback, compliance: true, amountCents: 500_000 }, 500_000)).toBe("ask");
    expect(planFor({ ...chargeback, compliance: true, amountCents: 900_000 }, 500_000)).toBe("ask");
  });

  it("never fights a compliance dispute when the setting says never", () => {
    expect(planFor({ ...chargeback, compliance: true, amountCents: 2_400_000 }, null)).toBe("leave");
  });
});

describe("until when the host can choose", () => {
  it("is 24 hours when the bank's deadline is far away, or Stripe gives none", () => {
    expect(askUntilFor({ now: NOW, dueBy: at("2027-01-25T00:00:00Z"), hostCanChoose: true })?.getTime()).toBe(NOW.getTime() + ASK_MS);
    expect(askUntilFor({ now: NOW, dueBy: null, hostCanChoose: true })?.getTime()).toBe(NOW.getTime() + ASK_MS);
  });

  it("never reaches closer than 3 days to the bank's deadline", () => {
    const dueBy = new Date(NOW.getTime() + BEFORE_DUE_MS + 6 * 3_600_000);
    expect(askUntilFor({ now: NOW, dueBy, hostCanChoose: true })?.getTime()).toBe(NOW.getTime() + 6 * 3_600_000);
  });

  it("asks nobody when that leaves no time, or the host's account is closed", () => {
    expect(askUntilFor({ now: NOW, dueBy: new Date(NOW.getTime() + BEFORE_DUE_MS), hostCanChoose: true })).toBeNull();
    expect(askUntilFor({ now: NOW, dueBy: new Date(NOW.getTime() + DAY), hostCanChoose: true })).toBeNull();
    expect(askUntilFor({ now: NOW, dueBy: null, hostCanChoose: false })).toBeNull();
  });
});

describe("what is due to be sent", () => {
  const until = new Date(NOW.getTime() + ASK_MS);
  it("is nothing while the host's time runs and they have not chosen", () => {
    expect(dueNow({ plan: "ask", choice: null, askUntil: until, now: NOW })).toBeNull();
    expect(dueNow({ plan: "ask", choice: null, askUntil: until, now: new Date(until.getTime() - 1) })).toBeNull();
  });

  it("is the proof once their time is up: no answer counts as fight (the founder's rule)", () => {
    expect(dueNow({ plan: "ask", choice: null, askUntil: until, now: until })).toBe("proof");
  });

  it("is what the host chose, at once", () => {
    expect(dueNow({ plan: "ask", choice: "fight", askUntil: until, now: NOW })).toBe("proof");
    expect(dueNow({ plan: "ask", choice: "give_back", askUntil: until, now: NOW })).toBe("give_in");
  });

  it("is the proof at once when nobody is asked, and for a bank's question", () => {
    expect(dueNow({ plan: "ask", choice: null, askUntil: null, now: NOW })).toBe("proof");
    expect(dueNow({ plan: "answer", choice: null, askUntil: null, now: NOW })).toBe("proof");
  });

  it("is never anything for a dispute the app leaves alone, whatever was chosen", () => {
    expect(dueNow({ plan: "leave", choice: null, askUntil: null, now: NOW })).toBeNull();
    expect(dueNow({ plan: "leave", choice: "fight", askUntil: null, now: NOW })).toBeNull();
  });
});

describe("whether the host can still choose", () => {
  const open = { ...chargeback, status: "needs_response", choice: null, answer: "none", askUntil: new Date(NOW.getTime() + ASK_MS) };
  it("is yes for a chargeback that waits, in their time, with nothing chosen or sent", () => {
    expect(canChoose(open, NOW)).toBe(true);
  });

  it("is no once the time is up, something was chosen, or an answer is under way", () => {
    expect(canChoose(open, open.askUntil)).toBe(false);
    expect(canChoose({ ...open, choice: "fight" }, NOW)).toBe(false);
    expect(canChoose({ ...open, answer: "sending" }, NOW)).toBe(false);
    expect(canChoose({ ...open, askUntil: null }, NOW)).toBe(false);
  });

  it("is no for a bank's question, a dispute the bank is already deciding, and one the app leaves alone", () => {
    expect(canChoose({ ...open, stage: "question", status: "warning_needs_response" }, NOW)).toBe(false);
    expect(canChoose({ ...open, status: "under_review" }, NOW)).toBe(false);
    expect(canChoose({ ...open, status: "lost" }, NOW)).toBe(false);
    expect(canChoose({ ...open, noAnswer: true }, NOW)).toBe(false);
    expect(canChoose({ ...open, compliance: true }, NOW, 500_000)).toBe(false);
  });
});

describe("the label of a request to Stripe", () => {
  it("names the dispute, the stage, the kind of answer and the attempt", () => {
    expect(answerLabel({ id: "du_1", stage: "chargeback" }, "proof", 1)).toBe("dispute:du_1:chargeback:proof:1");
    expect(answerLabel({ id: "du_1", stage: "question" }, "proof", 1)).not.toBe(answerLabel({ id: "du_1", stage: "chargeback" }, "proof", 1));
    expect(answerLabel({ id: "du_1", stage: "chargeback" }, "give_in", 1)).not.toBe(answerLabel({ id: "du_1", stage: "chargeback" }, "proof", 1));
    expect(answerLabel({ id: "du_1", stage: "chargeback" }, "proof", 2)).not.toBe(answerLabel({ id: "du_1", stage: "chargeback" }, "proof", 1));
  });

  it("is never sent for a stage the dispute has left: a question's answer is not a chargeback's", () => {
    expect(sameStage("warning_needs_response", "question")).toBe(true);
    expect(sameStage("needs_response", "question")).toBe(false);
    expect(sameStage("needs_response", "chargeback")).toBe(true);
  });
});

describe("whether a dispute keeps its customer from a new agreement to pay", () => {
  const lostAfterProof = { stage: "chargeback", outcome: "lost", answer: "proof", payingAllowedAt: null };
  it("does while a chargeback is open, whatever was sent", () => {
    for (const answer of ["none", "sending", "proof", "given_in"]) expect(stopsPaying({ stage: "chargeback", outcome: null, answer, payingAllowedAt: null })).toBe("open");
  });

  it("does after a chargeback lost after the app's own proof, until the founder allows paying again", () => {
    expect(stopsPaying(lostAfterProof)).toBe("lost");
    expect(stopsPaying({ ...lostAfterProof, payingAllowedAt: NOW })).toBeNull();
  });

  it("does not after a loss the app did not fight: the host gave the money back, somebody else answered, nobody did", () => {
    for (const answer of ["given_in", "not_ours", "unknown", "none"]) expect(stopsPaying({ ...lostAfterProof, answer })).toBeNull();
  });

  it("does not once a chargeback is won or closed", () => {
    expect(stopsPaying({ ...lostAfterProof, outcome: "won" })).toBeNull();
    expect(stopsPaying({ ...lostAfterProof, outcome: "closed" })).toBeNull();
  });

  it("never does for a bank's question, open or ended", () => {
    expect(stopsPaying({ stage: "question", outcome: null, answer: "none", payingAllowedAt: null })).toBeNull();
    expect(stopsPaying({ stage: "question", outcome: "lost", answer: "proof", payingAllowedAt: null })).toBeNull();
  });
});
