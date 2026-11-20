import type { Metadata } from "next";
import { LegalDocumentPage } from "@/legal/document-page";

export const metadata: Metadata = { title: "Identity Check Notice" };

/** The text lives in src/legal/documents; this page only shows it (plans/46-agreements-live.md, part 1). */
export default function IdentityNoticePage(props: PageProps<"/identity-notice">) {
  return <LegalDocumentPage name="identity-check-notice" searchParams={props.searchParams} />;
}
