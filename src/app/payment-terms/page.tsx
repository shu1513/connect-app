import type { Metadata } from "next";
import { LegalDocumentPage } from "@/legal/document-page";

export const metadata: Metadata = { title: "Payment Terms" };

/** The text lives in src/legal/documents; this page only shows it (plans/46-agreements-live.md, part 1). */
export default function PaymentTermsPage(props: PageProps<"/payment-terms">) {
  return <LegalDocumentPage name="payment-terms" searchParams={props.searchParams} />;
}
