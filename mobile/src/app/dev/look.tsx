import { router } from "expo-router";
import { useState } from "react";
import { Button, Card, Field, Heading, Notice, Page, Words } from "@/ui/pieces";

/**
 * A test screen, only reachable in a test build: every shared piece of the look on one page
 * (plans/45-phone-apps/02-the-frame.md, decision 6), to be looked at in light and dark and with
 * large text.
 */
export default function Look() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Page title="The look">
      <Words>Ordinary words, as every screen writes them.</Words>
      <Words soft>Softer words, for hints and captions.</Words>
      <Notice>A notice: something the person should know.</Notice>
      <Card>
        <Heading>A card</Heading>
        <Words soft>Cards hold one thing each: a call, a request, a host.</Words>
        <Field label="A field" value={name} onChangeText={setName} placeholder="Type here" />
        <Field label="A field with a problem" value="12 characters at least" problem="This is too short. Use at least 12 characters." editable={false} />
      </Card>
      <Button label="The main thing to do" onPress={() => {}} />
      <Button label="Something else" kind="plain" onPress={() => {}} />
      <Button label="Something that cannot be undone" kind="danger" onPress={() => {}} />
      <Button label="Waiting…" busy={busy} onPress={() => setBusy(true)} />
      <Button label="Not possible right now" disabled onPress={() => {}} />
      <Button label="Back" kind="plain" onPress={() => router.back()} />
    </Page>
  );
}
