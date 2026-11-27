import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import type { AppCallPage, AppPayStep } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE, type Answer } from "@/lib/api-rules";
import { sameId } from "@/lib/book-rules";
import { isCallPage, isPayStep } from "@/lib/call-rules";
import { placeHold, type CardOutcome } from "@/lib/card";
import { useWatch } from "@/lib/here";
import { agoWords, clockWords, countdownWords, localTime } from "@/lib/home-rules";
import { useOpening } from "@/lib/opening";
import { BackLink, Button, Card, Heading, Loading, Notice, Page, Problem, TextLink, Words } from "@/ui/pieces";
import { Sentence } from "@/ui/sentence";
import { type, useColors } from "@/ui/theme";

/**
 * One call's page before the call (plans/45-phone-apps/08-the-calls-page.md): who and when, the
 * countdown to the room, the customer's confirm-and-pay step, and cancelling. Which of the call's
 * two people is reading, and what they are shown, is decided on the server.
 *
 * Paying places a hold in Stripe's own sheet: the money is held, never taken, by it. Whatever
 * the sheet reports, the app then asks the server, which asks Stripe; only the server's answer
 * moves the page on, and the same question is asked whenever this screen comes back to the front
 * with the hold still open. Cancelling shows first what it would mean, and sends that along: if
 * it has turned from free to charged meanwhile, nothing is cancelled and the page says what it
 * means now.
 */
export default function CallScreen() {
  const { id: given } = useLocalSearchParams<{ id?: string | string[] }>();
  const id = sameId(given);
  // A screen of its own for each call.
  return <OneCall key={id} id={id} />;
}

