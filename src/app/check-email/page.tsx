import Link from "next/link";
import { ResendConfirmationForm } from "@/components/auth-forms";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-4 text-sm">
        We have sent you an email with a link. Open it within one hour to confirm your address. You can log in once that
        is done.
      </p>
      <p className="mt-2 text-sm opacity-70">It can take a minute to arrive. Look in your spam folder too.</p>

      <h2 className="mt-8 text-lg font-semibold">Did not get it?</h2>
      <ResendConfirmationForm />

      <p className="mt-8 text-sm">
        <Link href="/login" className="underline underline-offset-2">
          Back to log in
        </Link>
      </p>
    </main>
  );
}
