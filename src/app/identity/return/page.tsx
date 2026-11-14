import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { returnPath } from "@/lib/safe-next";
import { refreshIdentity } from "@/lib/safety/identity";
import { requireUser } from "@/lib/session";

/** Where Stripe sends people back. Coming back proves nothing; we ask Stripe. */
export default async function IdentityReturnPage(props: PageProps<"/identity/return">) {
  const user = await requireUser();
  const next = returnPath((await props.searchParams).next);
  let notice: string;
  try {
    const state = await refreshIdentity(user.id);
    notice = state.passed
      ? "Thank you. Your identity is confirmed."
      : state.pending
        ? "Thank you. Stripe is still checking; this usually takes a minute or two. Reload this page in a moment."
        : "The check did not go through. You can try again.";
  } catch (error) {
    console.error("[identity] could not read the result", error);
    notice = "We could not read the result from Stripe just now. Please reload this page in a minute.";
  }
  redirect(withNotice(`/identity${next ? `?next=${encodeURIComponent(next)}` : ""}`, notice));
}
