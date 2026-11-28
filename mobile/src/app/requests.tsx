import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import type { AppBooking, AppRequests, AppWaitingOne } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { isBooking, isRequests } from "@/lib/book-rules";
import { useWatch } from "@/lib/here";
import { localTime } from "@/lib/home-rules";
import { useOpening } from "@/lib/opening";
import { blocksSent } from "@/lib/requests-fresh";
import { Asker, askBeforeAccepting } from "@/requests/asker";
import { BackLink, Button, Card, Heading, Loading, Notice, Page, Problem, Title, Words } from "@/ui/pieces";
import { type, useColors } from "@/ui/theme";

/**
 * The requests a host has to answer (plans/45-phone-apps/07-a-hosts-requests.md): the website's
 * list on a phone. Requests for the same time sit together, so she can compare the people who
 * asked for it. Accept asks once more; Decline does not. After any answer the list is read again
 * and shows what really happened, whichever answer won (the website and the phone, or two taps).
 *
 * What is shown about each person is decided on the server. The list asks again by itself while
 * it is in front: a request for a call right now needs its answer within minutes.
 */
export default function RequestsScreen() {
  const colors = useColors();
  const watch = useWatch();
  const { refresh: askOpening } = useOpening();
  const [list, setList] = useState<AppRequests | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  /** Requests answered from this screen: they offer nothing more, also when the list could not be read again yet. */
  const [answered, setAnswered] = useState<readonly string[]>([]);
  /** Whose private note is unfolded. A list is on show longer than one request's page: the notes stay folded until asked for. */
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const newest = useRef(0);
  const acting = useRef(false);
  /** How many blocks had been sent when this list was last emptied or first shown (see lib/requests-fresh.ts). */
  const blocksSeen = useRef(blocksSent());
  const refreshSeconds = list?.refreshSeconds ?? null;

  const load = useCallback(async () => {
    if (acting.current) return;
    const mine = ++newest.current;
    const answer = await ask<AppRequests>("/api/app/requests");
    if (mine !== newest.current) return;
    if (answer.ok && isRequests(answer.data)) {
      setList(answer.data);
      // The list as it stands now no longer holds what was answered.
      setAnswered([]);
      setProblem(null);
    } else if (!answer.ok && answer.code !== "unreachable") {
      // Not for this person as things stand: the sentence, and the opening question says where they belong.
      setList(null);
      setProblem(answer.message);
      void askOpening();
    } else {
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [askOpening]);

  useFocusEffect(
    useCallback(() => {
      // Someone was blocked from a request's screen since this list was read: what it held is not shown again,
      // not while the fresh reading is on its way and not if that reading fails.
      if (blocksSent() !== blocksSeen.current) {
        blocksSeen.current = blocksSent();
        newest.current++;
        setList(null);
        setAnswered([]);
        setProblem(null);
      }
      void load();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") void load();
      });
      const timer = refreshSeconds ? setInterval(() => (AppState.currentState === "active" ? void load() : undefined), refreshSeconds * 1000) : null;
      return () => {
        listener.remove();
        if (timer) clearInterval(timer);
      };
    }, [load, refreshSeconds]),
  );

  async function pull() {
    setPulling(true);
    await load();
    setPulling(false);
  }

  /** Accept or decline one request. Whatever the answer, the list is then read again. */
  async function answer(request: AppWaitingOne, step: "accept" | "decline") {
    if (acting.current) return;
    acting.current = true;
    // A reading that was still on its way no longer counts.
    newest.current++;
    setAnswering(`${request.id} ${step}`);
    setSaid(null);
    const done = await ask<AppBooking>(`/api/app/bookings/${request.id}/${step}`, { body: {} });
    if (done.ok && isBooking(done.data)) {
      setSaid(done.data.notice);
      setAnswered((before) => [...before, request.id]);
    }
    else if (!done.ok && (done.code === "not_valid" || done.code === "paused" || done.code === "not_found" || done.code === "unreachable")) setSaid(done.message);
    else if (!done.ok) {
      setSaid(done.message);
      void askOpening();
    } else setSaid(UNREACHABLE);
    acting.current = false;
    setAnswering(null);
    await load();
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  if (!list) return problem ? <Problem words={problem} onRetry={() => void load()} /> : <Loading />;
  return (
    <Page refreshing={pulling} onRefresh={() => void pull()}>
      <BackLink onBack={back} />
      <Title>{list.title}</Title>
      {problem ? <Notice>{problem}</Notice> : null}
      {list.intro.map((line, index) => (
        <Words key={index} soft>
          {line}
        </Words>
      ))}
      {said ? <Notice>{said}</Notice> : null}
      {list.empty ? <Words soft>{list.empty}</Words> : null}
      {list.groups.map((group) => (
        <Card key={group.startsAt}>
          <Heading>{localTime(group.startsAt)}</Heading>
          {group.many ? <Words soft>{group.many}</Words> : null}
          {group.requests.map((request) => (
            <View key={request.id} style={[styles.one, { borderTopColor: colors.line }]}>
              <Pressable accessibilityRole="link" accessibilityLabel={`${request.name}, ${request.minutes} minutes, ${request.price}. Open this request.`} onPress={() => router.push({ pathname: "/bookings/[id]", params: { id: request.id } })} style={styles.open}>
                <Asker name={request.name} photoId={request.photoId} rating={request.rating} ratingWords={request.ratingWords} idConfirmed={request.idConfirmed} line={`${request.minutes} minutes, ${request.price}`} />
                <Text style={[styles.small, { color: colors.accent }]}>›</Text>
              </Pressable>
              {request.words ? <Text style={[styles.small, { color: colors.text }]}>“{request.words}”</Text> : null}
              {request.note ? (
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: noteOpen === request.id }} accessibilityLabel={`Your private note about ${request.name}`} onPress={() => setNoteOpen(noteOpen === request.id ? null : request.id)} style={styles.note}>
                  <Text style={[styles.small, { color: colors.accent }]}>{noteOpen === request.id ? "▾ Your note" : "▸ Your note"}</Text>
                  {noteOpen === request.id ? <Text style={[styles.small, { color: colors.soft }]}>{request.note}</Text> : null}
                </Pressable>
              ) : null}
              {request.respondBy ? <Text style={[styles.small, { color: colors.accentDeep }]}>Answer by {localTime(request.respondBy)}</Text> : null}
              {answered.includes(request.id) ? null : request.answer.kind === "booked" ? (
                <View style={styles.buttons}>
                  {request.answer.accept !== null ? (
                    <View style={styles.button}>
                      <Button label={request.answer.accept} busy={answering === `${request.id} accept`} disabled={answering !== null} onPress={() => askBeforeAccepting(request.answer, watch(), () => void answer(request, "accept"))} />
                    </View>
                  ) : null}
                  <View style={styles.button}>
                    <Button label={request.answer.decline} kind="plain" busy={answering === `${request.id} decline`} disabled={answering !== null} onPress={() => void answer(request, "decline")} />
                  </View>
                </View>
              ) : request.answer.elsewhere ? (
                <Text style={[styles.small, { color: colors.text }]}>{request.answer.elsewhere}</Text>
              ) : null}
            </View>
          ))}
        </Card>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  one: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  open: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  small: { fontSize: type.small, lineHeight: 20 },
  note: { minHeight: 44, justifyContent: "center", gap: 4 },
  buttons: { flexDirection: "row", gap: 12 },
  button: { flex: 1 },
});