function OneCall({ id }: { id: string }) {
  const colors = useColors();
  const { refresh: askOpening } = useOpening();
  const watch = useWatch();
  const [page, setPage] = useState<AppCallPage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  /** What the app has to say about what was just tried, with the state the call's page was in: shown only while it still is. */
  const [said, setSaid] = useState<{ words: string; state: string | null } | null>(null);
  const [busy, setBusy] = useState<"pay" | "check" | "cancel" | null>(null);
  /** Stripe's sheet finished and the server has not yet said the money is held: the screen offers to ask again, without the card being entered twice. */
  const [unchecked, setUnchecked] = useState(false);
  /**
   * Why a cancellation was refused, in the server's sentence. It stays beside the cancel button whatever state the
   * page is in when it is read again: the reason is often that the state has just changed (a hold was placed).
   */
  const [cancelSaid, setCancelSaid] = useState<string | null>(null);
  /** The page came back to the front while a step was under way and could not be read then: it is read, hold included, when the step is through. */
  const owedLook = useRef(false);
  /** When the countdown last asked the server whether the room is open, so it never asks in a tight loop. */
  const dueAsked = useRef(0);
  const dueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  /** Every question gets a number when it is asked; only the answer to the newest is used. A step takes one as it begins. */
  const newest = useRef(0);
  const acting = useRef(false);
  const checking = useRef(0);
  const state = useRef<string | null>(null);
  const path = `/api/app/calls/${id}`;
  const refreshSeconds = page?.refreshSeconds ?? null;

  /** Takes an answer that should be the call's page: the page when it was one, null when not, nothing when a newer question has been asked since. */
  const settle = useCallback(
    (answer: Answer<AppCallPage>, mine: number): AppCallPage | null | undefined => {
      if (mine !== newest.current) return undefined;
      if (answer.ok && isCallPage(answer.data) && answer.data.id === id) {
        state.current = answer.data.state;
        // "Nothing was cancelled" is no longer true once the call is cancelled (from another phone, say).
        if (answer.data.state === "cancelled") setCancelSaid(null);
        setPage(answer.data);
        setProblem(null);
        setGone(false);
        if (answer.data.notice) setSaid({ words: answer.data.notice, state: answer.data.state });
        return answer.data;
      }
      if (!answer.ok && answer.code === "not_found") {
        state.current = null;
        setPage(null);
        setGone(true);
      } else if (!answer.ok && (answer.code === "not_valid" || answer.code === "paused")) {
        // A step that was refused, in the server's own sentence. The page stays as it is.
        setSaid({ words: answer.message, state: state.current });
      } else if (!answer.ok && answer.code !== "unreachable") {
        state.current = null;
        setPage(null);
        setGone(false);
        setProblem(answer.message);
        void askOpening();
      } else {
        setGone(false);
        setProblem(answer.ok ? UNREACHABLE : answer.message);
      }
      return null;
    },
    [id, askOpening],
  );

  /** One question that is answered with the call's page. The number is taken before it is sent. */
  const asked = useCallback(
    async (step: "" | "/pay-check" | "/cancel", body?: unknown): Promise<AppCallPage | null | undefined> => {
      const mine = ++newest.current;
      const answer = await ask<AppCallPage>(`${path}${step}`, step === "" ? {} : { body: body ?? {} });
      return settle(answer, mine);
    },
    [path, settle],
  );

  /** Reads the page. With `andHold`, a hold that is still open is also asked about at Stripe, by the server. */
  const look = useCallback(
    async (andHold: boolean, now = false) => {
      if (acting.current) {
        if (andHold) owedLook.current = true;
        return;
      }
      if (!id) {
        setGone(true);
        return;
      }
      const still = watch();
      if (!andHold && !now && checking.current > 0) return;
      if (andHold) checking.current++;
      try {
        const got = await asked("");
        // The customer's hold is still open: a card may have been approved while the app was away.
        // (Only while this page is still the one in front: after the person has left it, nothing more is asked for them.)
        if (got?.pay && andHold && !acting.current && still()) await asked("/pay-check");
      } finally {
        if (andHold) checking.current--;
      }
    },
    [id, asked, watch],
  );

  // While the screen is in front: now, and on coming back to the app.
  useFocusEffect(
    useCallback(() => {
      void look(true);
      const listener = AppState.addEventListener("change", (now) => {
        if (now === "active") void look(true);
      });
      return () => {
        listener.remove();
        // Leaving the page: an answer still on its way is no longer used (it would act for a page nobody is looking at),
        // and a reading that was owed to this visit is not made after it (coming back asks for its own).
        newest.current++;
        owedLook.current = false;
        if (dueTimer.current) clearTimeout(dueTimer.current);
      };
    }, [look]),
  );

  /** The countdown says the room should be open by now: the server is asked, at most once every few seconds. */
  const whenDue = useCallback(() => {
    const wait = 3_000 - (Date.now() - dueAsked.current);
    if (dueTimer.current) clearTimeout(dueTimer.current);
    if (wait <= 0) {
      dueAsked.current = Date.now();
      void look(false, true);
    } else {
      dueTimer.current = setTimeout(() => {
        dueAsked.current = Date.now();
        void look(false, true);
      }, wait);
    }
  }, [look]);
  // And, while the page can change by itself, as often as the server says.
  useFocusEffect(
    useCallback(() => {
      if (!refreshSeconds) return undefined;
      const timer = setInterval(() => (AppState.currentState === "active" ? void look(false) : undefined), refreshSeconds * 1000);
      return () => clearInterval(timer);
    }, [look, refreshSeconds]),
  );

  async function pull() {
    setPulling(true);
    await look(true);
    setPulling(false);
  }

  /** When a step is through: the page is read if the step wants it, or (with the hold) if a reading was asked for while the step was under way. */
  function afterStep(wanted: boolean) {
    const owed = owedLook.current;
    owedLook.current = false;
    if (owed) void look(true);
    else if (wanted) void look(false, true);
  }

  /** Confirm and pay: Stripe's sheet places the hold, and then the server says whether the money is held. */
  async function pay(words: NonNullable<AppCallPage["pay"]>) {
    if (acting.current) return;
    acting.current = true;
    const still = watch();
    newest.current++;
    setBusy("pay");
    setSaid(null);
    setUnchecked(false);
    const step = await ask<AppPayStep | AppCallPage>(`${path}/pay`, { body: {} });
    let outcome: CardOutcome | null = null;
    // The money is held already (the answer is then the page itself), or the sheet is shown.
    const usable = step.ok && isPayStep(step.data);
    if (step.ok && isPayStep(step.data)) outcome = await placeHold(step.data, id, words.button, still);
    if (outcome === "not_shown") outcome = null;
    if (!still()) {
      // The person has left this page meanwhile: nothing more is asked for them now. When they come back to it,
      // the page asks the server where the hold stands.
      acting.current = false;
      setBusy(null);
      // (Unless they are back already, on this very page: then it is read now, as coming back to it would have.)
      if (owedLook.current) {
        owedLook.current = false;
        void look(true);
      }
      return;
    }
    // Whatever the sheet said, and also when it was not shown: the server is asked where the hold stands.
    const after = await asked("/pay-check");
    if (after?.pay) {
      if (outcome === null) setSaid(!step.ok ? { words: step.message, state: after.state } : !usable && !isCallPage(step.data) ? { words: UNREACHABLE, state: after.state } : null);
      else setSaid({ words: outcome === "given_up" ? words.givenUp : outcome === "failed" ? words.notHeld : words.notConfirmed, state: after.state });
    }
    if (outcome === "finished" && (!after || after.pay)) setUnchecked(true);
    if (!step.ok && step.code !== "not_valid" && step.code !== "unreachable" && step.code !== "paused" && step.code !== "not_found") void askOpening();
    acting.current = false;
    setBusy(null);
    afterStep(!after && still());
  }

  /** Asks the server once more whether the money is held. Stripe's sheet is not opened again. */
  async function checkAgain(words: NonNullable<AppCallPage["pay"]>) {
    if (acting.current) return;
    acting.current = true;
    const still = watch();
    newest.current++;
    setBusy("check");
    setSaid(null);
    const after = await asked("/pay-check");
    if (after?.pay) setSaid({ words: words.notConfirmed, state: after.state });
    if (after && !after.pay) setUnchecked(false);
    acting.current = false;
    setBusy(null);
    // (Only while this page is still in front: coming back to it reads it anyway.)
    afterStep(!after && still());
  }

  /** Cancels the call, as it was shown to mean. If it means something else by now, nothing is cancelled and the page is read again. */
  async function cancel(shown: "free" | "late_charge") {
    if (acting.current) return;
    acting.current = true;
    const still = watch();
    const mine = ++newest.current;
    setBusy("cancel");
    setSaid(null);
    setCancelSaid(null);
    const answer = await ask<AppCallPage>(`${path}/cancel`, { body: { shown } });
    const done = settle(answer, mine);
    // Refused, in the server's sentence: it is kept beside the button, also once the page has been read again.
    if (done === null && !answer.ok && (answer.code === "not_valid" || answer.code === "paused")) {
      setSaid(null);
      setCancelSaid(answer.message);
    }
    acting.current = false;
    setBusy(null);
    afterStep(!done && still());
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/calls"));
  if (gone) {
    return (
      <Page title="Not found">
        <Words soft>There is no call here, or it is not yours.</Words>
        <Button label="Back" kind="plain" onPress={back} />
      </Page>
    );
  }
  if (!page) return problem ? <Problem words={problem} onRetry={() => void look(true)} /> : <Loading />;
  const saying = said && said.state === page.state ? said.words : null;
  const mayCheck = unchecked && page.pay !== null;
  const cancelling = page.cancel;
  return (
    <Page refreshing={pulling} onRefresh={() => void pull()}>
      <BackLink onBack={back} />
      <View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {page.title}
        </Text>
        <Text style={[styles.small, { color: colors.soft }]}>{page.roleWords}</Text>
      </View>
      {problem ? <Notice>{problem}</Notice> : null}

      <Card>
        <View>
          <Text style={[styles.small, { color: colors.soft }]}>Booked</Text>
          <Words>
            <Text style={styles.bold}>{localTime(page.startsAt)}</Text> to {localTime(page.endsAt)}
          </Words>
        </View>
        <Words soft>{page.paidHow}</Words>
      </Card>

      {page.words ? (
        <View>
          <Sentence parts={page.words} />
          {page.small ? <Words soft>{page.small}</Words> : null}
        </View>
      ) : null}

      {page.room ? <Countdown key={page.serverNow} page={page} room={page.room} onDue={whenDue} onEnter={() => router.push({ pathname: "/room/[id]", params: { id } })} /> : null}

      {page.pay ? (
        <Card>
          <Heading>{page.pay.title}</Heading>
          {page.pay.points.map((point, index) => (
            <Sentence key={index} parts={point} lead="• " />
          ))}
          {saying ? <Notice>{saying}</Notice> : null}
          {mayCheck ? <Button label={page.pay.checkAgain} busy={busy === "check"} disabled={busy !== null} onPress={() => void checkAgain(page.pay!)} /> : null}
          <Button label={page.pay.button} kind={mayCheck ? "plain" : "main"} busy={busy === "pay"} disabled={busy !== null} onPress={() => void pay(page.pay!)} />
        </Card>
      ) : saying ? (
        <Notice>{saying}</Notice>
      ) : null}

      {page.about ? (
        // Folded: a host may be showing her screen to someone.
        <Card>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: aboutOpen }} accessibilityLabel={page.about.title} onPress={() => setAboutOpen(!aboutOpen)} style={styles.fold}>
            <Text style={[styles.bodyBold, { color: colors.text }]}>
              {aboutOpen ? "▾" : "▸"} {page.about.title}
            </Text>
          </Pressable>
          {aboutOpen ? (
            <>
              <Words soft>Your private notes. Only you can see them.</Words>
              <Words>{page.about.text}</Words>
            </>
          ) : null}
        </Card>
      ) : null}

      {page.afterEnd ? <TextLink label={page.afterEnd.label} onPress={() => router.push({ pathname: "/ended", params: { call: page.id } })} /> : null}

      {cancelSaid && !cancelling ? <Notice>{cancelSaid}</Notice> : null}
      {cancelling ? (
        <View style={styles.cancel}>
          {cancelSaid ? <Notice>{cancelSaid}</Notice> : null}
          <Words soft>{cancelling.words}</Words>
          <Button
            label={cancelling.button}
            kind="danger"
            busy={busy === "cancel"}
            disabled={busy !== null}
            onPress={() => {
              // What cancelling means is said once more, and goes along with the yes. The question stays on the phone's
              // screen whatever happens beneath it: the yes counts only while this call's page is still the one in front.
              const still = watch();
              Alert.alert(cancelling.button, cancelling.words, [
                { text: cancelling.no, style: "cancel" },
                { text: cancelling.yes, style: "destructive", onPress: () => (still() ? void cancel(cancelling.shown) : undefined) },
              ]);
            }}
          />
        </View>
      ) : null}
    </Page>
  );
}

