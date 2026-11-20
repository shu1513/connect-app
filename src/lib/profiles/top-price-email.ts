/**
 * The words of the email a host gets when her price came down because the founder lowered her
 * top price (plans/48). Kept apart from the sending (see emails.ts) so they can be read and
 * tested on their own.
 */
import { SUPPORT_EMAIL } from "@/lib/terms";

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export function topPriceEmail(host: { name: string }, change: { topPricePer15Cents: number; priceWas: number }, url: string): { subject: string; text: string } {
  const top = dollars(change.topPricePer15Cents);
  return {
    subject: `Your price on Connect is now ${top} per 15 minutes`,
    text: [
      `Hi ${host.name},`,
      "",
      `The highest price your Connect page can charge has changed: it is now ${top} per 15 minutes.`,
      "",
      `Your price was ${dollars(change.priceWas)} per 15 minutes, which is more than that, so we have set it to ${top}. New requests are at the new price. Requests and calls already made keep the price they were made at.`,
      "",
      `You can set any price up to ${top} on your Hosting page:`,
      `${url}/host`,
      "",
      `If you have a question about this, write to ${SUPPORT_EMAIL}. A person reads it.`,
      "",
      `—\nConnect · questions: ${SUPPORT_EMAIL}`,
    ].join("\n"),
  };
}
