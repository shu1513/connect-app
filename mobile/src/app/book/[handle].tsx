import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AppBookSent, AppBookSummary } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { chosenTime, isBookSummary, isId, tickedFor } from "@/lib/book-rules";
import { useWatch } from "@/lib/here";
import { localTime } from "@/lib/home-rules";
import { useOpening } from "@/lib/opening";
import { BackLink, Button, Card, Field, Heading, Loading, Notice, Page, Problem, Tick, Words } from "@/ui/pieces";
import { Sentence } from "@/ui/sentence";
import { type, useColors } from "@/ui/theme";

type Ready = Extract<AppBookSummary, { kind: "ok" }>;
/** A request as it was sent: what the person saw, and exactly what went to the server. */
type Sent = { shown: Ready; note: string; ticked: boolean; body: Record<string, unknown> };

/**
 * What a customer reads before asking a host for a call at a time, and the button that sends the
 * request (plans/45-phone-apps/06-asking-for-a-call.md). Every word, price and deadline on it is
 * the server's, the same as on the website's page; the app adds nothing up.
 *
 * For a paid call the box about the card must be ticked here, before anything is sent: the tick
 * travels with the request, with the version of the words it was given for. Nothing is held or
 * charged by sending.
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
  const watch = useWatch();
  const [summary, setSummary] = useState<AppBookSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState("");
  // What the box about the card was ticked for (book-rules.ts): the tick holds only while exactly that is on the screen.
  const [agreedTo, setAgreedTo] = useState<string | null>(null);
  const terms = tickedFor(summary);
  const ticked = terms !== null && agreedTo === terms;
  const [said, setSaid] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /**
   * A request that was sent without an answer coming back: it may have arrived. Until the server has said what
   * became of it, the screen shows exactly what was sent and nothing on it can be changed; trying again sends the
   * very same request, so the two can only ever be one request, on the terms the person saw.
   */
  const [unsure, setUnsure] = useState<Sent | null>(null);
  /** A request that is on its way right now. From the moment the button is pressed, what is being sent is shown and cannot be changed. */
  const [onItsWay, setOnItsWay] = useState<Sent | null>(null);
  /** The request this screen made, once the server has said so: the form is then done with. */
  const [made, setMade] = useState<string | null>(null);
  const frozen = useRef(false);
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
    // While a sending is unsettled, or done, the summary is not read again: what was sent stays on the screen.
    if (frozen.current) return;
    const mine = ++newest.current;
    if (!handle || !time) {
      setGone(true);
      return;
    }
    const answer = await ask<AppBookSummary>(`${path}?length=${time.length}&start=${encodeURIComponent(time.start)}`);
    if (mine !== newest.current || frozen.current) return;
    if (answer.ok && isBookSummary(answer.data)) {
      if (answer.data.kind === "ok" && !key.current) key.current = answer.data.requestKey;
      const now = tickedFor(answer.data);
      // A tick is for what was on the screen when it was given. If that is no longer what is shown, the tick is gone
      // for good: it does not come back when the same terms come back.
      setAgreedTo((was) => (was !== null && was === now ? was : null));
      setSummary(answer.data);
      setProblem(null);
      setGone(false);
    } else if (!answer.ok && answer.code === "not_found") {
      setSummary(null);
      setAgreedTo(null);
      setGone(true);
    } else if (!answer.ok && answer.code !== "unreachable") {
      // Not for this person as things stand (paused, signed out, this copy too old): the sentence, and the opening question says where they belong.
      setSummary(null);
      setAgreedTo(null);
      setGone(false);
      setProblem(answer.message);
      if (answer.code !== "paused") void askOpening();
    } else {
      // Not reached: said beside what is on the screen.
      setGone(false);
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [handle, time, path, askOpening]);

  // When the screen comes to the front: a request this screen has made is opened (its answer may have come while
  // another screen was in front); otherwise the summary is read, also on coming back from the ID check.
  useFocusEffect(
    useCallback(() => {
      if (made) router.replace(`/bookings/${made}`);
      else void load();
    }, [load, made]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace(handle ? `/h/${handle}` : "/"));

  /** Sends a request, or (`again`) sends an unsettled one once more exactly as it was. */
  async function send(what: Sent, again: boolean) {
    if (busy.current) return;
    busy.current = true;
    const still = watch();
    // From here until the server has answered, the summary is not read again and nothing on the screen can be changed.
    frozen.current = true;
    setOnItsWay(what);
    setSending(true);
    setSaid(null);
    const answer = await ask<AppBookSent>(path, { body: what.body });
    if (answer.ok && isId(answer.data.id)) {
      // Done. The request's own screen takes this one's place: "back" from there leads to the host's page, not to a
      // form already sent. If the person has left this screen meanwhile, nothing is moved now; the request is
      // opened when they come back to it, and until then the form is not shown again.
      frozen.current = true;
      setUnsure(null);
      setMade(answer.data.id);
      if (still()) router.replace(`/bookings/${answer.data.id}`);
    } else if (!answer.ok && again && answer.code !== "not_valid" && answer.code !== "not_found") {
      // An unsettled request was sent again and turned away at the door (paused, signed out, this copy too old),
      // before the server looked whether the first sending had arrived. What became of it is still not known: what
      // was sent stays on the screen as it is, to be tried again.
      setSaid(answer.message);
      if (answer.code !== "paused") void askOpening();
    } else if (!answer.ok && answer.code !== "unreachable") {
      // The server's own sentence, and with it the certainty that no request was made (one that had been made is
      // answered as made, whatever else has changed). The form is live again.
      frozen.current = false;
      setUnsure(null);
      setSaid(answer.message);
      if (answer.code === "not_found") {
        // The page is gone: nothing of it stays on the screen to be sent again.
        newest.current++;
        setSummary(null);
        setAgreedTo(null);
        setGone(true);
      } else if (answer.code === "not_valid") {
        // What the form shows is read again: the price or the time may have changed.
        await load();
      } else {
        // Not for this person as things stand (paused, signed out, this copy too old). Nothing of the form stays
        // to be sent again: the sentence is shown, and the opening question says where the person belongs.
        newest.current++;
        setSummary(null);
        setAgreedTo(null);
        // Said in the place of the page, and nowhere else: when the page can be read again, the sentence goes with it.
        setSaid(null);
        setProblem(answer.message);
        if (answer.code !== "paused") void askOpening();
      }
    } else {
      // It may or may not have arrived.
      frozen.current = true;
      setUnsure(what);
      setSaid(answer.ok ? UNREACHABLE : answer.message);
    }
    busy.current = false;
    setOnItsWay(null);
    setSending(false);
  }

  /** The request as the form stands now. What the summary showed goes back as it is; the tick only as the box stands for exactly these terms. */
  function fromForm(ready: Ready): Sent | null {
    if (!key.current) return null;
    const body = { start: ready.startsAt, length: ready.minutes, note, requestKey: key.current, ...(ready.cardTerms ? { cardTerms: ticked, cardTermsVersion: ready.cardTermsVersion } : {}), seen: ready.seen };
    return { shown: ready, note, ticked, body };
  }

  if (made) {
    return (
      <Page title="Your request">
        <Words>Your request was made.</Words>
        <Button label="Open your request" onPress={() => router.replace(`/bookings/${made}`)} />
      </Page>
    );
  }

  const sentView = unsure ?? onItsWay;
  if (sentView) {
    // What is being sent, or was sent without an answer coming back: all of it, exactly as the person saw it when
    // they pressed the button. Nothing here can be changed until the server has said what became of it.
    const was = sentView.shown;
    return (
      <Page>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {was.title}
        </Text>
        {unsure ? (
          <Notice>
            {said ?? UNREACHABLE}
            {"\n\n"}
            Your request may or may not have arrived. Try again to find out: it is sent once at most, exactly as shown here.
          </Notice>
        ) : null}
        <Card>
          <View>
            <Text style={[styles.label, { color: colors.soft }]}>When</Text>
            <Words>
              <Text style={styles.bold}>{localTime(was.startsAt)}</Text> ({was.minutes} minutes)
            </Words>
            <Words soft>{was.hostTime}</Words>
          </View>
          <View>
            <Text style={[styles.label, { color: colors.soft }]}>Price</Text>
            <Words>
              <Text style={styles.bold}>{was.price}</Text>
            </Words>
          </View>
          <Words soft>{was.what}</Words>
        </Card>
        <Card>
          <Heading>{was.pointsTitle}</Heading>
          {was.points.map((point, index) => (
            <Sentence key={index} parts={point} lead="• " />
          ))}
        </Card>
        <Card>
          <View>
            <Text style={[styles.label, { color: colors.soft }]}>Your note</Text>
            <Words>{sentView.note.trim() ? sentView.note : "None."}</Words>
          </View>
          {was.cardTerms ? (
            <View>
              <Text style={[styles.label, { color: colors.soft }]}>{sentView.ticked ? "You ticked" : "You did not tick"}</Text>
              <Words soft>{was.cardTerms}</Words>
            </View>
          ) : null}
        </Card>
        {unsure ? <Button label="Try again" busy={sending} onPress={() => void send(unsure, true)} /> : <Button label={was.button} busy onPress={() => {}} />}
      </Page>
    );
  }

  if (gone) {
    return (
      <Page title="Not found">
        {said ? <Notice>{said}</Notice> : null}
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
        {said ? <Notice>{said}</Notice> : null}
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
      {summary.cardTerms ? (
        <Tick
          label={summary.cardTerms}
          checked={ticked}
          onChange={(now) => {
            setAgreedTo(now ? terms : null);
            setSaid(null);
          }}
        />
      ) : null}
      {summary.idLine ? <Words soft>{summary.idLine}</Words> : null}
      {said ? <Notice>{said}</Notice> : null}
      <Button
        label={summary.button}
        busy={sending}
        onPress={() => {
          const what = fromForm(summary);
          if (what) void send(what, false);
        }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: type.title, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6 },
  label: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
});
