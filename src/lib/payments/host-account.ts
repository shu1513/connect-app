/**
 * What Stripe is asked for when a host's payout account is opened (plans/27-hosts-abroad.md).
 * No database and no network, so the request can be tested field for field.
 */
import { HOME_COUNTRY } from "@/lib/profiles/countries";

export type HostUser = { id: string; name: string; email: string };

/**
 * What Stripe is asked for when a host's payout account is opened, and the label that makes a
 * second press open no second account. Only builds the request; asks nothing.
 *
 * For a host in the United States it is exactly what it always was: an account that only
 * receives transfers. Stripe refuses that kind for every other country, so a host abroad also
 * asks for "card payments" (their account never takes one: Connect charges the customer). For
 * them we fill in what Stripe would otherwise ask the host about a business: what they do, its
 * category (8999, professional services) and, when we have a public one, Connect's address.
 */
export function payoutAccountRequest(user: HostUser, country: string, siteAddress: string | null): { params: Record<string, unknown>; idempotencyKey: string } {
  // We pay Stripe's fees and carry any losses; the host only receives money.
  const responsibilities = { fees_collector: "application", losses_collector: "application" };
  const recipient = { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } };
  // The label for a US host is what it always was. Abroad it also names the country: a profile's country never
  // changes, so a second press still carries the same label, and a US account that was once opened under the
  // plain label and never saved (possible before a profile was needed) cannot stand in the way of the right one.
  const idempotencyKey = country === HOME_COUNTRY ? `host-account:${user.id}` : `host-account:${user.id}:${country}`;
  if (country === HOME_COUNTRY) {
    return {
      params: {
        contact_email: user.email,
        display_name: user.name,
        defaults: { responsibilities },
        dashboard: "express",
        identity: { country: "us" },
        configuration: { recipient },
      },
      idempotencyKey,
    };
  }
  return {
    params: {
      contact_email: user.email,
      display_name: user.name,
      defaults: { responsibilities, profile: { ...(siteAddress ? { business_url: siteAddress } : {}), product_description: "Private one-to-one video calls with fans, booked and paid for on Connect." } },
      dashboard: "express",
      identity: { country: country.toLowerCase() },
      configuration: { recipient, merchant: { mcc: "8999", capabilities: { card_payments: { requested: true } } } },
    },
    idempotencyKey,
  };
}
