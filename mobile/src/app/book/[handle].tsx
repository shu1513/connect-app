import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AppBookSent, AppBookSummary } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { chosenTime, isBookSummary, isId, tickedFor } from "@/lib/book-rules";
import { useHere } from "@/lib/here";
import { localTime } from "@/lib/home-rules";
import { useOpening } from "@/lib/opening";
import { BackLink, Button, Card, Field, Heading, Loading, Notice, Page, Problem, Tick, Words } from "@/ui/pieces";
import { Sentence } from "@/ui/sentence";
import { type, useColors } from "@/ui/theme";

/**
 * What a customer reads before asking a host for a call at a time, and the button that sends the
 * request (plans/45-phone-apps/06-asking-for-a-call.md). Every word, price and deadline on it is
 * the server's, the same as on the website's page; the app adds nothing up.
 *
 * For a paid call the box about the card must be ticked here, before anything is sent: the tick
 * travels with the request. Nothing is held or charged by sending.
 */
export default function BookScreen() {
  const params = useLocalSearchParams<{ handle?: string | string[]; start?: string | string[]; length?: string | string[] }>();
  // Only a handle of plain letters is asked for; anything else leads to no page.
  const handle = typeof params.handle === "string" && /^[A-Za-z0-9_-]+$/.test(params.handle) ? params.handle : "";
  const time = chosenTime(params.start, params.length);
  // A screen of its own for each host and each time: nothing typed or ticked for one is left standing for another.
  return <OneSummary key={`${handle} ${time?.start} ${time?.length}`} handle={handle} time={time} />;
}

