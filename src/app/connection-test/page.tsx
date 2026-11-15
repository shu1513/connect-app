import type { Metadata } from "next";
import { ConnectionTest } from "@/components/connection-test";
import { SitePage } from "@/components/site-page";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Test your connection" };

/** The connection check on a page of its own, for any time: well before a call, or before switching on "available now". */
export default async function ConnectionTestPage() {
  await requireUser("/connection-test");
  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Test your connection</h1>
      <p className="mt-2 text-sm opacity-80">
        A short check of this device&apos;s connection to the video service, on the network you are on now. It takes about 12 seconds and does not
        use your camera or microphone. Only you see the answer, and nothing about it is kept.
      </p>
      <ConnectionTest auto />
      <p className="mt-4 text-sm opacity-70">
        The check looks at delay and at how much gets lost on the way. It does not measure speed, and it is only a warning: you can always join
        your call. The same check runs by itself on a call&apos;s page shortly before the call.
      </p>
    </SitePage>
  );
}
