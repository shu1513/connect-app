import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { checkEmailStep } from "@/lib/auth";
import { frontStart } from "@/lib/where-rules";
import { Button, Loading, Page, TextLink, Words } from "@/ui/pieces";

/**
 * The first opening (plans/45-phone-apps/03-signing-in.md): Connect's name, one line of what it
 * is, "Sign in" and "Create account". If this phone remembers that someone was at "check your
 * email" when the app was closed, that screen comes back instead.
 */
export default function FirstOpening() {
  const [step, setStep] = useState<"looking" | "check-email" | "first">("looking");
  useEffect(() => {
    void checkEmailStep().then((email) => setStep(frontStart(email)));
  }, []);
  if (step === "looking") return <Loading />;
  if (step === "check-email") return <Redirect href="/check-email" />;
  return (
    <Page title="Connect">
      <Words>Go from following to talking.</Words>
      <Words soft>Private one-to-one video calls with the people you follow.</Words>
      <Button label="Sign in" onPress={() => router.push("/sign-in")} />
      <Button label="Create account" kind="plain" onPress={() => router.push("/sign-up")} />
      {/* As on the website, hosts can be looked for, and their pages read, without an account (part 05). */}
      <TextLink label="Look for a host first" onPress={() => router.push("/find")} />
    </Page>
  );
}
