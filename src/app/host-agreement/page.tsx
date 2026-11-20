import type { Metadata } from "next";
import { LegalDocumentPage } from "@/legal/document-page";

export const metadata: Metadata = { title: "Host Agreement" };

/** The text lives in src/legal/documents; this page only shows it (plans/46-agreements-live.md, part 1). */
export default function HostAgreementPage(props: PageProps<"/host-agreement">) {
  return <LegalDocumentPage name="host-agreement" searchParams={props.searchParams} />;
}
