import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { googleSignInConfigured } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";
import { getSignedIn } from "@/lib/session";

/** Fixed messages only. Text from the address bar is never shown as it is. */
const NOTICES: Record<string, string> = {
  reset: "Your password was changed. Log in with the new one.",
  link: "That link has expired or was already used. Log in to get a new one.",
  secured: "Your second step is set up. Log in with your password and a code from your app.",
};

function errorText(code: string): string {
  if (code === "account_not_linked") {
    return 'This email address already has an account that was never confirmed. Use "Forgot password" to make it yours, then log in.';
  }
  if (code === "email_not_verified") {
    return "Google says the email address of that account has not been confirmed. Confirm it with Google first, or sign up with a password.";
  }
  return "Signing in with Google did not work. Please try again.";
}

export default async function LoginPage(props: PageProps<"/login">) {
  const person = await getSignedIn();
  // Only someone who can get further is sent on. Anyone else stays here, so they can never be bounced back and forth.
  const { notice, error, next: nextParam } = await props.searchParams;
  const next = safeNext(nextParam);
  if (person && !person.closed && person.emailVerified) redirect(next);
  const message = typeof error === "string" ? errorText(error) : typeof notice === "string" ? NOTICES[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Log in</h1>
      {message && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {message}
        </p>
      )}
      <LoginForm google={googleSignInConfigured} next={next} />
    </main>
  );
}
