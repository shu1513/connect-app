import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { authClient, checkEmailStep, forgetStep } from "@/lib/auth";
import { emailLinks, NOT_REACHED, TOO_MANY } from "@/lib/auth-rules";
import { SERVER } from "@/lib/config";
import { Button, Loading, Notice, Page, TextLink, Words } from "@/ui/pieces";

/**
 * "Check your email" (plans/45-phone-apps/03-signing-in.md). The link in the email is opened on
 * the phone and confirms the address on the website; that signs in the browser, not the app. So,
 * back here, the person signs in with the password. The phone remembers that this is where they
 * were, and for which address, so the screen is still here after the app was closed.
 */
export default function CheckEmail() {
  const { unconfirmed } = useLocalSearchParams<{ unconfirmed?: string }>();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void checkEmailStep().then(setEmail);
  }, []);

  async function sendAgain() {
    if (!email) return;
    setBusy(true);
    setSent(null);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: emailLinks(SERVER).afterConfirming });
      // The same words whether or not that address has an account waiting.
      setSent(result.error?.status === 429 ? TOO_MANY : result.error && result.error.status === undefined ? NOT_REACHED : "If that address has an account waiting to be confirmed, we have sent a new link.");
    } catch {
      setSent(NOT_REACHED);
    }
    setBusy(false);
  }

  async function startOver() {
    await forgetStep();
    router.replace("/");
  }

  if (email === undefined) return <Loading />;
  return (
    <Page title="Check your email">
      {unconfirmed ? <Notice>Your password was right, but this address is not confirmed yet. We have sent you a new link.</Notice> : null}
      <Words>{email ? `We sent a link to ${email}. Open it on this phone to confirm your address.` : "We sent you a link. Open it on this phone to confirm your address."}</Words>
      <Words>Then come back here and sign in with your password.</Words>
      <Words soft>It can take a minute to arrive. Look in your spam folder too.</Words>
      <Button label="I have confirmed it: sign in" onPress={() => router.push(email ? { pathname: "/sign-in", params: { email } } : "/sign-in")} />
      {sent ? <Notice>{sent}</Notice> : null}
      {email ? <Button label="Send the link again" kind="plain" busy={busy} onPress={() => void sendAgain()} /> : null}
      <TextLink label="Use a different address" onPress={() => void startOver()} />
    </Page>
  );
}
