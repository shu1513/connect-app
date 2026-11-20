import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AppCall, AppHome } from "../../../src/lib/app-door/types";
import { agoWords, clockWords, countdownWords, localTime } from "@/lib/home-rules";
import { Photo } from "@/ui/photo";
import { type, useColors } from "@/ui/theme";
import { AboutLines } from "./call-row";

/**
 * "Your next call" (plans/36, and plans/45-phone-apps/04-the-home-page.md): who, when, for how
 * long, and how long until its room can be entered.
 *
 * The countdown follows the server's clock: the server sends its own time with the page, and from
 * there this only counts the time that passes. It never decides by itself that a room is open. At
 * zero it says "Checking…" and asks the server again (`onDue`); "The room is open" is shown only
 * from the server's own answer. The home page never opens a room: the way in is the call's own
 * page (parts 08 and 09), which decides who may enter.
 */
export function NextCall({ call, next, serverNow, onDue }: { call: AppCall; next: NonNullable<AppHome["next"]>; serverNow: string; onDue: () => void }) {
  const colors = useColors();
  const drawnAt = Date.parse(serverNow);
  // How much time has passed since the answer came, by a steady counter that does not jump when the phone's clock is changed.
  const [passed, setPassed] = useState(0);
  useEffect(() => {
    const startedAt = performance.now();
    const timer = setInterval(() => setPassed(performance.now() - startedAt), 1000);
    return () => {
      clearInterval(timer);
      setPassed(0);
    };
  }, [drawnAt]);
  const now = drawnAt + passed;

  const opensAt = Date.parse(next.opensAt);
  const startsAt = Date.parse(call.startsAt);
  const endsAt = Date.parse(call.endsAt);
  // The room should be open by now and the server has not said so yet, or the call's booked end has
  // passed: the server is asked once for each, for this answer.
  const due = now >= endsAt ? "ended" : !call.open && now >= opensAt ? "opened" : null;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!due) return;
    const key = `${call.id}:${due}:${serverNow}`;
    if (asked.current === key) return;
    asked.current = key;
    onDue();
  }, [due, call.id, serverNow, onDue]);

  const words = countdownWords((opensAt - now) / 1000);
  const untilStart = (startsAt - now) / 1000;
  const earlyMinutes = Math.round((startsAt - opensAt) / 60_000);
  return (
    <View style={[styles.card, { backgroundColor: call.open ? colors.notice : colors.surface, borderColor: call.open ? colors.noticeLine : colors.line }]}>
      <Text style={[styles.label, { color: colors.accentDeep }]}>Your next call</Text>
      <View style={styles.who}>
        <Photo photoId={call.photoId} name={call.name} />
        <View style={styles.whoWords}>
          <Text style={[styles.name, { color: colors.text }]}>{call.name}</Text>
          <Text style={[styles.small, { color: colors.soft }]}>
            {localTime(call.startsAt)} · {call.minutes} minutes
          </Text>
          <Text style={[styles.small, { color: colors.soft }]}>
            {call.payment}
            {call.hosting ? " · You host this call" : ""}
          </Text>
        </View>
      </View>
      {call.about ? <AboutLines name={call.name} about={call.about} /> : null}
      {due === "ended" ? (
        <Text style={[styles.small, { color: colors.soft }]}>Checking…</Text>
      ) : call.open ? (
        <View>
          <Text style={[styles.open, { color: colors.text }]}>The room is open</Text>
          <Text style={[styles.small, { color: colors.soft }]}>{untilStart > 0 ? `The call starts in ${clockWords(untilStart)}.` : `The booked start was ${agoWords(-untilStart)}.`}</Text>
          {next.notPaid ? <Text style={[styles.small, { color: colors.soft }]}>This call is waiting for its payment.</Text> : null}
        </View>
      ) : (
        <View>
          {words ? (
            <>
              <Text style={[styles.small, { color: colors.soft }]}>You can enter</Text>
              <Text accessibilityRole="timer" style={[words.everySecond ? styles.big : styles.mid, { color: colors.text }]}>
                {words.everySecond ? `in ${words.text}` : words.text}
              </Text>
            </>
          ) : (
            <Text style={[styles.small, { color: colors.soft }]}>Checking…</Text>
          )}
          <Text style={[styles.small, { color: colors.soft }]}>The room opens {earlyMinutes} minutes before the start.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 12 },
  label: { fontSize: type.small, fontWeight: "700" },
  who: { flexDirection: "row", gap: 12, alignItems: "center" },
  whoWords: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: "800", lineHeight: 26 },
  small: { fontSize: type.small, lineHeight: 20 },
  open: { fontSize: 18, fontWeight: "700", lineHeight: 26 },
  big: { fontSize: 40, fontWeight: "800", lineHeight: 48, fontVariant: ["tabular-nums"] },
  mid: { fontSize: 24, fontWeight: "800", lineHeight: 32 },
});
