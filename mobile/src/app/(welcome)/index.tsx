import { useCallback, useEffect, useState } from "react";
import type { AppWelcome, AppWelcomeDone } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { useOpening } from "@/lib/opening";
import { openWebsite } from "@/lib/website";
import { firstTimeZone, zonesMatching } from "@/lib/where-rules";
import { Button, Card, Field, Heading, Loading, Notice, Page, Problem, TextLink, Tick, Words } from "@/ui/pieces";

/** The phone's own time zone, as the phone names it; null if it will not say. */
function phoneTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The last step of signing up (plans/45-phone-apps/03-signing-in.md): "I am 18 or older", "I
 * accept the rules, the terms and the privacy policy", and the time zone. Shown once, and again
 * when the terms have changed. The server writes it, with its own clock, exactly as the
 * website's form does; the app only sends the two ticks and the time zone.
 */
export default function Welcome() {
  const { opening, refresh } = useOpening();
  const name = opening.kind === "ready" ? (opening.start.me?.name ?? "") : "";
  const [step, setStep] = useState<AppWelcome | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [zone, setZone] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const answer = await ask<AppWelcome>("/api/app/welcome");
    if (!answer.ok) {
      // No longer signed in, or no longer confirmed: the opening question sorts out where to go.
      if (answer.code !== "unreachable") void refresh();
      setFailed(answer.message);
      return;
    }
    if (answer.data.done) {
      void refresh();
      return;
    }
    const first = firstTimeZone(answer.data.timeZone, phoneTimeZone(), answer.data.timeZones);
    setZone(first);
    setChoosing(first === null);
    setFailed(null);
    setStep(answer.data);
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the screen's own first question to the server
    void load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const answer = await ask<AppWelcomeDone>("/api/app/welcome", { body: { adult, terms, timeZone: zone ?? "" } });
    if (answer.ok) {
      await refresh();
    } else {
      setProblem(answer.message);
    }
    setBusy(false);
  }

  async function leave() {
    await signOut();
    await refresh();
  }

  if (failed) {
    return (
      <Problem
        words={failed}
        onRetry={() => {
          setFailed(null);
          void load();
        }}
      />
    );
  }
  if (!step) return <Loading />;
  const found = zonesMatching(typed, step.timeZones);
  return (
    <Page title={step.returning ? "We have updated the rules" : "One last step"}>
      <Words soft>{step.returning ? `${name}, please read and accept the current rules to carry on.` : `Welcome, ${name}. Your email address is confirmed.`}</Words>
      <Tick label="I am 18 or older." checked={adult} onChange={setAdult} />
      <Tick label="I accept the rules, the terms and the privacy policy." checked={terms} onChange={setTerms} />
      <TextLink label="Read the rules" onPress={() => void openWebsite("/rules")} />
      <TextLink label="Read the terms" onPress={() => void openWebsite("/terms")} />
      <TextLink label="Read the privacy policy" onPress={() => void openWebsite("/privacy")} />
      <Card>
        <Heading>Your time zone</Heading>
        <Words soft>Used for the times in your emails.</Words>
        <Words>{zone ?? "Not chosen yet."}</Words>
        {choosing ? (
          <>
            <Field label="Find your time zone" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} placeholder="A city, for example London" />
            {found.map((name) => (
              <Button
                key={name}
                label={name}
                kind="plain"
                onPress={() => {
                  setZone(name);
                  setChoosing(false);
                  setTyped("");
                }}
              />
            ))}
            {typed.trim() && found.length === 0 ? <Words soft>No time zone with that name. Try the nearest large city.</Words> : null}
          </>
        ) : (
          <Button label="Change" kind="plain" onPress={() => setChoosing(true)} />
        )}
      </Card>
      {problem ? <Notice>{problem}</Notice> : null}
      <Button label="Continue" busy={busy} disabled={!adult || !terms || !zone} onPress={() => void submit()} />
      <TextLink label="Not you? Sign out" onPress={() => void leave()} />
    </Page>
  );
}
