import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import type { AppBooking, AppCardStep } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE, type Answer } from "@/lib/api-rules";
import { isBooking, isCardStep, isId } from "@/lib/book-rules";
import { enterCard, type CardOutcome } from "@/lib/card";
import { localTime } from "@/lib/home-rules";
import { useOpening } from "@/lib/opening";
import { BackLink, Button, Card, Heading, Loading, Notice, Page, Problem, TextLink, Words } from "@/ui/pieces";
import { Sentence } from "@/ui/sentence";
import { type, useColors } from "@/ui/theme";

/**
 * One request for a call, for the customer who made it
 * (plans/45-phone-apps/06-asking-for-a-call.md): where it stands, the card step of a paid one, and
 * taking it back. The page asks the server again by itself while the request waits.
 *
 * The card goes into Stripe's own sheet. Whatever the sheet reports, the app then asks the
 * server, which asks Stripe; only the server's answer moves the request on. The same question is
 * asked whenever this screen comes to the front at the card step, so a card saved while the app
 * was away (a bank's approval, the app closed meanwhile) is noticed.
 */
export default function RequestScreen() {
  const { id: given } = useLocalSearchParams<{ id?: string | string[] }>();
  const id = isId(given) ? given : "";
  // A screen of its own for each request.
  return <OneRequest key={id} id={id} />;
}

