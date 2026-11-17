import type { Metadata } from "next";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

export const metadata: Metadata = { title: "Terms" };
export default function TermsPage() {
  return (
    <SitePage warm className={warm.document}>
      <h1 className={warm.title}>Terms of service</h1>
      <p className="mt-4 text-sm">
        This is a placeholder. The real text will be written by a lawyer before the app opens to the public. Until then
        the app is for testing only.
      </p>
    </SitePage>
  );
}
