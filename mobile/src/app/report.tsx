import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppReportForm, AppReportSent } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { useOpening } from "@/lib/opening";
import { isReportForm, isReportSent, reportPlace } from "@/lib/room-rules";
import { openWebsite } from "@/lib/website";
import { BackLink, Button, Card, Field, Loading, Notice, Page, Problem, Words } from "@/ui/pieces";
import { type, useColors } from "@/ui/theme";

/**
 * The report form (plans/45-phone-apps/09-the-call.md, decision 9): the website's form, with its
 * reasons and its rules, as a screen of the app. It is opened from a call ("End call and report"
 * leads here), a request or a host's page; who the report is about is worked out on the server
 * from that place. Reporting a person also blocks them, as the form says.
 */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ call?: string; booking?: string; profile?: string }>();
  const from = reportPlace(params);
  // A form of its own for each place: what was chosen and typed about one person is never sent about another.
  return <ReportForm key={from ? `${from.place}:${from.id}` : "nowhere"} from={from} />;
}

function ReportForm({ from }: { from: ReturnType<typeof reportPlace> }) {
  const colors = useColors();
  const { refresh: askOpening } = useOpening();
  const [form, setForm] = useState<AppReportForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const newest = useRef(0);
  const busy = useRef(false);
  const place = from?.place ?? null;
  const placeId = from?.id ?? null;

  const load = useCallback(async () => {
    if (!place || !placeId) {
      setGone(true);
      return;
    }
    const mine = ++newest.current;
    const answer = await ask<AppReportForm>(`/api/app/report?${place}=${encodeURIComponent(placeId)}`);
    if (mine !== newest.current) return;
    if (answer.ok && isReportForm(answer.data)) {
      setForm(answer.data);
      setProblem(null);
    } else if (!answer.ok && answer.code === "not_found") {
      setGone(true);
    } else if (!answer.ok && answer.code !== "unreachable") {
      setForm(null);
      setProblem(answer.message);
      void askOpening();
    } else {
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [place, placeId, askOpening]);

  useFocusEffect(
    useCallback(() => {
      // The form is read once; what was typed is not lost by coming back to the screen.
      if (!form && !done) void load();
      return () => {
        newest.current++;
      };
    }, [load, form, done]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  async function send() {
    if (busy.current || !place || !placeId) return;
    busy.current = true;
    setSending(true);
    setSaid(null);
    const answer = await ask<AppReportSent>("/api/app/report", { body: { place, id: placeId, reason: reason ?? "", text } });
    if (answer.ok && isReportSent(answer.data)) setDone(answer.data.notice);
    // Not taken, in the form's own sentence; or not reached. What was typed stays.
    else setSaid(answer.ok ? UNREACHABLE : answer.message);
    busy.current = false;
    setSending(false);
  }

  if (gone) {
    return (
      <Page title="Not found">
        <Words soft>There is nothing to report from here.</Words>
        <Button label="Back" kind="plain" onPress={back} />
      </Page>
    );
  }
  if (done) {
    return (
      <Page>
        <Notice>{done}</Notice>
        <Button label="Done" onPress={() => router.replace("/")} />
      </Page>
    );
  }
  if (!form) return problem ? <Problem words={problem} onRetry={() => void load()} /> : <Loading />;

  return (
    <Page title={form.title}>
      <BackLink onBack={back} />
      {form.stopped ? <Notice>{form.stopped}</Notice> : null}
      <Words soft>
        {form.words} {form.rules.before}
        <Text accessibilityRole="link" onPress={() => void openWebsite("/rules")} style={{ color: colors.accent, textDecorationLine: "underline" }}>
          {form.rules.link}
        </Text>
        {form.rules.after}
      </Words>
      {problem ? <Notice>{problem}</Notice> : null}

      <Card>
        <Text style={[styles.label, { color: colors.text }]}>{form.what}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={form.choose}>
          {form.reasons.map((one) => {
            const chosen = reason === one.key;
            return (
              <Pressable key={one.key} accessibilityRole="radio" accessibilityState={{ selected: chosen }} accessibilityLabel={one.label} onPress={() => {
                  setReason(one.key);
                  // "Choose a reason." has been answered.
                  setSaid(null);
                }} style={styles.row}>
                <View style={[styles.dot, { borderColor: chosen ? colors.accent : colors.edge }]}>{chosen ? <View style={[styles.dotIn, { backgroundColor: colors.accent }]} /> : null}</View>
                <Text style={[styles.words, { color: colors.text }]}>{one.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Field label={form.more} value={text} onChangeText={setText} maxLength={form.textMax} multiline numberOfLines={5} textAlignVertical="top" />
      {said ? <Notice>{said}</Notice> : null}
      <Button label={form.send} busy={sending} onPress={() => void send()} />
      <Words soft>{form.danger}</Words>
    </Page>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: type.body, fontWeight: "700", lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dotIn: { width: 10, height: 10, borderRadius: 5 },
  words: { flex: 1, fontSize: type.body, lineHeight: 22 },
});
