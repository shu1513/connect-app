import { describe, expect, it } from "vitest";
import { topPriceEmail } from "./top-price-email";

describe("the email a host gets when her price came down with her top price (plans/48)", () => {
  const { subject, text } = topPriceEmail({ name: "Hana" }, { topPricePer15Cents: 150_000, priceWas: 200_000 }, "https://connect.example");
  it("says the new price in its subject", () => {
    expect(subject).toBe("Your price on Connect is now $1500.00 per 15 minutes");
  });
  it("says what the price was, what it is now, and that nothing already made changes", () => {
    expect(text).toContain("Hi Hana,");
    expect(text).toContain("it is now $1500.00 per 15 minutes");
    expect(text).toContain("Your price was $2000.00 per 15 minutes");
    expect(text).toContain("we have set it to $1500.00");
    expect(text).toContain("Requests and calls already made keep the price they were made at.");
  });
  it("says where the host can change her price, and whom to write to", () => {
    // Not "any price up to": a host with members cannot go below her member price.
    expect(text).toContain("The highest it can be is $1500.00 per 15 minutes");
    expect(text).not.toContain("any price");
    expect(text).toContain("https://connect.example/host");
    expect(text).toMatch(/write to \S+@\S+\./);
  });
});
