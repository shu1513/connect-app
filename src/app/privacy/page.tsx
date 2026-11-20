import type { Metadata } from "next";
import { LegalDocumentPage } from "@/legal/document-page";

export const metadata: Metadata = { title: "Privacy Policy" };

/** The text lives in src/legal/documents; this page only shows it (plans/46-agreements-live.md, part 1). */
export default function PrivacyPage(props: PageProps<"/privacy">) {
  return <LegalDocumentPage name="privacy-policy" searchParams={props.searchParams} />;
}
