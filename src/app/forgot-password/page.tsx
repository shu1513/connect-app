import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Forgot your password?</h1>
      <p className="mt-2 text-sm opacity-70">Enter your email address and we will send you a link to choose a new one.</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm">
        <Link href="/login" className="underline underline-offset-2">
          Back to log in
        </Link>
      </p>
    </main>
  );
}
