import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <SitePage bare warm className={warm.auth}>
      <h1 className={warm.title}>Forgot your password?</h1>
      <p className="mt-2 text-sm opacity-70">Enter your email address and we will send you a link to choose a new one.</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm">
        <Link href="/login" className="underline underline-offset-2">
          Back to log in
        </Link>
      </p>
    </SitePage>
  );
}
