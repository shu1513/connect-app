import { describe, expect, it } from "vitest";
import { payoutAccountRequest } from "./host-account";

const jo = { id: "user_1", name: "Jo Host", email: "jo@example.test" };

describe("what Stripe is asked for when a host's payout account is opened", () => {
  it("is, for a host in the United States, exactly what it always was", () => {
    // Field for field the request the app sent before hosts abroad existed (src/lib/payments/hosts.ts at pull request 47).
    expect(payoutAccountRequest(jo, "US", "https://connect.example")).toEqual({
      params: {
        contact_email: "jo@example.test",
        display_name: "Jo Host",
        defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
        dashboard: "express",
        identity: { country: "us" },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      },
      idempotencyKey: "host-account:user_1",
    });
  });
  it("for a host abroad also asks for card payments, in their country, with what Stripe would otherwise ask them about a business", () => {
    const { params, idempotencyKey } = payoutAccountRequest(jo, "GB", "https://connect.example");
    expect(idempotencyKey).toBe("host-account:user_1");
    expect(params).toEqual({
      contact_email: "jo@example.test",
      display_name: "Jo Host",
      defaults: {
        responsibilities: { fees_collector: "application", losses_collector: "application" },
        profile: { business_url: "https://connect.example", product_description: "Private one-to-one video calls with fans, booked and paid for on Connect." },
      },
      dashboard: "express",
      identity: { country: "gb" },
      configuration: {
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
        merchant: { mcc: "8999", capabilities: { card_payments: { requested: true } } },
      },
    });
  });
  it("leaves the web address out when there is no public one to give", () => {
    const { params } = payoutAccountRequest(jo, "DE", null);
    expect((params.defaults as { profile: Record<string, unknown> }).profile).toEqual({ product_description: "Private one-to-one video calls with fans, booked and paid for on Connect." });
    expect((params.identity as { country: string }).country).toBe("de");
  });
  it("uses one label for a person whatever the country, so a second press opens no second account", () => {
    expect(payoutAccountRequest(jo, "FR", null).idempotencyKey).toBe(payoutAccountRequest(jo, "US", null).idempotencyKey);
  });
});
