import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type { AppIdentity, AppIdentityStart } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { isIdentity, isStripeCheckPage } from "@/lib/book-rules";
import { useOpening } from "@/lib/opening";
import { BackLink, Button, Loading, Notice, Page, Problem, Title, Words } from "@/ui/pieces";

/** How often the app asks again while Stripe is still looking at a check. */
const PENDING_SECONDS = 5;

/**
 * "Confirm who you are": the identity check (plans/45-phone-apps/06-asking-for-a-call.md,
 * decision 6). The check itself happens on Stripe's own page, in the phone's browser sheet over
 * the app; the app opens that page and nothing else there. Nothing of the app's sign-in goes into
 * the sheet, and nothing the sheet shows is believed: where the check stands is asked of the
 * server, for the person signed in to the app, and the server asks Stripe.
 */
export default function IdentityScreen() {
  const { refresh: askOpening } = useOpening();
  const [state, setState] = useState<AppIdentity | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const newest = useRef(0);
  const busy = useRef(false);
  const pending = state?.pending === true && !state.passed;

  const load = useCallback(async () => {
    const mine = ++newest.current;
    const answer = await ask<AppIdentity>("/api/app/identity");
    if (mine !== newest.current) return;
    if (answer.ok && isIdentity(answer.data)) {
      setState(answer.data);
      setProblem(null);
    } else if (!answer.ok && answer.code !== "unreachable") {
      setState(null);
      setProblem(answer.message);
      void askOpening();
    } else {
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [askOpening]);

  // While the screen is in front: now, on coming back to the app (the browser sheet was closed, or the link on
  // Connect's page was pressed), and every few seconds while Stripe is still looking.
  useFocusEffect(
    useCallback(() => {
      void load();
      const listener = AppState.addEventListener("change", (now) => {
        if (now !== "active") return;
        // Back in the app: an iPhone's browser sheet is closed if it is still up (Android's closes with its own button).
        if (Platform.OS === "ios") void Promise.resolve(WebBrowser.dismissBrowser()).catch(() => {});
        void load();
      });
      const timer = pending ? setInterval(() => (AppState.currentState === "active" ? void load() : undefined), PENDING_SECONDS * 1000) : null;
      return () => {
        listener.remove();
        if (timer) clearInterval(timer);
      };
    }, [load, pending]),
  );

  async function pull() {
    setPulling(true);
    await load();
    setPulling(false);
  }

  /** Asks the server to start a check, and opens Stripe's page for it in the browser sheet. */
  async function start() {
    if (busy.current) return;
    busy.current = true;
    setStarting(true);
    setSaid(null);
    const answer = await ask<AppIdentityStart>("/api/app/identity/start", { body: {} });
    if (answer.ok && isStripeCheckPage(answer.data.url)) {
      // Only Stripe's own page is ever opened here, whatever the answer says.
      await WebBrowser.openBrowserAsync(answer.data.url).catch(() => setSaid("The page for the check could not be opened on this phone. Please try again."));
    } else if (!answer.ok && (answer.code === "not_valid" || answer.code === "paused" || answer.code === "unreachable")) {
      setSaid(answer.message);
    } else if (!answer.ok) {
      setSaid(answer.message);
      void askOpening();
    } else {
      setSaid(UNREACHABLE);
    }
    await load();
    busy.current = false;
    setStarting(false);
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  if (!state) return problem ? <Problem words={problem} onRetry={() => void load()} /> : <Loading />;
  return (
    <Page refreshing={pulling} onRefresh={() => void pull()}>
      <BackLink onBack={back} />
      <Title>{state.title}</Title>
      {problem ? <Notice>{problem}</Notice> : null}
      {state.words.map((words, index) => (
        <Words key={index}>{words}</Words>
      ))}
      {said ? <Notice>{said}</Notice> : null}
      {state.button ? <Button label={state.button} busy={starting} onPress={() => void start()} /> : null}
      {state.tries ? <Words soft>{state.tries}</Words> : null}
      {state.passed ? <Button label="Continue" onPress={back} /> : null}
      <Words soft>{state.small}</Words>
    </Page>
  );
}
