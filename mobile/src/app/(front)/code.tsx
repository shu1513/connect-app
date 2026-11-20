import { router } from "expo-router";
import { useState } from "react";
import { authClient, forgetStep } from "@/lib/auth";
import { codeProblem, GENERIC, NOT_REACHED, typedCode } from "@/lib/auth-rules";
import { useOpening } from "@/lib/opening";
import { Button, Field, Page, TextLink, Words } from "@/ui/pieces";

/**
 * The second step of signing in, for anyone who has it switched on
 * (plans/45-phone-apps/03-signing-in.md): the 6-digit code from the authenticator app, or a
 * backup code. This phone is never remembered as trusted: the code is asked at every sign-in.
 */
export default function Code() {
  const { refresh } = useOpening();
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const { kind, code } = typedCode(typed);
    try {
      const result = kind === "app" ? await authClient.twoFactor.verifyTotp({ code, trustDevice: false }) : await authClient.twoFactor.verifyBackupCode({ code, trustDevice: false });
      if (result.error) {
        setProblem(codeProblem(result.error));
        setBusy(false);
        return;
      }
    } catch {
      setProblem(NOT_REACHED);
      setBusy(false);
      return;
    }
    await forgetStep();
    const now = await refresh();
    if (!(now.ok && now.data.me)) setProblem(now.ok ? GENERIC : now.message || NOT_REACHED);
    setBusy(false);
  }

  return (
    <Page title="One more step">
      <Words>Enter the 6-digit code from your authenticator app, or one of your backup codes.</Words>
      <Field label="Code" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" problem={problem ?? undefined} onSubmitEditing={() => void submit()} />
      <Button label="Continue" busy={busy} disabled={!typed.trim()} onPress={() => void submit()} />
      <TextLink label="Back to sign in" onPress={() => router.back()} />
    </Page>
  );
}
