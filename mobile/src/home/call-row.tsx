import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppAbout, AppCall } from "../../../src/lib/app-door/types";
import { callsBeforeWords, dateOnly, localTime, timeOnly } from "@/lib/home-rules";
import { Photo } from "@/ui/photo";
import { type, useColors } from "@/ui/theme";

/**
 * What a host sees about the customer of a call she hosts (plans/38, and
 * plans/45-phone-apps/04-the-home-page.md, rules 1, 2 and 5): what they want to talk about, "ID
 * confirmed", "Your member", how often the two have talked, and her own note, folded. It draws
 * what the server sent for this call and decides nothing; a call without it draws nothing here.
 */
export function AboutLines({ name, about, short = false }: { name: string; about: AppAbout; short?: boolean }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const facts = [about.idConfirmed ? "ID confirmed" : null, about.member ? "Your member" : null, `${callsBeforeWords(about.callsBefore)}${about.callsBefore > 0 && about.lastCallAt ? ` ${dateOnly(about.lastCallAt)}` : ""}`].filter(Boolean).join(" · ");
  return (
    <View style={styles.about}>
      {about.words ? (
        // In a list, two lines of it; on the card of the next call, all of it.
        <Text style={[styles.small, { color: colors.text }]} numberOfLines={short ? 2 : undefined}>
          “{about.words}”
        </Text>
      ) : null}
      <Text style={[styles.small, { color: colors.soft }]}>{facts}</Text>
      {about.note ? (
        // Folded: a list is on show for a long time, and a host may be showing her screen to someone.
        <View style={[styles.note, { borderColor: colors.edge }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Your notes about ${name}`} onPress={() => setOpen(!open)} style={styles.noteHead}>
            <Text style={[styles.small, styles.bold, { color: colors.text }]}>
              {open ? "▾" : "▸"} Your notes about {name}
            </Text>
          </Pressable>
          {open ? (
            <View style={styles.noteBody}>
              <Text style={[styles.small, { color: colors.soft }]}>Your private notes. Only you can see them.</Text>
              <Text style={[styles.small, { color: colors.text }]}>{about.note}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One call as a list shows it. `withTimeOnly`: under a day's heading only the time is written.
 * `plain`: without what a host is told about the customer (on the card of the next call that is
 * shown once, above). `alone`: not in a list, so without the line that parts it from the row before.
 */
export function CallRow({ call, withTimeOnly = false, plain = false, alone = false }: { call: AppCall; withTimeOnly?: boolean; plain?: boolean; alone?: boolean }) {
  const colors = useColors();
  const facts = [`${call.minutes} minutes`, call.payment, call.hosting ? "You host this call" : null, call.open && !call.finished ? "Open now" : null, call.finished ? "Finished" : null].filter(Boolean).join(" · ");
  return (
    <View style={[styles.row, { borderTopColor: colors.line }, alone ? styles.alone : null]}>
      <Photo photoId={call.photoId} name={call.name} small />
      <View style={styles.rowWords}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>
          {withTimeOnly ? timeOnly(call.startsAt) : localTime(call.startsAt)} · {call.name}
        </Text>
        <Text style={[styles.small, { color: colors.soft }]}>{facts}</Text>
        {call.earned ? (
          <Text style={[styles.small, styles.bold, { color: colors.text }]}>
            You earned {call.earned.text}
            {call.earned.soFar ? " so far" : ""}
          </Text>
        ) : null}
        {call.about && !plain ? <AboutLines name={call.name} about={call.about} short /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1, alignItems: "flex-start" },
  alone: { borderTopWidth: 0, paddingTop: 4 },
  rowWords: { flex: 1, gap: 2 },
  rowTitle: { fontSize: type.body, fontWeight: "700", lineHeight: 22 },
  small: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
  about: { gap: 2, marginTop: 4 },
  note: { borderWidth: 1, borderRadius: 8, marginTop: 6 },
  noteHead: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  noteBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
});
