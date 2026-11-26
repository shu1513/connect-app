import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import type { AppBlocked, AppEndedScreen } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { isId } from "@/lib/book-rules";
import { useWatch } from "@/lib/here";
import { isBlocked, isEndedScreen } from "@/lib/room-rules";
import { Button, Card, Loading, Notice, Page, Problem, Words } from "@/ui/pieces";

/**
 * The screen after "End call now" (plans/50-end-call-now.md, decision 19): who ended the call,
 * what that means for the money, and three choices, each with what it does: "Report" (the
 * report form), "Block" (asked once more, then done) and "Neither". The call is over whatever
 * is chosen here, or if this screen is simply left. Every sentence comes from the server, and
 * so does who "Block" blocks: the app names only the call.
 */
export default function EndedScreen() {
  const { call } = useLocalSearchParams<{ call?: string | string[] }>();
  const id = isId(call) ? call : null;
  // A screen of its own for each call.
  return <Ended key={id ?? "nowhere"} id={id} />;
}

function Ended({ id }: { id: string | null }) {
  const watch = useWatch();
  const [screen, setScreen] = useState<AppEndedScreen | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(id === null);
  const [blocking, setBlocking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  /** What the server said after "Block" went through. */
  const [blocked, setBlocked] = useState<string | null>(null);
  const newest = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    const mine = ++newest.current;
    const answer = await ask<AppEndedScreen>(`/api/app/calls/${id}/ended`);
    if (mine !== newest.current) return;
    if (answer.ok && isEndedScreen(answer.data)) {
      setScreen(answer.data);
      setProblem(null);
    } else if (!answer.ok && answer.code === "not_found") {
      setGone(true);
    } else {
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      // Read again each time the screen is in front: coming back from the report form, a report may have been sent.
      void load();
      return () => {
        newest.current++;
      };
    }, [load]),
  );

  const toCall = () => (id ? router.replace({ pathname: "/calls/[id]", params: { id } }) : router.replace("/"));

  async function block() {
    if (busy.current || !id) return;
    busy.current = true;
    setBlocking(true);
    setSaid(null);
    const answer = await ask<AppBlocked>(`/api/app/calls/${id}/block`, { body: {} });
    if (answer.ok && isBlocked(answer.data)) setBlocked(answer.data.notice);
    // Not reached, or the server could not say whether the block stands: said, and the button stays to try again (blocking twice is safe).
    else setSaid(answer.ok ? UNREACHABLE : answer.message);
    busy.current = false;
    setBlocking(false);
  }

  function askBlock() {
    if (!screen) return;
    // Asked once. A "yes" only counts while this screen is still the one in front.
    const still = watch();
    Alert.alert(screen.block.label, screen.block.sure, [
      { text: screen.block.no, style: "cancel" },
      {
        text: screen.block.yes,
        style: "destructive",
        onPress: () => {
          if (still()) void block();
        },
      },
    ]);
  }

  if (gone) {
    return (
      <Page title="Not found">
        <Words soft>There is no ended call here, or it is not yours.</Words>
        <Button label="Back" kind="plain" onPress={() => router.replace("/")} />
      </Page>
    );
  }
  if (!screen) return problem ? <Problem words={problem} onRetry={() => void load()} /> : <Loading />;

  return (
    <Page title={screen.title}>
      {screen.lines.map((line) => (
        <Words key={line}>{line}</Words>
      ))}
      {problem ? <Notice>{problem}</Notice> : null}
      <Words soft>{screen.what}</Words>

      <Card>
        <Button label={screen.report.label} onPress={() => (id ? router.push({ pathname: "/report", params: { call: id } }) : undefined)} />
        <Words soft>{screen.report.what}</Words>
        {screen.report.money ? <Words soft>{screen.report.money}</Words> : null}
      </Card>

      <Card>
        {blocked || screen.block.done ? <Notice>{blocked ?? screen.block.doneWords}</Notice> : <Button label={screen.block.label} kind="danger" busy={blocking} onPress={askBlock} />}
        {said ? <Notice>{said}</Notice> : null}
        <Words soft>{screen.block.what}</Words>
      </Card>

      <Card>
        <Button label={screen.neither.label} kind="plain" onPress={toCall} />
        <Words soft>{screen.neither.what}</Words>
      </Card>
    </Page>
  );
}
