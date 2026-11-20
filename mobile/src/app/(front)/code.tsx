import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { codeIsPending, forgetStep, verifyCode } from "@/lib/auth";
import { GENERIC, NOT_REACHED } from "@/lib/auth-rules";
import { useOpening } from "@/lib/opening";
import { Button, Field, Loading, Page, TextLink, Words } from "@/ui/pieces";

/**
 * The second step of signing in, for anyone who has it switched on
 * (plans/45-phone-apps/03-signing-in.md): the 6-digit code from the authenticator app, or a
 * backup code. This phone is never remembered as trusted: the code is asked at every sign-in.
 *
 * The screen only makes sense right after a right password. Opened any other way (by a link,
 * or after the wait ran out) it leads back to signing in.
 */
export default function Code() {
  const { refresh } = useOpening();
  const [pending, setPending] = useState<boolean | null>(null);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    void codeIsPending().then(setPending);
  }, []);

  async function submit() {
    if (sending.current || !typed.trim()) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const wrong = await verifyCode(typed);
      if (wrong) {
        setProblem(wrong);
        return;
      }
      await forgetStep();
      const now = await refresh();
      if (!(now.ok && now.data.me)) setProblem(now.ok ? GENERIC : now.message || NOT_REACHED);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (pending === null) return <Loading />;
  if (!pending) return <Redirect href="/sign-in" />;
  return (
    <Page title="One more step">
      <Words>Enter the 6-digit code from your authenticator app, or one of your backup codes.</Words>
      <Field label="Code" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" problem={problem ?? undefined} onSubmitEditing={() => void submit()} />
      <Button label="Continue" busy={busy} disabled={!typed.trim()} onPress={() => void submit()} />
      <TextLink label="Back to sign in" onPress={() => router.replace("/sign-in")} />
    </Page>
  );
}
