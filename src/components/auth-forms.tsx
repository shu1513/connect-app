"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const input = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";
const primary = "w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50";
const TOO_MANY = "Too many attempts. Please wait a while and try again.";
const GENERIC = "Something went wrong. Please try again.";

type AuthError = { code?: string; message?: string; status?: number } | null | undefined;

/** Turns the login tool's error into words for the person. Never says whether an address has an account. */
function passwordProblem(error: AuthError): string {
  if (error?.status === 429) return TOO_MANY;
  switch (error?.code) {
    case "PASSWORD_TOO_SHORT":
      return "Use a password of at least 12 characters.";
    case "PASSWORD_TOO_LONG":
      return "That password is too long.";
    case "PASSWORD_COMPROMISED":
      return error.message ?? "This password has appeared in a data leak. Please choose a different one.";
    case "INVALID_EMAIL":
      return "That email address does not look right.";
    default:
      return GENERIC;
  }
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
      {text}
    </p>
  );
}

function GoogleButton({ next = "/" }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: "/login" });
        setBusy(false);
      }}
      className="w-full rounded border border-neutral-500 px-4 py-2 font-medium disabled:opacity-50"
    >
      Continue with Google
    </button>
  );
}

function OrDivider() {
  return <p className="my-4 text-center text-sm opacity-60">or</p>;
}

export function LoginForm({ google, next }: { google: boolean; next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondStep, setSecondStep] = useState(false);

  // The second step: a code from the authenticator app, or a backup code.
  async function onCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const typed = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    // A 6-digit code is from the app; anything else is a backup code (which keeps its hyphen).
    const result = /^\d{6}$/.test(typed)
      ? await authClient.twoFactor.verifyTotp({ code: typed, trustDevice: false })
      : await authClient.twoFactor.verifyBackupCode({ code: typed, trustDevice: false });
    setBusy(false);
    if (result.error) {
      setError(result.error.status === 429 ? TOO_MANY : "That code did not work. Check the app and try again.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      // Where to go next. Also where the confirmation link leads, if this address still has to be confirmed.
      callbackURL: next === "/" ? "/welcome" : next,
    });
    setBusy(false);
    if (!result.error && (result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setSecondStep(true);
      return;
    }
    if (result.error) {
      if (result.error.code === "EMAIL_NOT_VERIFIED") {
        // The password was right, but the address is not confirmed yet. A new link has been sent.
        router.push("/check-email");
        return;
      }
      setError(result.error.status === 429 ? TOO_MANY : "That email and password did not match.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  if (secondStep) {
    return (
      <form onSubmit={onCode} className="mt-6 space-y-4">
        <p className="text-sm">One more step: enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
        <label className="block text-sm">
          Code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required className={input} />
        </label>
        <Problem text={error} />
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-6">
      {google && (
        <>
          <GoogleButton next={next} />
          <OrDivider />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm">
          Email
          <input name="email" type="email" autoComplete="username" required className={input} />
        </label>
        <label className="block text-sm">
          Password
          <input name="password" type="password" autoComplete="current-password" required className={input} />
        </label>
        <Problem text={error} />
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/forgot-password" className="underline underline-offset-2">
          Forgot password?
        </Link>
      </p>
      <p className="mt-2 text-sm">
        New here?{" "}
        <Link href="/signup" className="underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export function SignUpForm({ google }: { google: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signUp.email({
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      callbackURL: "/welcome",
    });
    setBusy(false);
    if (result.error) {
      setError(passwordProblem(result.error));
      return;
    }
    // The same screen whether the address is new or already has an account.
    router.push("/check-email");
  }

  return (
    <div className="mt-6">
      {google && (
        <>
          <GoogleButton />
          <OrDivider />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm">
          Your name
          <input name="name" type="text" autoComplete="name" required minLength={2} maxLength={50} className={input} />
        </label>
        <label className="block text-sm">
          Email
          <input name="email" type="email" autoComplete="username" required className={input} />
        </label>
        <label className="block text-sm">
          Password (at least 12 characters)
          <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={input} />
        </label>
        <Problem text={error} />
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Creating your account…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm opacity-70">
        Next, we will ask you to confirm that you are 18 or older and that you accept the terms.
      </p>
      <p className="mt-2 text-sm">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-2">
          Log in
        </Link>
      </p>
    </div>
  );
}

/** Sends the confirmation link again. Always answers the same way. */
export function ResendConfirmationForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.sendVerificationEmail({ email: String(form.get("email") ?? ""), callbackURL: "/welcome" });
    setBusy(false);
    if (result.error?.status === 429) {
      setError(TOO_MANY);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <p role="status" className="mt-4 text-sm">
        If that address has an account waiting to be confirmed, we have sent a new link.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block text-sm">
        Your email
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <Problem text={error} />
      <button type="submit" disabled={busy} className="rounded border border-neutral-500 px-3 py-1.5 text-sm disabled:opacity-50">
        {busy ? "Sending…" : "Send the link again"}
      </button>
    </form>
  );
}

/** Asks for a password-reset link. Always answers the same way. */
export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.requestPasswordReset({ email: String(form.get("email") ?? ""), redirectTo: "/reset-password" });
    setBusy(false);
    if (result.error?.status === 429) {
      setError(TOO_MANY);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <p role="status" className="mt-6 text-sm">
        If that address has an account, we have sent a link to choose a new password. It works for one hour.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">
        Your email
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <Problem text={error} />
      <button type="submit" disabled={busy} className={primary}>
        {busy ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}

/** Sets a new password using the token from the emailed link. */
export function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.resetPassword({ newPassword: String(form.get("password") ?? ""), token });
    setBusy(false);
    if (result.error) {
      setError(
        result.error.code === "INVALID_TOKEN"
          ? "This link has expired or was already used. Ask for a new one."
          : passwordProblem(result.error),
      );
      return;
    }
    router.push("/login?notice=reset");
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">
        New password (at least 12 characters)
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={input} />
      </label>
      <Problem text={error} />
      <button type="submit" disabled={busy} className={primary}>
        {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}

/** Changes the password of the logged-in person. Every other device is logged out. */
export function ChangePasswordForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError(null);
    setDone(false);
    const form = new FormData(formElement);
    const result = await authClient.changePassword({
      currentPassword: String(form.get("current") ?? ""),
      newPassword: String(form.get("password") ?? ""),
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.code === "INVALID_PASSWORD" ? "Your current password is not right." : passwordProblem(result.error));
      return;
    }
    formElement.reset();
    setDone(true);
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 max-w-sm space-y-3">
      <label className="block text-sm">
        Current password
        <input name="current" type="password" autoComplete="current-password" required className={input} />
      </label>
      <label className="block text-sm">
        New password (at least 12 characters)
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={input} />
      </label>
      <Problem text={error} />
      {done && (
        <p role="status" className="text-sm text-green-700">
          Your password was changed. Your other devices have been logged out.
        </p>
      )}
      <button type="submit" disabled={busy} className="rounded border border-neutral-500 px-3 py-1.5 text-sm disabled:opacity-50">
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
