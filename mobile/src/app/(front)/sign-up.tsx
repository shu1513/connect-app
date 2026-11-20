import { router } from "expo-router";
import { useRef, useState } from "react";
import { rememberCheckEmail, signUp } from "@/lib/auth";
import { signUpProblem } from "@/lib/auth-rules";
import { Button, Field, Page, TextLink, Words } from "@/ui/pieces";

/**
 * Create an account (plans/45-phone-apps/03-signing-in.md): the same account as on the website,
 * made by the login tool's own address. The link in the confirmation email leads to the website
 * (its full address is handed over; a short one would be turned into a link to the app).
 *
 * The next screen is the same whether the address is new or already has an account, so nobody
 * can find out here who has one.
 */
export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  async function submit() {
    if (sending.current) return;
    const address = email.trim();
    const first = signUpProblem({ name, email: address, password });
    if (first) {
      setProblem(first);
      return;
    }
    sending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const wrong = await signUp(name.trim(), address, password);
      if (wrong) {
        setProblem(wrong);
        return;
      }
      await rememberCheckEmail(address);
      router.replace("/check-email");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Page title="Create your account">
      <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={50} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" />
      <Field
        label="Password (at least 12 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        maxLength={128}
        problem={problem ?? undefined}
        onSubmitEditing={() => void submit()}
      />
      <Button label="Create account" busy={busy} onPress={() => void submit()} />
      <Words soft>Next, we will ask you to confirm that you are 18 or older and that you accept the terms.</Words>
      <TextLink label="Already have an account? Sign in" onPress={() => router.replace("/sign-in")} />
    </Page>
  );
}