function OneRequest({ id }: { id: string }) {
  const colors = useColors();
  const { refresh: askOpening } = useOpening();
  const [page, setPage] = useState<AppBooking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  /** What the app has to say about what was just tried: the card sheet, taking the request back. */
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState<"card" | "back" | null>(null);
  const [pulling, setPulling] = useState(false);
  const newest = useRef(0);
  /** A step is under way (the card sheet is up, a request is being taken back): nothing else is asked meanwhile. */
  const acting = useRef(false);
  const path = `/api/app/bookings/${id}`;
  const refreshSeconds = page?.refreshSeconds ?? null;

  /** Takes an answer that should be the request's page. Gives the page back when it was one. */
  const settle = useCallback(
    (answer: Answer<AppBooking>, mine: number): AppBooking | null => {
      if (mine !== newest.current) return null;
      if (answer.ok && isBooking(answer.data) && answer.data.id === id) {
        setPage(answer.data);
        setProblem(null);
        setGone(false);
        // What a step just did ("your request was taken back") is kept on the screen: the page is read again by
        // itself, and a later reading no longer carries it.
        if (answer.data.notice) setSaid(answer.data.notice);
        return answer.data;
      }
      if (!answer.ok && answer.code === "not_found") {
        // No such request, or not this person's: the same answer either way, and nothing of an earlier answer stays.
        setPage(null);
        setGone(true);
      } else if (!answer.ok && (answer.code === "not_valid" || answer.code === "paused")) {
        // A step that was refused, in the server's own sentence. The page stays as it is.
        setSaid(answer.message);
      } else if (!answer.ok && answer.code !== "unreachable") {
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

  /** Reads the page. With `andCard`, a request at its card step is also asked about at Stripe, by the server. */
  const look = useCallback(
    async (andCard: boolean) => {
      if (acting.current) return;
      if (!id) {
        setGone(true);
        return;
      }
      const got = settle(await ask<AppBooking>(path), ++newest.current);
      if (got?.stage === "card" && andCard && !acting.current) settle(await ask<AppBooking>(`${path}/card-saved`, { body: {} }), ++newest.current);
    },
    [id, path, settle],
  );

  // While the screen is in front: now, on coming back to the app, and, while the request can still change by
  // itself, as often as the server says.
  useFocusEffect(
    useCallback(() => {
      void look(true);
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") void look(true);
      });
      const timer = refreshSeconds ? setInterval(() => (AppState.currentState === "active" ? void look(false) : undefined), refreshSeconds * 1000) : null;
      return () => {
        listener.remove();
        if (timer) clearInterval(timer);
      };
    }, [look, refreshSeconds]),
  );

  async function pull() {
    setPulling(true);
    await look(true);
    setPulling(false);
  }

  /** The card step: Stripe's sheet, and then the server's word on whether the card was saved. */
  async function card(words: NonNullable<AppBooking["card"]>) {
    if (acting.current) return;
    acting.current = true;
    setBusy("card");
    setSaid(null);
    const step = await ask<AppCardStep>(`${path}/card`, { body: {} });
    let outcome: CardOutcome | null = null;
    if (step.ok && isCardStep(step.data)) outcome = await enterCard(step.data, id, words.button);
    // Whatever the sheet said, and also when it could not be shown: the server is asked where the request stands.
    const after = settle(await ask<AppBooking>(`${path}/card-saved`, { body: {} }), ++newest.current);
    if (after?.stage === "card") {
      if (outcome === null) setSaid(step.ok ? UNREACHABLE : step.message);
      else setSaid(outcome === "given_up" ? words.givenUp : outcome === "failed" ? words.notSaved : words.notConfirmed);
    }
    if (!step.ok && step.code !== "not_valid" && step.code !== "unreachable" && step.code !== "paused") void askOpening();
    acting.current = false;
    setBusy(null);
  }

  async function takeBack() {
    if (acting.current) return;
    acting.current = true;
    setBusy("back");
    setSaid(null);
    const done = settle(await ask<AppBooking>(`${path}/take-back`, { body: {} }), ++newest.current);
    acting.current = false;
    setBusy(null);
    // Refused (it was answered meanwhile, say): the page is read again, so it shows where the request stands now.
    if (!done) void look(false);
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  if (gone) {
    return (
      <Page title="Not found">
        <Words soft>There is no request here, or it is not yours.</Words>
        <Button label="Back" kind="plain" onPress={back} />
      </Page>
    );
  }
  if (!page) return problem ? <Problem words={problem} onRetry={() => void look(true)} /> : <Loading />;
  const takeBackLabel = page.takeBack;
  const hostHandle = page.hostHandle;
  return (
    <Page refreshing={pulling} onRefresh={() => void pull()}>
      <BackLink onBack={back} />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {page.title}
      </Text>
      {problem ? <Notice>{problem}</Notice> : null}

      <View>
        <Words>
          <Text style={styles.bold}>{page.stageWords}</Text>
        </Words>
        {page.reason ? <Words soft>{page.reason}</Words> : null}
      </View>

      <Card>
        <View>
          <Text style={[styles.label, { color: colors.soft }]}>When</Text>
          <Words>
            <Text style={styles.bold}>{localTime(page.startsAt)}</Text> ({page.minutes} minutes)
          </Words>
        </View>
        <View>
          <Text style={[styles.label, { color: colors.soft }]}>{page.price.label}</Text>
          <Words>
            <Text style={styles.bold}>{page.price.words}</Text>
          </Words>
        </View>
        {page.hearBy ? (
          <View>
            <Text style={[styles.label, { color: colors.soft }]}>You will hear by</Text>
            <Words>
              <Text style={styles.bold}>{localTime(page.hearBy)}</Text>
            </Words>
          </View>
        ) : null}
      </Card>

      {page.card ? (
        <Card>
          <Heading>{page.card.title}</Heading>
          <Words soft>{page.card.words}</Words>
          <Sentence parts={page.card.deadline} soft />
          {said ? <Notice>{said}</Notice> : null}
          <Button label={page.card.button} busy={busy === "card"} onPress={() => void card(page.card!)} />
        </Card>
      ) : said ? (
        <Notice>{said}</Notice>
      ) : null}

      {page.waitingWords ? <Words soft>{page.waitingWords}</Words> : null}
      {takeBackLabel ? (
        <Button
          label={takeBackLabel}
          kind="plain"
          busy={busy === "back"}
          onPress={() =>
            // A tap by accident must not take a request back: it is asked once more.
            Alert.alert(takeBackLabel, "The host will no longer see it. This cannot be undone.", [
              { text: "Keep it", style: "cancel" },
              { text: "Take it back", style: "destructive", onPress: () => void takeBack() },
            ])
          }
        />
      ) : null}

      {page.call ? (
        <Card>
          <Words>Your call is on your Calls page{page.call.words ? ` ${page.call.words}` : ""}.</Words>
          <Button label="Open your calls" kind="plain" onPress={() => router.push("/calls")} />
        </Card>
      ) : null}
      {hostHandle ? <TextLink label="Open the host's page" onPress={() => router.push(`/h/${hostHandle}`)} /> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: type.title, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6 },
  label: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
});
