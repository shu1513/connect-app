import { describe, expect, it } from "vitest";
import { agreementBox, CONTRIBUTION_WORDING_VERSION } from "./wording";

describe("the box a person ticks for a monthly contribution", () => {
  it("today's box says the money can be taken sooner when a bank shortens the hold", () => {
    expect(agreementBox(1000)).toBe("I agree that Connect holds $10.00 on my card today and every month, and takes it three days later each time, or sooner if my bank shortens the hold, until I cancel.");
    expect(agreementBox(1000, CONTRIBUTION_WORDING_VERSION)).toBe(agreementBox(1000));
  });

  it("an older agreement is quoted as it read then, not as the box reads today", () => {
    expect(agreementBox(2500, "2026-11-19")).toBe("I agree that Connect holds $25.00 on my card today and every month, and takes it three days later each time, until I cancel.");
  });

  it("a version nobody knows reads as today's", () => {
    expect(agreementBox(1000, "never")).toBe(agreementBox(1000));
  });
});
