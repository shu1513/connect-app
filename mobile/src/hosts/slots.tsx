import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dayName, phoneZone, timeOnly } from "@/lib/home-rules";
import { byDay } from "@/lib/host-rules";
import { Button } from "@/ui/pieces";
import { type, useColors } from "@/ui/theme";

/**
 * The open times, day by day in the phone's own time zone
 * (plans/45-phone-apps/05-search-and-a-hosts-page.md, decision 3). The server sends exact moments;
 * the phone says which day each falls on and writes the times. A host with long hours has a lot of
 * open times: a few days are shown, and more on request.
 *
 * `marked` times carry a star, with the words that say what the star means (a time for members
 * only). With `onChoose`, a time can be touched and leads on to asking for it
 * (plans/45-phone-apps/06-asking-for-a-call.md); without it the times are shown to read.
 */
export function Slots({ starts, marked, markedLabel, onChoose }: { starts: string[]; marked?: string[]; markedLabel?: string; onChoose?: (iso: string) => void }) {
  const colors = useColors();
  const [daysShown, setDaysShown] = useState(4);
  const zone = phoneZone();
  const days = byDay(starts, zone);
  const isMarked = new Set(marked ?? []);
  return (
    <View style={styles.all}>
      <Text style={[styles.small, { color: colors.soft }]}>
        Times are shown in your time zone ({zone.replace(/_/g, " ")}).{isMarked.size > 0 && markedLabel ? ` ★ ${markedLabel}` : ""}
      </Text>
      {days.slice(0, daysShown).map(({ day, starts: times }) => {
        // On the night the clocks go back, two different moments have the same time of day: then each says which it is.
        const plain = times.map((iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
        const twice = new Set(plain).size < plain.length;
        const label = (iso: string, index: number) => (twice ? timeOnly(iso) : plain[index]);
        return (
        <View key={day} style={styles.day}>
          <Text accessibilityRole="header" style={[styles.small, styles.bold, { color: colors.text }]}>
            {dayName(day, true)}
          </Text>
          <View style={styles.times}>
            {times.map((iso, index) => {
              const said = `${label(iso, index)}${isMarked.has(iso) && markedLabel ? `, ${markedLabel}` : ""}`;
              const words = (
                <Text style={[styles.small, { color: colors.text }]}>
                  {label(iso, index)}
                  {isMarked.has(iso) ? " ★" : ""}
                </Text>
              );
              return onChoose ? (
                <Pressable key={iso} accessibilityRole="button" accessibilityLabel={`${dayName(day, true)}, ${said}`} onPress={() => onChoose(iso)} style={({ pressed }) => [styles.time, styles.touch, { borderColor: colors.edge, backgroundColor: pressed ? colors.notice : colors.surface }]}>
                  {words}
                </Pressable>
              ) : (
                <View key={iso} style={[styles.time, { borderColor: colors.edge }]} accessible accessibilityLabel={said}>
                  {words}
                </View>
              );
            })}
          </View>
        </View>
        );
      })}
      {days.length > daysShown ? <Button label="Show more days" kind="plain" onPress={() => setDaysShown(daysShown + 7)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  all: { gap: 12 },
  day: { gap: 8 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  time: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  touch: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  small: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
});
