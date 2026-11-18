import Link from "next/link";
import { SitePage } from "./site-page";

/**
 * Shown in place of a booking form when the customer must pass the identity check first: before a
 * free call, or because this host only takes people who have passed it. The link carries the page
 * to come back to.
 */
export function ConfirmIdFirst({ reason, hostName, next }: { reason: "free" | "host"; hostName: string; next: string }) {
  return (
    <SitePage warm className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">One thing first</h1>
      <p className="mt-4 text-sm">
        {reason === "free" ? "Before your first free call, please confirm who you are" : `${hostName} only takes calls from people who have confirmed their ID. Please confirm who you are`}
        : a photo of your ID and a selfie on Stripe&apos;s own pages, which we never see. It takes a couple of minutes and is needed once.
      </p>
      <p className="mt-2 text-sm opacity-70">{hostName} will see only that your ID is confirmed, never your ID or the name on it.</p>
      <p className="mt-4 text-sm">
        <Link href={`/identity?next=${encodeURIComponent(next)}`} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
          Confirm who I am
        </Link>
      </p>
    </SitePage>
  );
}
