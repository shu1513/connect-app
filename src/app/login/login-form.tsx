"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (result.error) {
      setError("That email and password did not match.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  const input = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">
        Email
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <label className="block text-sm">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
