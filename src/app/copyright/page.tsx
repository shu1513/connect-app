import type { Metadata } from "next";
import { LegalDocumentPage } from "@/legal/document-page";

export const metadata: Metadata = { title: "Copyright and Content Complaints" };

/** The text lives in src/legal/documents; this page only shows it (plans/46-agreements-live.md, part 1). */
export default function CopyrightPage(props: PageProps<"/copyright">) {
  return <LegalDocumentPage name="copyright-policy" searchParams={props.searchParams} />;
}
