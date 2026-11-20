import Link from "next/link";
import { CONFIRM_ID_FIRST } from "@/lib/booking/book-words";
import { SitePage } from "./site-page";

/**
 * Shown in place of a booking form when the customer must pass the identity check first: before a
 * free call, or because this host only takes people who have passed it. The link carries the page
 * to come back to. The sentences are the phone app's too (book-words.ts).
 */
export function ConfirmIdFirst({ reason, hostName, next }: { reason: "free" | "host"; hostName: string; next: string }) {
  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{CONFIRM_ID_FIRST.title}</h1>
      <p className="mt-4 text-sm">{CONFIRM_ID_FIRST.words(reason, hostName)}</p>
      <p className="mt-2 text-sm opacity-70">{CONFIRM_ID_FIRST.small(hostName)}</p>
      <p className="mt-4 text-sm">
        <Link href={`/identity?next=${encodeURIComponent(next)}`} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {CONFIRM_ID_FIRST.button}
        </Link>
      </p>
    </SitePage>
  );
}
