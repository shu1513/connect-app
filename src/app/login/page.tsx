import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { googleSignInConfigured } from "@/lib/auth";
import { getSignedIn } from "@/lib/session";

/** Fixed messages only. Text from the address bar is never shown as it is. */
const NOTICES: Record<string, string> = {
  reset: "Your password was changed. Log in with the new one.",
  link: "That link has expired or was already used. Log in to get a new one.",
};

function errorText(code: string): string {
  if (code === "account_not_linked") {
    return 'This email address already has an account that was never confirmed. Use "Forgot password" to make it yours, then log in.';
  }
  return "Signing in with Google did not work. Please try again.";
}

export default async function LoginPage(props: PageProps<"/login">) {
  const person = await getSignedIn();
  if (person && !person.closed) redirect("/");
  const { notice, error } = await props.searchParams;
  const message = typeof error === "string" ? errorText(error) : typeof notice === "string" ? NOTICES[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Log in</h1>
      {message && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {message}
        </p>
      )}
      <LoginForm google={googleSignInConfigured} />
    </main>
  );
}
