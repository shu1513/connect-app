import { describe, expect, it, vi } from "vitest";

// Only the sentences are tried here: the question to the database is covered by scripts/dispute-answers-check.ts
// and, for the phone app, by scripts/app-booking-check.ts.
vi.mock("@/db", () => ({ db: {}, schema: {} }));

import { STOPPED_AFTER_LOSS, STOPPED_IN_APP, STOPPED_WHILE_OPEN } from "./paying";

describe("why nothing new that costs money can be started", () => {
  it("the website says that a bank dispute is the reason", () => {
    expect(STOPPED_WHILE_OPEN).toContain("Your bank has an open dispute about a payment on Connect.");
    expect(STOPPED_AFTER_LOSS).toContain("after a bank dispute");
  });

  it("the phone app's sentence names no bank and no dispute, and says where Connect's own message is", () => {
    expect(STOPPED_IN_APP).toBe("You cannot start anything new that costs money on Connect right now. Connect has written to you about it: the message is in your email, and on your Messages page on the website.");
    expect(STOPPED_IN_APP).not.toMatch(/bank|dispute|chargeback|contribution|tip|project/i);
    // "Your messages" alone would, in an app, be the conversations between two people.
    expect(STOPPED_IN_APP).not.toMatch(/Your messages say more/);
  });
});
