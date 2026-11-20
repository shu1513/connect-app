import { useCallback, useEffect, useRef, useState } from "react";
import type { AppWelcome, AppWelcomeDone } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { useOpening } from "@/lib/opening";
import { gotThrough } from "@/lib/opening-rules";
import { openWebsite } from "@/lib/website";
import { firstTimeZone, isWelcome, zonesMatching } from "@/lib/where-rules";
import { Button, Card, Field, Heading, Loading, Notice, Page, Problem, TextLink, Tick, Words } from "@/ui/pieces";

/** Said only if the step is done and the app, for once, did not move on by itself. */
const STILL_HERE = "That is done. Press \"Try again\" to carry on.";

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
 *
 * Whenever the server says this person does not belong on this screen (the step is done, the
 * sign-in ran out, this copy is too old), the app asks the opening question again, and that
 * answer moves her to where she belongs. If that question cannot be asked, the screen says so
 * and offers to try again; it is never left waiting with no way on.
 */
export default function Welcome() {
  const { opening, refresh, leave } = useOpening();
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
  const sending = useRef(false);

  /** The server decides where this person belongs. True when it was asked; false (and said on the screen) when it could not be. */
  const sortOut = useCallback(async () => {
    const now = await refresh();
    // A whole answer, or a refusal of Connect's own, moves her on. Half an answer, or none, does not: say so.
    if (gotThrough(now)) return true;
    setFailed(now.ok ? UNREACHABLE : now.message || UNREACHABLE);
    return false;
  }, [refresh]);

  const load = useCallback(async () => {
    const answer = await ask<AppWelcome>("/api/app/welcome");
    if (!answer.ok) {
      if (answer.code === "unreachable") setFailed(answer.message);
      // A refusal: no longer signed in, no longer confirmed, or this copy is too old.
      else if (await sortOut()) setFailed(answer.message);
      return;
    }
    // Half an answer is treated as not reaching Connect: say so, and offer to try again.
    if (!isWelcome(answer.data)) {
      setFailed(UNREACHABLE);
      return;
    }
    if (answer.data.done) {
      // The step is done, so this screen is about to go. Should it still be here (a newer question got in between
      // and did not get through), it says so and offers to try again, rather than wait for ever.
      if (await sortOut()) setFailed(STILL_HERE);
      return;
    }
    const first = firstTimeZone(answer.data.timeZone, phoneTimeZone(), answer.data.timeZones);
    setZone(first);
    setChoosing(first === null);
    setFailed(null);
    setStep(answer.data);
  }, [sortOut]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the screen's own first question to the server
    void load();
  }, [load]);

  async function submit() {
    if (sending.current || !adult || !terms || !zone) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await ask<AppWelcomeDone>("/api/app/welcome", { body: { adult, terms, timeZone: zone } });
      if (answer.ok) {
        if (await sortOut()) setFailed(STILL_HERE);
      } else if (answer.code === "not_valid" || answer.code === "unreachable") setProblem(answer.message);
      // Any other refusal means she no longer belongs here: the opening question says where she does.
      else if (await sortOut()) setProblem(answer.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
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
