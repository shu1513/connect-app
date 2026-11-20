import { sellerLine } from "@/lib/profiles/profiles";

/**
 * One line on the pages where a call with a host is asked for: whether she offers calls as a business or as a
 * private person, by her own statement (plans/46-agreements-live.md, decision 10). Nothing for a host who has
 * not said.
 */
export async function SellerLine({ hostId, name }: { hostId: string; name: string }) {
  const line = await sellerLine(hostId, name);
  if (!line) return null;
  return (
    <p className="mt-2 text-sm opacity-70" data-seller-kind>
      {line}
    </p>
  );
}
