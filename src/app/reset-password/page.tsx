import Link from "next/link";
import { NewPasswordForm } from "@/components/auth-forms";

/** Where the emailed reset link lands. The link carries a one-time token. */
export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token, error } = await props.searchParams;
  const usable = typeof token === "string" && token.length > 0 && typeof error !== "string";

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
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
            <Link href="/forgot-password" className="underline underline-offset-2">
              Ask for a new link
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
