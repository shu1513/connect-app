/**
 * The shared pieces every screen is made of, so that every screen looks the same
 * (plans/45-phone-apps/02-the-frame.md): a page, a card, a button, a field with its label and its
 * problem line, a box to tick, a link, a notice, "loading", and "something went wrong, try again".
 *
 * Each button and field has a name a screen reader can say, is at least 44 points tall, and its
 * text grows with the phone's text size.
 */
import { createContext, useContext, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type TextInputProps } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { shape, type, useColors } from "./theme";

/**
 * A whole screen: the warm page colour, safe from the phone's notch and bars, scrolling when it
 * is long. When the keyboard is up the page ends above it, so the field being typed in, and what
 * is under it, can be scrolled into sight. With `onRefresh`, pulling the page down asks again.
 */
export function Page({ title, children, refreshing, onRefresh }: { title?: string; children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const colors = useColors();
  // Counts up whenever the page has stopped moving, so a piece that needs to know whether it is on the screen can look.
  const [settled, setSettled] = useState(0);
  // Where the page's own window is on the screen: from under the title bar down to the bar of places at the bottom.
  const [view, setView] = useState({ top: 0, bottom: 0 });
  const frame = useRef<ComponentRef<typeof View>>(null);
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  // On an iPhone the page runs on behind the bar of places at the bottom (the phone lets it show through), so the
  // page's own measure reaches too far down: what is behind the bar is not in sight. An iPhone's bar is 49 points
  // tall above the home line. (To be looked at on a real iPhone in part 20.)
  const lowest = screen.height - insets.bottom - (Platform.OS === "ios" ? 49 : 0);
  const moved = () => {
    frame.current?.measureInWindow((_x, y, _width, height) => {
      const bottom = Math.min(y + height, lowest);
      setView((was) => (was.top === y && was.bottom === bottom ? was : { top: y, bottom }));
    });
    setSettled((count) => count + 1);
  };
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.page }]} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <View ref={frame} style={styles.fill} collapsable={false} onLayout={moved}>
        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          onScrollEndDrag={moved}
          onMomentumScrollEnd={moved}
          onContentSizeChange={moved}
          // Pulling the page down asks the server again, on a page that has something to ask.
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} /> : undefined}
        >
          <Settled.Provider value={{ settled, top: view.top, bottom: view.bottom }}>
            {title ? <Title>{title}</Title> : null}
            {children}
          </Settled.Provider>
        </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Settled = createContext({ settled: 0, top: 0, bottom: 0 });
/**
 * For a piece that must know whether it is in sight: `settled` changes each time the page has come
 * to rest after moving or growing (the moment to look), and `top` and `bottom` say where on the
 * screen the page's own window is (what lies under the bar of places at the bottom is not in sight).
 */
export function usePageView(): { settled: number; top: number; bottom: number } {
  return useContext(Settled);
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

/** A box to tick, with its words beside it. The whole row can be touched. */
export function Tick({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (checked: boolean) => void; children?: ReactNode }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={styles.tick}>
      <View style={[styles.tickBox, { borderColor: checked ? colors.accent : colors.edge, backgroundColor: checked ? colors.accent : colors.surface }]}>
        {checked ? <Text style={[styles.tickMark, { color: colors.onAccent }]}>✓</Text> : null}
      </View>
      <Text style={[styles.words, styles.tickWords, { color: colors.text }]}>{children ?? label}</Text>
    </Pressable>
  );
}

/** Words that lead somewhere when touched: another screen, or a page of the website. */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={styles.link} hitSlop={4}>
      <Text style={[styles.words, styles.linkWords, { color: colors.accent }]}>{label}</Text>
    </Pressable>
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
  tick: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: shape.touch, paddingVertical: 6 },
  tickBox: { width: 28, height: 28, borderWidth: 2, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 2 },
  tickMark: { fontSize: 18, fontWeight: "800", lineHeight: 22 },
  tickWords: { flex: 1 },
  link: { minHeight: shape.touch, justifyContent: "center", alignSelf: "flex-start" },
  linkWords: { textDecorationLine: "underline", fontWeight: "600" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: shape.gap, padding: shape.pad },
});
