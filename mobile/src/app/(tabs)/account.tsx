import { router } from "expo-router";
import { useState } from "react";
import { APP_VERSION, SERVER, TEST_SCREENS } from "@/lib/config";
import { useOpening } from "@/lib/opening";
import { Button, Card, Heading, Notice, Page, Words } from "@/ui/pieces";

/**
 * Account (plans/45-phone-apps/18-the-account-page.md). An empty page for now, with who the
 * server said is signed in when the app opened, so the frame can be seen to work, and, in a test
 * build only, the two test screens. What is switched on for the apps is not printed here: the app
 * uses the switches, and no screen says them (plans/45-phone-apps/09a, decision 4).
 */
export default function AccountPlace() {
  const { opening, askAgain, leave: signOutHere } = useOpening();
  const start = opening.kind === "ready" ? opening.start : null;
  const [leaving, setLeaving] = useState(false);
  const [notOut, setNotOut] = useState(false);

  /** Ends this phone's session on the server and wipes what the phone kept. The first screens open at once. */
  async function leave() {
    setLeaving(true);
    setNotOut(!(await signOutHere()));
    setLeaving(false);
  }

  return (
    <Page title="Account">
      <Words soft>Your account will be here.</Words>
      <Card>
        <Heading>What Connect said when the app opened</Heading>
        <Words>{start?.me ? `Signed in as ${start.me.name}.` : "Nobody is signed in."}</Words>
        <Words soft>
          App version {APP_VERSION}.{TEST_SCREENS ? ` Server: ${SERVER || "not set"}.` : ""}
        </Words>
        <Button label="Ask again" kind="plain" onPress={askAgain} />
      </Card>
      <Button label="Confirm who you are" kind="plain" onPress={() => router.push("/identity")} />
      <Button label="Sign out" kind="plain" busy={leaving} onPress={() => void leave()} />
      {notOut ? <Notice>Signing out did not work on this phone. Please try again.</Notice> : null}
      {TEST_SCREENS ? (
        <Card>
          <Heading>Test screens</Heading>
          <Words soft>Only in a test build.</Words>
          <Button label="Check the kits" kind="plain" onPress={() => router.push("/dev/kit-check")} />
          <Button label="The look" kind="plain" onPress={() => router.push("/dev/look")} />
        </Card>
      ) : null}
    </Page>
  );
}
