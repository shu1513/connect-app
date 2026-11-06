"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { finishSecuring } from "./actions";

const input = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";
const primary = "w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50";

/**
 * Setting up the admin's second login step: show the secret as a QR code for
 * an authenticator app, check one code from the app, then show the backup codes.
 */
export function SecureForm() {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.twoFactor.enable({ password: String(form.get("password") ?? ""), issuer: "Connect" });
    setBusy(false);
    if (result.error || !result.data || result.data.method !== "totp") {
      setError(result.error?.code === "INVALID_PASSWORD" ? "That password is not right." : "Could not start. Please try again.");
      return;
    }
    setQr(await QRCode.toDataURL(result.data.totpURI, { width: 220, margin: 1 }));
    setSecret(new URL(result.data.totpURI).searchParams.get("secret") ?? "");
    setBackupCodes(result.data.backupCodes);
    setStep("scan");
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.twoFactor.verifyTotp({ code: String(form.get("code") ?? "").replace(/\s/g, ""), trustDevice: false });
    setBusy(false);
    if (result.error) {
      setError("That code did not match. Check the app and try again.");
      return;
    }
    setStep("codes");
  }

  if (step === "password") {
    return (
      <form onSubmit={start} className="mt-6 space-y-4">
        <label className="block text-sm">
          Your password
          <input name="password" type="password" autoComplete="current-password" required className={input} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Starting…" : "Start"}
        </button>
      </form>
    );
  }

  if (step === "scan") {
    return (
      <form onSubmit={confirm} className="mt-6 space-y-4 text-sm">
        <ol className="list-decimal space-y-2 pl-5">
          <li>On your phone, open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).</li>
          <li>
            Add an account by scanning this code:
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code for the authenticator app" className="mt-2 rounded bg-white p-2" />
            <span className="mt-2 block opacity-70">
              If you cannot scan, enter this key by hand: <code className="font-mono">{secret}</code>
            </span>
          </li>
          <li>Type the 6-digit code the app shows now.</li>
        </ol>
        <label className="block">
          Code from the app
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className={input} />
        </label>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Checking…" : "Check the code"}
        </button>
      </form>
    );
  }

  return (
    <form action={finishSecuring} className="mt-6 space-y-4 text-sm">
      <p>
        <strong>Save these backup codes somewhere safe</strong> (a password manager, or printed). Each one works once, if you ever lose your
        phone. They will not be shown again.
      </p>
      <pre className="rounded border border-neutral-400 p-3 font-mono">{backupCodes.join("\n")}</pre>
      <p>When you press the button, you are logged out everywhere and log in again with your password and a code.</p>
      <button type="submit" className={primary} onClick={() => router.prefetch("/login")}>
        I have saved the codes. Finish.
      </button>
    </form>
  );
}
