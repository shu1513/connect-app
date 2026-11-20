import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { forgetStep, rememberCheckEmail, signIn } from "@/lib/auth";
import { CODE_RAN_OUT, CODE_TOO_MANY, GENERIC, NOT_REACHED } from "@/lib/auth-rules";
import { useOpening } from "@/lib/opening";
import { someoneSignedIn } from "@/lib/opening-rules";
import { Button, Field, Notice, Page, TextLink, Words } from "@/ui/pieces";

/**
 * Sign in (plans/45-phone-apps/03-signing-in.md): email and password, by the login tool's own
 * address, as the website's form does. The app hands over no "where to go afterwards": it
 * decides that itself, from what the server says about the person.
 */
export default function SignIn() {
  const given = useLocalSearchParams<{ email?: string | string[]; again?: string | string[] }>();
  const { refresh } = useOpening();
  // An address handed over by a link is taken only when it is one plain piece of text.
  const [email, setEmail] = useState(typeof given.email === "string" ? given.email : "");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** One sending at a time, whether it was the button or the keyboard's own "done" that asked. */
  const sending = useRef(false);

  async function submit() {
    const address = email.trim();
    if (sending.current || !address || !password) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await signIn(address, password);
      if (outcome.kind === "in") {
        await forgetStep();
        // The server now knows the person: asking it again opens the app (or the "18 and terms" step),
        // and this screen is gone. If it still knows nobody, that is said, never left as a dead screen.
        const now = await refresh();
        if (!someoneSignedIn(now)) setProblem(now.ok ? GENERIC : now.message || NOT_REACHED);
      } else if (outcome.kind === "code") router.push("/code");
      else if (outcome.kind === "confirm") {
        await rememberCheckEmail(address);
        router.replace({ pathname: "/check-email", params: { unconfirmed: "1" } });
      } else setProblem(outcome.words);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Page title="Sign in">
      {typeof given.again === "string" && given.again ? <Notice>{given.again === "many" ? CODE_TOO_MANY : CODE_RAN_OUT}</Notice> : null}
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
