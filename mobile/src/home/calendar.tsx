import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type DimensionValue } from "react-native";
import type { AppAsk, AppCall } from "../../../src/lib/app-door/types";
import { CALENDAR, dayToMoveTo } from "../../../src/lib/home/calendar";
import { dayAfter, dayOf } from "../../../src/lib/home/rules";
import { calendarView, dayName, dollars, firstNameOf, monthsOf, placeOf } from "@/lib/home-rules";
import { type, useColors } from "@/ui/theme";
import { CallRow } from "./call-row";

/** The phone's own time zone; the world's clock if the phone will not say. */
function phoneZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The look of a call's block: hosted, booked, finished. The same in light and dark, as on the website: light blocks, dark words. */
const LOOK = {
  hosting: { fill: "#fed7aa", ink: "#7c2d12" },
  booked: { fill: "#99f6e4", ink: "#134e4a" },
  finished: { fill: "#e7e5e4", ink: "#44403c" },
} as const;
const lookOf = (call: AppCall) => (call.finished ? LOOK.finished : call.hosting ? LOOK.hosting : LOOK.booked);
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * "Your calendar" on the home page (plans/43, and plans/45-phone-apps/04-the-home-page.md,
 * decision 3): three days across, the hours down, and a block for every call at its time, laid out
 * by the website's own rules in the phone's own time zone. The calls this person hosts, the calls
 * they booked and the calls that are over each have their look, named in words underneath. Tapping
 * a call shows its row. A time people have asked her for is a dashed block with how many asked,
 * never who. A line says what the calls she hosted in these days earned together; a red line marks
 * "now" in today's column.
 *
 * It draws what it is given and decides nothing about who may see what.
 */
