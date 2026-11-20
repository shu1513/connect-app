import { Alert, StyleSheet, Text, View } from "react-native";
import type { AppAnswer } from "../../../src/lib/app-door/types";
import { plainWords } from "@/lib/book-rules";
import { localTime, ratingWords } from "@/lib/home-rules";
import { Photo } from "@/ui/photo";
import { type, useColors } from "@/ui/theme";

/**
 * The person asking a host for a call, as the host may know them
 * (plans/45-phone-apps/07-a-hosts-requests.md): the photo if she is handed one, the name, how
 * other hosts rated them, and whether their ID is confirmed. What may be said is decided on the
 * server; for someone whose account is closed, or across a block, only the name arrives.
 */
export function Asker({ name, photoId, rating, ratingWords: none, idConfirmed, line }: { name: string; photoId: string | null; rating: { average: number; count: number } | null; ratingWords: string | null; idConfirmed: boolean; line?: string }) {
  const colors = useColors();
  const rated = rating || none ? ratingWords(rating, none ?? "") : null;
  return (
    <View style={styles.row}>
      <Photo photoId={photoId} name={name} small />
      <View style={styles.words}>
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
        {line ? <Text style={[styles.small, { color: colors.text }]}>{line}</Text> : null}
        {rated ? <Text style={[styles.small, { color: colors.soft }]}>{rated}</Text> : null}
        {idConfirmed ? <Text style={[styles.small, { color: colors.good }]}>ID confirmed</Text> : null}
      </View>
    </View>
  );
}

/**
 * Asks once more before a request is accepted, in the server's own words with the time written in
 * the phone's time zone: a touch by mistake would make a commitment. Declining is not asked about.
 *
 * `still`: the screen's watch, taken as the question is put (`useWatch`). The question stays up
 * even when another screen comes to the front beneath it (a link opened meanwhile), so a "yes"
 * only counts while the screen it was asked on is still the one in front.
 */
export function askBeforeAccepting(answer: AppAnswer, still: () => boolean, onYes: () => void): void {
  Alert.alert(answer.accept, plainWords(answer.sure, localTime), [
    { text: answer.no, style: "cancel" },
    {
      text: answer.yes,
      onPress: () => {
        if (still()) onYes();
      },
    },
  ]);
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  words: { flex: 1, gap: 2 },
  name: { fontSize: type.body, fontWeight: "700", lineHeight: 22 },
  small: { fontSize: type.small, lineHeight: 20 },
});
