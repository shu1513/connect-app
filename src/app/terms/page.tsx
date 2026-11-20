import type { Metadata } from "next";
import { LegalDocumentPage } from "@/legal/document-page";

export const metadata: Metadata = { title: "Terms of Service" };

/** The text lives in src/legal/documents; this page only shows it (plans/46-agreements-live.md, part 1). */
export default function TermsPage(props: PageProps<"/terms">) {
  return <LegalDocumentPage name="terms-of-service" searchParams={props.searchParams} />;
}
