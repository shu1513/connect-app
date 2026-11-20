/**
 * The shared pieces every screen is made of, so that every screen looks the same
 * (plans/45-phone-apps/02-the-frame.md): a page, a card, a button, a field with its label and its
 * problem line, a notice, "loading", and "something went wrong, try again".
 *
 * Each button and field has a name a screen reader can say, is at least 44 points tall, and its
 * text grows with the phone's text size.
 */
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { shape, type, useColors } from "./theme";

/** A whole screen: the warm page colour, safe from the phone's notch and bars, scrolling when it is long. */
export function Page({ title, children }: { title?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.page }]} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {title ? <Title>{title}</Title> : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
      {children}
    </Text>
  );
}

/** Ordinary words. `soft` for hints and captions. */
export function Words({ children, soft = false }: { children: ReactNode; soft?: boolean }) {
  const colors = useColors();
  return <Text style={[styles.words, { color: soft ? colors.soft : colors.text }]}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>{children}</View>;
}

type ButtonKind = "main" | "plain" | "danger";

/**
 * A button. "main" is the one thing to do on a screen; "plain" is everything else; "danger" is
 * for what cannot be undone. While `busy` it cannot be pressed again and says so.
 */
export function Button({ label, onPress, kind = "main", busy = false, disabled = false }: { label: string; onPress: () => void; kind?: ButtonKind; busy?: boolean; disabled?: boolean }) {
  const colors = useColors();
  const off = busy || disabled;
  const fill = kind === "main" ? colors.accent : colors.surface;
  const pressedFill = kind === "main" ? colors.accentDeep : colors.notice;
  const ink = kind === "main" ? colors.onAccent : kind === "danger" ? colors.danger : colors.text;
  const edge = kind === "main" ? colors.accent : kind === "danger" ? colors.danger : colors.edge;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: pressed ? pressedFill : fill, borderColor: edge, opacity: off ? 0.6 : 1 }]}
    >
      {busy ? <ActivityIndicator color={ink} /> : <Text style={[styles.buttonLabel, { color: ink }]}>{label}</Text>}
    </Pressable>
  );
}

/** A field with its label above it and, when something is wrong with what was typed, the reason below it. */
export function Field({ label, problem, ...input }: { label: string; problem?: string } & TextInputProps) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.soft}
        style={[styles.input, { backgroundColor: colors.surface, borderColor: problem ? colors.danger : colors.edge, color: colors.text }]}
        {...input}
      />
      {problem ? (
        <Text accessibilityRole="alert" style={[styles.problem, { color: colors.danger }]}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

/** Something the person should know: a result, a rule, what happens next. */
export function Notice({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: colors.notice, borderColor: colors.noticeLine }]}>
      <Text style={[styles.words, { color: colors.text }]}>{children}</Text>
    </View>
  );
}

/** Shown while the app is waiting for the server. */
export function Loading({ words = "One moment…" }: { words?: string }) {
  const colors = useColors();
  return (
    <View style={styles.centre} accessibilityRole="progressbar" accessibilityLabel={words}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={[styles.words, { color: colors.soft }]}>{words}</Text>
    </View>
  );
}

/** Something went wrong: what the server said (or that it could not be reached), and a way to try again. */
export function Problem({ words, onRetry }: { words: string; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.centre}>
      <Text accessibilityRole="alert" style={[styles.words, styles.centred, { color: colors.text }]}>
        {words}
      </Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} kind="plain" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { padding: shape.gap, gap: shape.gap, paddingBottom: 48 },
  title: { fontSize: type.title, fontWeight: "800", letterSpacing: -0.6, lineHeight: 36 },
  heading: { fontSize: type.heading, fontWeight: "700", lineHeight: 28 },
  words: { fontSize: type.body, lineHeight: 26 },
  centred: { textAlign: "center" },
  card: { borderWidth: 1, borderRadius: shape.card, padding: shape.pad, gap: 12 },
  button: { minHeight: shape.touch, minWidth: shape.touch, borderWidth: 1, borderRadius: shape.pill, paddingVertical: 12, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontSize: type.body, fontWeight: "700" },
  field: { gap: 6 },
  label: { fontSize: type.body, fontWeight: "600" },
  input: { minHeight: shape.touch, borderWidth: 1, borderRadius: shape.field, paddingVertical: 10, paddingHorizontal: 14, fontSize: type.body },
  problem: { fontSize: type.small, lineHeight: 20 },
  notice: { borderWidth: 1, borderRadius: shape.field, padding: 12 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: shape.gap, padding: shape.pad },
});
