import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import type { AppCalls } from "../../../../src/lib/app-door/types";
import { CallRow } from "@/home/call-row";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { isCalls } from "@/lib/call-rules";
import { useOpening } from "@/lib/opening";
import { Button, Card, Heading, Loading, Notice, Page, Problem, Words } from "@/ui/pieces";
import { type, useColors } from "@/ui/theme";

/** How often the coming calls are read again while the place is in front (a room opens, a call is cancelled). */
const REFRESH_SECONDS = 30;

/**
 * Calls (plans/45-phone-apps/08-the-calls-page.md, decision 6): a person's coming calls, the
 * soonest first, and below them the past ones, the newest first. Every coming call is here, also
 * one far ahead, which the home page does not load. Each leads to its own page.
 *
 * It shows what the server says, a page at a time, and decides nothing itself.
 */
export default function CallsPlace() {
  const { refresh: askOpening } = useOpening();
  const [coming, setComing] = useState<AppCalls | null>(null);
  const [past, setPast] = useState<AppCalls | null>(null);
  const [pages, setPages] = useState({ coming: 1, past: 1 });
  const [problem, setProblem] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const newest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++newest.current;
    const [first, second] = await Promise.all([ask<AppCalls>(`/api/app/calls?kind=coming&page=${pages.coming}`), ask<AppCalls>(`/api/app/calls?kind=past&page=${pages.past}`)]);
    if (mine !== newest.current) return;
    const refused = [first, second].find((answer) => !answer.ok && answer.code !== "unreachable");
    if (refused && !refused.ok) {
      // Not for this person as things stand: the sentence, and the opening question says where they belong.
      setComing(null);
      setPast(null);
      setProblem(refused.message);
      void askOpening();
      return;
    }
    const gotComing = first.ok && isCalls(first.data) && first.data.kind === "coming" ? first.data : null;
    const gotPast = second.ok && isCalls(second.data) && second.data.kind === "past" ? second.data : null;
    if (gotComing) setComing(gotComing);
    if (gotPast) setPast(gotPast);
    // What could not be read is said beside what is on the screen.
    setProblem(gotComing && gotPast ? null : !first.ok ? first.message : !second.ok ? second.message : UNREACHABLE);
  }, [pages, askOpening]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") void load();
      });
      const timer = setInterval(() => (AppState.currentState === "active" ? void load() : undefined), REFRESH_SECONDS * 1000);
      return () => {
        listener.remove();
        clearInterval(timer);
      };
    }, [load]),
  );

  async function pull() {
    setPulling(true);
    await load();
    setPulling(false);
  }

  if (!coming || !past) return problem ? <Problem words={problem} onRetry={() => void load()} /> : <Loading />;
  return (
    <Page title="Calls" refreshing={pulling} onRefresh={() => void pull()}>
      {problem ? <Notice>{problem}</Notice> : null}
      <Calls list={coming} earlier="Earlier calls" further="Later calls" onPage={(page) => setPages({ ...pages, coming: page })} />
      <Calls list={past} earlier="Newer calls" further="Older calls" onPage={(page) => setPages({ ...pages, past: page })} />
    </Page>
  );
}

/** One of the two lists, with its way to the page before and the page after. */
function Calls({ list, earlier, further, onPage }: { list: AppCalls; earlier: string; further: string; onPage: (page: number) => void }) {
  const colors = useColors();
  return (
    <Card>
      <Heading>{list.title}</Heading>
      {list.empty ? <Words soft>{list.empty}</Words> : null}
      {list.calls.map((call, index) => (
        <Pressable key={call.id} accessibilityRole="link" accessibilityLabel={`Call with ${call.name}. Open this call.`} onPress={() => router.push({ pathname: "/calls/[id]", params: { id: call.id } })} style={styles.row}>
          <View style={styles.rowMain}>
            <CallRow call={call} plain alone={index === 0} />
            {call.status ? <Text style={[styles.small, { color: colors.soft }]}>{call.status}</Text> : null}
          </View>
          <Text style={[styles.small, { color: colors.accent }]}>›</Text>
        </Pressable>
      ))}
      {list.page > 1 ? <Button label={earlier} kind="plain" onPress={() => onPage(list.page - 1)} /> : null}
      {list.more ? <Button label={further} kind="plain" onPress={() => onPage(list.page + 1)} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowMain: { flex: 1 },
  small: { fontSize: type.small, lineHeight: 20 },
});
