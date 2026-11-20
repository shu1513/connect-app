import type { Metadata } from "next";
import { APP_ORIGIN } from "@/lib/auth-rules";
import { warm, warmFont } from "@/components/warm-ui";

export const metadata: Metadata = { title: "Back to Connect", robots: { index: false, follow: false } };

/**
 * Where Stripe sends someone who did the identity check from the phone app
 * (plans/45-phone-apps/06-asking-for-a-call.md, decision 6). It opens in the phone's browser
 * sheet, where nobody, or somebody else, may be signed in to the website. So this page asks for no
 * sign-in and can do no harm: it reads nothing from its address, knows nobody, shows no result
 * and changes nothing. The result is read by the app, from the server, for the person signed in
 * to the app.
 *
 * It has no top bar on purpose: the bar would show whoever the browser knows, who need not be
 * the person in the app.
 */
export default function IdentityDonePage() {
  return (
    <div className={`${warmFont.className} ${warm.root} ${warm.page}`}>
      <main className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">Thank you</h1>
        <p className="mt-4 text-sm">Return to the Connect app to see where your check stands. You can close this page.</p>
        <p className="mt-6 text-sm">
          {/* A fixed link into the app's own screen for the check. It carries nothing. */}
          <a href={`${APP_ORIGIN}identity`} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Return to the Connect app
          </a>
        </p>
      </main>
    </div>
  );
}