export function Calendar({ calls, asks, serverNow, day, cut, most, nextId, onDay }: { calls: AppCall[]; asks: AppAsk[]; serverNow: string; day: string | null; cut: boolean; most: number; nextId: string | null; onDay: (day: string | null) => void }) {
  const colors = useColors();
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const zone = phoneZone();
  const { days, today, hours, pieces, inView, firstDayOf, nowMinute, total } = calendarView({ calls, asks, day, serverNow, zone });
  const shown = day ?? today;
  const height = (hours.to - hours.from) * CALENDAR.hourPixels;
  const chosenCall = inView.find((call) => call.id === chosen) ?? null;
  const said = (call: AppCall) =>
    [`${dayName(dayOf(new Date(call.startsAt), zone), true)}, ${clock(call.startsAt)}`, `${call.minutes} minutes`, call.name, call.hosting ? "you host" : "you booked", ...(call.finished ? ["finished"] : []), ...(call.earned ? [`earned ${call.earned.text}${call.earned.soFar ? " so far" : ""}`] : [])].join(", ");
  const round = [styles.round, { borderColor: colors.edge }];
  const tab = (on: boolean) => [styles.tab, on ? { backgroundColor: colors.text, borderColor: colors.text } : { borderColor: colors.edge }];

  return (
    <View style={styles.all}>
      <View style={styles.top}>
        <Text accessibilityLiveRegion="polite" style={[styles.months, { color: colors.text }]}>
          {monthsOf(days)}
        </Text>
        <View style={styles.moves}>
          <Pressable accessibilityRole="button" accessibilityLabel="The three days before" style={round} onPress={() => onDay(dayToMoveTo(shown, 3, -1))}>
            <Text style={[styles.arrow, { color: colors.text }]}>‹</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Today" style={[styles.todayButton, { borderColor: colors.edge }]} onPress={() => onDay(null)}>
            <Text style={[styles.small, { color: colors.text }]}>Today</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="The three days after" style={round} onPress={() => onDay(dayToMoveTo(shown, 3, 1))}>
            <Text style={[styles.arrow, { color: colors.text }]}>›</Text>
          </Pressable>
        </View>
      </View>
      {total ? (
        <Text style={[styles.small, { color: colors.soft }]}>
          {total.calls} {total.calls === 1 ? "call" : "calls"} hosted in these days · earned <Text style={styles.bold}>{dollars(total.cents)}</Text>
          {total.soFar ? " so far" : ""}
          {/* When not every call around these days could be loaded, the sum is of the ones that were. */}
          {cut ? " from the calls shown" : ""}
        </Text>
      ) : null}
      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === "calendar" }} style={tab(view === "calendar")} onPress={() => setView("calendar")}>
          <Text style={[styles.small, view === "calendar" ? { color: colors.page, fontWeight: "700" } : { color: colors.text }]}>Calendar</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === "list" }} style={tab(view === "list")} onPress={() => setView("list")}>
          <Text style={[styles.small, view === "list" ? { color: colors.page, fontWeight: "700" } : { color: colors.text }]}>List</Text>
        </Pressable>
      </View>
      {cut ? <Text style={[styles.small, { color: colors.accentDeep }]}>There are more calls around these days than can be shown at once. The {most} nearest to them are here.</Text> : null}

      {view === "calendar" ? (
        <>
          <View style={styles.heads}>
            <View style={styles.gutter} />
            {days.map((one) => (
              <Text key={one} style={[styles.head, { borderBottomColor: colors.edge, color: one === today ? colors.accentDeep : colors.soft }, one === today ? styles.bold : null]}>
                {dayName(one)}
              </Text>
            ))}
          </View>
          <View style={[styles.grid, { height }]}>
            <View style={[styles.gutter, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {Array.from({ length: hours.to - hours.from }, (_, index) =>
                index === 0 ? null : (
                  <Text key={index} style={[styles.hour, { top: index * CALENDAR.hourPixels - 8, color: colors.soft }]}>
                    {new Date(Date.UTC(2020, 0, 1, hours.from + index)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" })}
                  </Text>
                ),
              )}
            </View>
            {days.map((one) => (
              <View key={one} style={[styles.column, { height, borderLeftColor: colors.line }]}>
                {Array.from({ length: hours.to - hours.from }, (_, index) => (
                  <View key={index} style={[styles.hourLine, { top: index * CALENDAR.hourPixels, backgroundColor: colors.line }]} />
                ))}
                {one === today && nowMinute !== null ? <View style={[styles.now, { top: Math.min(((nowMinute - hours.from * 60) / 60) * CALENDAR.hourPixels, height - 2) }]} /> : null}
                {pieces
                  .filter((piece) => piece.day === one)
                  .map((piece) => {
                    const place = { ...placeOf(piece, hours), left: `${(piece.lane / piece.lanes) * 100}%` as DimensionValue, width: `${100 / piece.lanes}%` as DimensionValue };
                    if (piece.ask) {
                      const words = piece.ask.count === 1 ? "1 request" : `${piece.ask.count} requests`;
                      return (
                        // A time people asked for: how many, never who. She answers them in the list above.
                        <View
                          key={piece.key}
                          accessible
                          accessibilityLabel={`${dayName(dayOf(new Date(piece.ask.startsAt), zone), true)}, ${clock(piece.ask.startsAt)}, ${words} waiting for your answer`}
                          style={[styles.block, styles.ask, place, { borderColor: colors.soft, backgroundColor: colors.surface }]}
                        >
                          <Text numberOfLines={1} style={[styles.blockWords, { color: colors.text }]}>
                            {words}
                          </Text>
                        </View>
                      );
                    }
                    const call = piece.call!;
                    const look = lookOf(call);
                    return (
                      <Pressable
                        key={piece.key}
                        accessibilityRole="button"
                        accessibilityLabel={said(call)}
                        accessibilityState={{ selected: chosen === call.id }}
                        onPress={() => setChosen(chosen === call.id ? null : call.id)}
                        hitSlop={6}
                        style={[styles.block, place, { backgroundColor: look.fill }, chosen === call.id ? { borderWidth: 2, borderColor: colors.text } : null]}
                      >
                        <Text numberOfLines={1} style={[styles.blockWords, { color: look.ink }]}>
                          {/* A finished call she hosted says what it earned, first, so it is what stays when the block is narrow. */}
                          {call.earned ? (
                            <>
                              <Text style={styles.bold}>{call.earned.text}</Text>
                              {call.earned.soFar ? " so far" : ""} {firstNameOf(call.name)}
                            </>
                          ) : (
                            `${piece.from > 0 || dayOf(new Date(call.startsAt), zone) === one ? clock(call.startsAt) : "…"} ${firstNameOf(call.name)}`
                          )}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            ))}
          </View>
          <View style={styles.keys}>
            <Key fill={LOOK.hosting.fill} words="You host" />
            <Key fill={LOOK.booked.fill} words="You booked" />
            <Key fill={LOOK.finished.fill} words="Finished" />
            {pieces.some((piece) => piece.ask) ? <Key fill={colors.surface} dashed words="Asked for, not answered" /> : null}
          </View>
          <View style={[styles.chosen, { borderTopColor: colors.line }]}>
            {chosenCall ? (
              // The details of the next call are in the card above, once: its row here goes without them.
              <CallRow call={chosenCall} plain={chosenCall.id === nextId} alone />
            ) : (
              <Text style={[styles.small, { color: colors.soft }]}>{inView.length > 0 ? "Tap a call to see it." : "No calls in these days."}</Text>
            )}
          </View>
        </>
      ) : (
        <View>
          {inView.length === 0 ? <Text style={[styles.small, { color: colors.soft }]}>No calls in these days.</Text> : null}
          {days.map((one) => {
            // A call that began the day before the first day in view is listed under that first day, with its own date.
            const starting = inView.filter((call) => firstDayOf.get(call.id) === one);
            if (starting.length === 0) return null;
            return (
              <View key={one} style={styles.listDay}>
                <Text accessibilityRole="header" style={[styles.small, styles.bold, { color: colors.accentDeep }]}>
                  {one === today ? "Today" : one === dayAfter(today) ? "Tomorrow" : dayName(one, true)}
                </Text>
                {starting.map((call) => (
                  <CallRow key={call.id} call={call} withTimeOnly={dayOf(new Date(call.startsAt), zone) === one} plain={call.id === nextId} />
                ))}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Key({ fill, words, dashed = false }: { fill: string; words: string; dashed?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.key}>
      <View style={[styles.keyBox, { backgroundColor: fill }, dashed ? { borderWidth: 1, borderStyle: "dashed", borderColor: colors.soft } : null]} />
      <Text style={[styles.tiny, { color: colors.soft }]}>{words}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  all: { gap: 10 },
  top: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  months: { fontSize: type.body, fontWeight: "700" },
  moves: { flexDirection: "row", alignItems: "center", gap: 8 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  arrow: { fontSize: 22, lineHeight: 26 },
  todayButton: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  small: { fontSize: type.small, lineHeight: 20 },
  tiny: { fontSize: 12, lineHeight: 16 },
  bold: { fontWeight: "700" },
  heads: { flexDirection: "row" },
  gutter: { width: 44 },
  head: { flex: 1, textAlign: "center", fontSize: 12, paddingBottom: 4, borderBottomWidth: 1 },
  grid: { flexDirection: "row" },
  hour: { position: "absolute", right: 6, fontSize: 11 },
  column: { flex: 1, borderLeftWidth: 1 },
  hourLine: { position: "absolute", left: 0, right: 0, height: 1 },
  now: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: "#dc2626", zIndex: 2 },
  block: { position: "absolute", borderRadius: 6, paddingHorizontal: 3, overflow: "hidden", justifyContent: "flex-start" },
  ask: { borderWidth: 1, borderStyle: "dashed" },
  blockWords: { fontSize: 11, lineHeight: 14 },
  keys: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  keyBox: { width: 12, height: 12, borderRadius: 3 },
  chosen: { borderTopWidth: 1, paddingTop: 8 },
  listDay: { marginTop: 12 },
});