/**
 * The countdown to the room. It runs on a steady counter from the moment the server's answer
 * came, so it does not jump when the phone's clock is changed. Whether the room is open is the
 * server's word: when the counter says it should be by now, the server is asked, once.
 */
function Countdown({ page, room, onDue, onEnter }: { page: AppCallPage; room: NonNullable<AppCallPage["room"]>; onDue: () => void; onEnter: () => void }) {
  const colors = useColors();
  const drawnAt = Date.parse(page.serverNow);
  const [passed, setPassed] = useState(0);
  useEffect(() => {
    const startedAt = performance.now();
    const timer = setInterval(() => setPassed(performance.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = drawnAt + passed;
  const opensAt = Date.parse(room.opensAt);
  const startsAt = Date.parse(page.startsAt);
  const due = !room.open && now >= opensAt;
  const asked = useRef(false);
  useEffect(() => {
    if (!due || asked.current) return;
    asked.current = true;
    onDue();
  }, [due, onDue]);

  const words = countdownWords((opensAt - now) / 1000);
  const untilStart = (startsAt - now) / 1000;
  return (
    <View style={[styles.room, { backgroundColor: room.open ? colors.notice : colors.surface, borderColor: room.open ? colors.noticeLine : colors.line }]}>
      {room.open ? (
        <>
          <Heading>The room is open</Heading>
          <Words soft>{untilStart > 0 ? `The call starts in ${clockWords(untilStart)}.` : `The booked start was ${agoWords(-untilStart)}.`}</Words>
          {/* On to the call's own screen: the camera check, and then the room. Whether one may enter is the server's word there. */}
          <Button label={room.enter} onPress={onEnter} />
        </>
      ) : due ? (
        <Words soft>Checking…</Words>
      ) : (
        <>
          <Heading>{words ? (words.everySecond ? `The room opens in ${words.text}` : `The room opens ${words.text}`) : "The room opens soon"}</Heading>
          <Words soft>The room opens at {localTime(room.opensAt)}, a few minutes before the call.</Words>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: type.title, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6 },
  small: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
  bodyBold: { fontSize: type.body, fontWeight: "700", lineHeight: 22 },
  fold: { minHeight: 44, justifyContent: "center" },
  cancel: { gap: 8 },
  room: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 8 },
});