function OneSummary({ handle, time }: { handle: string; time: { start: string; length: number } | null }) {
  const colors = useColors();
  const { refresh: askOpening } = useOpening();
  const [summary, setSummary] = useState<AppBookSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState("");
  // What the box about the card was ticked for (book-rules.ts): the tick holds only while exactly that is on the screen.
  const [agreedTo, setAgreedTo] = useState<string | null>(null);
  const terms = tickedFor(summary);
  const ticked = terms !== null && agreedTo === terms;
  const here = useHere();
  /**
   * A request that was sent without an answer coming back: what exactly was sent. It may have arrived. Pressing
   * again sends this very request again, not the form as it stands now, so the two can only ever be one request,
   * on the terms the person saw when they first pressed.
   */
  const unsure = useRef<Record<string, unknown> | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const newest = useRef(0);
  const busy = useRef(false);
  /**
   * The key that makes a request sent twice count once: the first one the server gave this screen,
   * kept for as long as the screen stands. A second tap, and trying again after the connection
   * failed, are then the same one request.
   */
  const key = useRef<string | null>(null);
  const path = `/api/app/hosts/${handle}/book`;

  const load = useCallback(async () => {
    const mine = ++newest.current;
    if (!handle || !time) {
      setGone(true);
      return;
    }
    const answer = await ask<AppBookSummary>(`${path}?length=${time.length}&start=${encodeURIComponent(time.start)}`);
    if (mine !== newest.current) return;
    if (answer.ok && isBookSummary(answer.data)) {
      if (answer.data.kind === "ok" && !key.current) key.current = answer.data.requestKey;
      setSummary(answer.data);
      setProblem(null);
      setGone(false);
    } else if (!answer.ok && answer.code === "not_found") {
      setSummary(null);
      setGone(true);
    } else if (!answer.ok && answer.code !== "unreachable") {
      // Not for this person as things stand (paused, signed out, this copy too old): the sentence, and the opening question says where they belong.
      setSummary(null);
      setGone(false);
      setProblem(answer.message);
      if (answer.code !== "paused") void askOpening();
    } else {
      // Not reached: said beside what is on the screen.
      setGone(false);
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [handle, time, path, askOpening]);

  // Read when the screen comes to the front: also on coming back from the ID check, which may have changed what it shows.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace(handle ? `/h/${handle}` : "/"));

  async function send(ready: Extract<AppBookSummary, { kind: "ok" }>) {
    if (busy.current || !key.current) return;
    busy.current = true;
    setSending(true);
    setSaid(null);
    // What the summary showed goes back as it is: the time, the length, the price and the cancelling rule. The
    // tick is sent only as the box stands for exactly these terms; without it the server sends nothing on.
    const body = unsure.current ?? { start: ready.startsAt, length: ready.minutes, note, requestKey: key.current, ...(ready.cardTerms ? { cardTerms: ticked } : {}), seen: ready.seen };
    const answer = await ask<AppBookSent>(path, { body });
    // Any answer of the server's settles what became of it.
    if (answer.ok || answer.code !== "unreachable") unsure.current = null;
    if (answer.ok && isId(answer.data.id)) {
      // The request's own screen takes this one's place: "back" from there leads to the host's page, not to a form
      // already sent. Only if this screen is still the one in front: an answer that comes after the person has left
      // (or somebody else has signed in) moves nothing. The request is then on the home page.
      if (here()) router.replace(`/bookings/${answer.data.id}`);
    } else if (!answer.ok && (answer.code === "not_valid" || answer.code === "paused")) {
      // The server's own sentence. What the summary shows may have changed (the price, the time): it is read again.
      setSaid(answer.message);
      await load();
    } else if (!answer.ok && answer.code !== "unreachable") {
      setSaid(answer.message);
      void askOpening();
    } else {
      // It may or may not have arrived. Pressing again sends the very same request, so it is one request either way.
      unsure.current = body;
      setSaid(answer.ok ? UNREACHABLE : answer.message);
    }
    busy.current = false;
    setSending(false);
  }

  if (gone) {
    return (
      <Page title="Not found">
        <Words soft>There is no page here, or it is not open at the moment.</Words>
        <Button label="Back" kind="plain" onPress={back} />
      </Page>
    );
  }
  if (!summary) return problem ? <Problem words={problem} onRetry={() => void load()} /> : <Loading />;

  if (summary.kind !== "ok") {
    return (
      <Page>
        <BackLink onBack={back} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {summary.title}
        </Text>
        {problem ? <Notice>{problem}</Notice> : null}
        {summary.kind === "gone" ? <Button label={summary.button} onPress={back} /> : null}
        {summary.kind === "own" ? <Words>{summary.words}</Words> : null}
        {summary.kind === "confirm_id" ? (
          <>
            <Words>{summary.words}</Words>
            <Words soft>{summary.small}</Words>
            <Button label={summary.button} onPress={() => router.push("/identity")} />
          </>
        ) : null}
      </Page>
    );
  }

  return (
    <Page>
      <BackLink onBack={back} />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {summary.title}
      </Text>
      {problem ? <Notice>{problem}</Notice> : null}

      <Card>
        <View>
          <Text style={[styles.label, { color: colors.soft }]}>When</Text>
          <Words>
            <Text style={styles.bold}>{localTime(summary.startsAt)}</Text> ({summary.minutes} minutes)
          </Words>
          <Words soft>{summary.hostTime}</Words>
        </View>
        <View>
          <Text style={[styles.label, { color: colors.soft }]}>Price</Text>
          <Words>
            <Text style={styles.bold}>{summary.price}</Text>
          </Words>
        </View>
        <Words soft>{summary.what}</Words>
      </Card>

      <Card>
        <Heading>{summary.pointsTitle}</Heading>
        {summary.points.map((point, index) => (
          <Sentence key={index} parts={point} lead="• " />
        ))}
      </Card>

      <Field label={summary.note.label} value={note} onChangeText={setNote} maxLength={summary.note.max} multiline numberOfLines={3} textAlignVertical="top" />
      {summary.cardTerms ? <Tick label={summary.cardTerms} checked={ticked} onChange={(now) => { setAgreedTo(now ? terms : null); setSaid(null); }} /> : null}
      {summary.idLine ? <Words soft>{summary.idLine}</Words> : null}
      {said ? <Notice>{said}</Notice> : null}
      <Button label={summary.button} busy={sending} onPress={() => void send(summary)} />
    </Page>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: type.title, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6 },
  label: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
});
