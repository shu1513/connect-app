import type { Metadata } from "next";
import { LegalDocumentPage } from "@/legal/document-page";

export const metadata: Metadata = { title: "Community Rules" };

/** The text lives in src/legal/documents; this page only shows it (plans/46-agreements-live.md, part 1). */
export default function RulesPage(props: PageProps<"/rules">) {
  return <LegalDocumentPage name="community-rules" searchParams={props.searchParams} />;
}
