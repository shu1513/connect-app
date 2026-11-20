import { router } from "expo-router";
import { useState } from "react";
import { authClient } from "@/lib/auth";
import { emailLinks, NOT_REACHED, TOO_MANY } from "@/lib/auth-rules";
import { SERVER } from "@/lib/config";
import { Button, Field, Notice, Page, TextLink, Words } from "@/ui/pieces";

/**
 * Forgot password (plans/45-phone-apps/03-signing-in.md). The link in the email leads to the
 * website's page for choosing a new password; the app then asks to sign in with it. The answer
 * is the same whether or not the address has an account.
 */
export default function Forgot() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: emailLinks(SERVER).newPassword });
      if (result.error?.status === 429) setProblem(TOO_MANY);
      else if (result.error && result.error.status === undefined) setProblem(NOT_REACHED);
      else setDone(true);
    } catch {
      setProblem(NOT_REACHED);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <Page title="Check your email">
        <Notice>If that address has an account, we have sent a link to choose a new password. It works for one hour.</Notice>
        <Words>Choose your new password on the page the link opens. Then come back here and sign in with it.</Words>
        <Button label="Back to sign in" onPress={() => router.replace({ pathname: "/sign-in", params: { email: email.trim() } })} />
      </Page>
    );
  }
  return (
    <Page title="Forgot your password?">
      <Words>Enter your email address and we will send you a link to choose a new password.</Words>
      <Field label="Your email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" problem={problem ?? undefined} onSubmitEditing={() => void submit()} />
      <Button label="Send me a link" busy={busy} disabled={!email.trim()} onPress={() => void submit()} />
      <TextLink label="Back to sign in" onPress={() => router.back()} />
    </Page>
  );
}
