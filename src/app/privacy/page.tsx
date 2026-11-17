import type { Metadata } from "next";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Privacy" };
export default function PrivacyPage() {
  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Privacy policy</h1>
      <p className="mt-4 text-sm">
        This is a placeholder. The real text will be written by a lawyer before the app opens to the public. Until then
        the app is for testing only.
      </p>
      <p className="mt-4 text-sm">
        To confirm an Instagram or YouTube account, we read its public bio (on YouTube, the channel&apos;s description)
        through Instagram&apos;s or YouTube&apos;s own service and look for the code. We do not keep the text.
      </p>
      <p className="mt-4 text-sm">
        When you connect TikTok by signing in there, we read the account&apos;s number and name, nothing else, and we keep
        no key.
      </p>
    </SitePage>
  );
}
