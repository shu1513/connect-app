import type { Metadata } from "next";
import Link from "next/link";
import { ResendConfirmationForm } from "@/components/auth-forms";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { returnPath } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage(props: PageProps<"/check-email">) {
  // Kept so that "send it again" and "back to log in" still lead to the page the person was heading for.
  const next = returnPath((await props.searchParams).next) ?? "/";
  return (
    <SitePage bare className={warm.auth}>
      <h1 className={warm.title}>Check your email</h1>
      <p className="mt-4 text-sm">
        We have sent you an email with a link. Open it within one hour to confirm your address. You can log in once that
        is done.
      </p>
      <p className="mt-2 text-sm opacity-70">It can take a minute to arrive. Look in your spam folder too.</p>

      <h2 className="mt-8 text-lg font-semibold">Did not get it?</h2>
      <ResendConfirmationForm next={next} />

      <p className="mt-8 text-sm">
        <Link href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to log in
        </Link>
      </p>
    </SitePage>
  );
}
