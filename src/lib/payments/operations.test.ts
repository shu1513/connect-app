import { describe, expect, it, vi } from "vitest";

// Only the kinds of refusal are tried here: everything that asks the database or Stripe is covered by the check scripts.
vi.mock("@/db", () => ({ db: {}, schema: {} }));

import { MayNotActError, MoneyError, OutcomeUnknownError } from "./operations";

describe("a hold refused because the call's two people may not act", () => {
  const refused = new MayNotActError("This call can no longer be paid for.");

  it("is a refusal like any other for whoever only shows its sentence", () => {
    expect(refused).toBeInstanceOf(MoneyError);
    expect(refused.message).toBe("This call can no longer be paid for.");
  });

  it("can be told from every other refusal, and from an answer that is not known: only it gives the one try back", () => {
    expect(new MoneyError("The time to pay for this call has passed.")).not.toBeInstanceOf(MayNotActError);
    expect(new OutcomeUnknownError("not known yet")).not.toBeInstanceOf(MayNotActError);
    expect(refused).not.toBeInstanceOf(OutcomeUnknownError);
  });
});
