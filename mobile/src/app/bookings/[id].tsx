import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import type { AppBooking, AppCardStep } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE, type Answer } from "@/lib/api-rules";
import { isBooking, isCardStep, sameId } from "@/lib/book-rules";
import { enterCard, type CardOutcome } from "@/lib/card";
import { useHere } from "@/lib/here";
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
  // The id as the server writes it; a link may carry it in capitals. Anything that is no id leads to "not found".
  const id = sameId(given);
  // A screen of its own for each request.
  return <OneRequest key={id} id={id} />;
}

function OneRequest({ id }: { id: string }) {
  const colors = useColors();
  const { refresh: askOpening } = useOpening();
  const here = useHere();
  const [page, setPage] = useState<AppBooking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  /**
   * What the app has to say about what was just tried (the card sheet, taking the request back), with the stage
   * the request was at. It is shown only while the request is still at that stage: "your card could not be
   * confirmed yet" never stands under a request that has since been sent.
   */
  const [said, setSaid] = useState<{ words: string; stage: string | null } | null>(null);
  const [busy, setBusy] = useState<"card" | "back" | null>(null);
  const [pulling, setPulling] = useState(false);
  /**
   * Every question to the server gets a number when it is asked, and only the answer to the newest question is
   * used. A step (the card, taking back) takes a number as it begins, so a reading that was still on its way can
   * never put back what the step changed.
   */
  const newest = useRef(0);
  /** A step is under way: nothing else is asked meanwhile. */
  const acting = useRef(false);
  /** The stage the screen shows, for words that belong to it. */
  const stage = useRef<string | null>(null);
  const path = `/api/app/bookings/${id}`;
  const refreshSeconds = page?.refreshSeconds ?? null;

  /** Takes an answer that should be the request's page. Gives the page back when it was one, and was the newest. */
  const settle = useCallback(
    (answer: Answer<AppBooking>, mine: number): AppBooking | null => {
      if (mine !== newest.current) return null;
      if (answer.ok && isBooking(answer.data) && answer.data.id === id) {
        stage.current = answer.data.stage;
        setPage(answer.data);
        setProblem(null);
        setGone(false);
        // What a step just did ("your request was taken back") belongs to the stage it led to.
        if (answer.data.notice) setSaid({ words: answer.data.notice, stage: answer.data.stage });
        return answer.data;
      }
      if (!answer.ok && answer.code === "not_found") {
        // No such request, or not this person's: the same answer either way, and nothing of an earlier answer stays.
        stage.current = null;
        setPage(null);
        setGone(true);
      } else if (!answer.ok && (answer.code === "not_valid" || answer.code === "paused" || answer.code === "switched_off")) {
        // A step that was refused, in the server's own sentence. The page stays as it is.
        setSaid({ words: answer.message, stage: stage.current });
      } else if (!answer.ok && answer.code !== "unreachable") {
        stage.current = null;
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

  /** One question that is answered with the request's page. The number is taken before it is sent. */
  const asked = useCallback(
    async (step: "" | "/card-saved" | "/take-back"): Promise<AppBooking | null> => {
      const mine = ++newest.current;
      const answer = await ask<AppBooking>(`${path}${step}`, step === "" ? {} : { body: {} });
      return settle(answer, mine);
    },
    [path, settle],
  );

  /** Reads the page. With `andCard`, a request at its card step is also asked about at Stripe, by the server. */
  const look = useCallback(
    async (andCard: boolean) => {
      if (acting.current) return;
      if (!id) {
        setGone(true);
        return;
      }
      const got = await asked("");
      if (got?.card && andCard && !acting.current) await asked("/card-saved");
    },
    [id, asked],
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
    // From here on, a reading that was still on its way no longer counts.
    newest.current++;
    setBusy("card");
    setSaid(null);
    const step = await ask<AppCardStep>(`${path}/card`, { body: {} });
    let outcome: CardOutcome | null = null;
    // The sheet is shown only on the screen it was asked for, to the person who asked: not after they have left
    // it, and not to somebody who has signed in since.
    if (step.ok && isCardStep(step.data) && here()) outcome = await enterCard(step.data, id, words.button);
    // Whatever the sheet said, and also when it was not shown: the server is asked where the request stands.
    const after = await asked("/card-saved");
    if (after?.card) {
      if (outcome === null) setSaid({ words: step.ok ? UNREACHABLE : step.message, stage: after.stage });
      else setSaid({ words: outcome === "given_up" ? words.givenUp : outcome === "failed" ? words.notSaved : words.notConfirmed, stage: after.stage });
    }
    if (!step.ok && step.code !== "not_valid" && step.code !== "unreachable" && step.code !== "paused" && step.code !== "switched_off") void askOpening();
    acting.current = false;
    setBusy(null);
    // No page came back (the question was refused, or could not be asked): read it, so the screen shows where the
    // request really stands.
    if (!after) void look(false);
  }

  async function takeBack() {
    if (acting.current) return;
    acting.current = true;
    newest.current++;
    setBusy("back");
    setSaid(null);
    const done = await asked("/take-back");
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
  const sure = page.takeBackSure;
  const hostHandle = page.hostHandle;
  // Only what belongs to the stage on the screen is said.
  const saying = said && said.stage === page.stage ? said.words : null;
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
          {saying ? <Notice>{saying}</Notice> : null}
          <Button label={page.card.button} busy={busy === "card"} onPress={() => void card(page.card!)} />
        </Card>
      ) : saying ? (
        <Notice>{saying}</Notice>
      ) : null}

      {page.waitingWords ? <Words soft>{page.waitingWords}</Words> : null}
      {takeBackLabel && sure ? (
        <Button
          label={takeBackLabel}
          kind="plain"
          busy={busy === "back"}
          onPress={() =>
            // A tap by accident must not take a request back: it is asked once more, in the server's words.
            Alert.alert(takeBackLabel, sure.words, [
              { text: sure.no, style: "cancel" },
              { text: sure.yes, style: "destructive", onPress: () => void takeBack() },
            ])
          }
        />
      ) : null}

      {page.call ? (
        <Card>
          <Words>Your call is on your Calls page.</Words>
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
