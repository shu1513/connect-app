import type { Metadata } from "next";
import Link from "next/link";
import { NewPasswordForm } from "@/components/auth-forms";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

export const metadata: Metadata = { title: "Choose a new password" };

/** Where the emailed reset link lands. The link carries a one-time token. */
export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token, error } = await props.searchParams;
  const usable = typeof token === "string" && token.length > 0 && typeof error !== "string";

  return (
    <SitePage bare className={warm.auth}>
      <h1 className={warm.title}>Choose a new password</h1>
      {usable ? (
        <>
          <p className="mt-2 text-sm opacity-70">Saving it logs you out on every device, so only you can get back in.</p>
          <NewPasswordForm token={token} />
        </>
      ) : (
        <>
          <p role="alert" className="mt-4 text-sm">
            This link has expired or was already used.
          </p>
          <p className="mt-4 text-sm">
            <Link href="/forgot-password" className="inline-flex min-h-11 items-center underline underline-offset-2">
              Ask for a new link
            </Link>
          </p>
        </>
      )}
    </SitePage>
  );
}
