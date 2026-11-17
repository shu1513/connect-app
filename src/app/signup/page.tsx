import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth-forms";
import { googleSignInConfigured } from "@/lib/auth";
import { returnPath } from "@/lib/safe-next";
import { getSignedIn } from "@/lib/session";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage(props: PageProps<"/signup">) {
  const person = await getSignedIn();
  // The page the person was on their way to, if any: only a path on this site, and short enough to carry.
  const next = returnPath((await props.searchParams).next) ?? "/";
  // Only someone who can get further is sent on. Anyone else stays here, so they can never be bounced back and forth.
  if (person && !person.closed && person.emailVerified) redirect(next);
  return (
    <SitePage bare warm className={warm.auth}>
      <h1 className={warm.title}>Create your account</h1>
      <SignUpForm google={googleSignInConfigured} next={next} />
    </SitePage>
  );
}
