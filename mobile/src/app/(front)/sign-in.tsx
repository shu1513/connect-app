import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { authClient, forgetStep, rememberCheckEmail } from "@/lib/auth";
import { GENERIC, NOT_REACHED, signInOutcome, type SignInOutcome } from "@/lib/auth-rules";
import { useOpening } from "@/lib/opening";
import { Button, Field, Page, TextLink, Words } from "@/ui/pieces";

/**
 * Sign in (plans/45-phone-apps/03-signing-in.md): email and password, by the login tool's own
 * address, as the website's form does. The app hands over no "where to go afterwards": it
 * decides that itself, from what the server says about the person.
 */
export default function SignIn() {
  const given = useLocalSearchParams<{ email?: string }>();
  const { refresh } = useOpening();
  const [email, setEmail] = useState(given.email ?? "");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const address = email.trim();
    let outcome: SignInOutcome;
    try {
      outcome = signInOutcome(await authClient.signIn.email({ email: address, password }));
    } catch {
      outcome = { kind: "problem", words: NOT_REACHED };
    }
    if (outcome.kind === "in") {
      await forgetStep();
      // The server now knows the person: asking it again opens the app (or the "18 and terms" step),
      // and this screen is gone. If it still knows nobody, that is said, never left as a dead screen.
      const now = await refresh();
      if (!(now.ok && now.data.me)) setProblem(now.ok ? GENERIC : now.message || NOT_REACHED);
      setBusy(false);
      return;
    }
    setBusy(false);
    if (outcome.kind === "code") router.push("/code");
    else if (outcome.kind === "confirm") {
      await rememberCheckEmail(address);
      router.replace({ pathname: "/check-email", params: { unconfirmed: "1" } });
    } else setProblem(outcome.words);
  }

  return (
    <Page title="Sign in">
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        problem={problem ?? undefined}
        onSubmitEditing={() => void submit()}
      />
      <Button label="Sign in" busy={busy} disabled={!email.trim() || !password} onPress={() => void submit()} />
      <TextLink label="Forgot password?" onPress={() => router.push("/forgot")} />
      <Words soft>Joined on the website with Google? Use &quot;Forgot password?&quot; once to set a password for the app.</Words>
      <TextLink label="New here? Create an account" onPress={() => router.replace("/sign-up")} />
    </Page>
  );
}
