import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { OpeningProvider, useOpening } from "@/lib/opening";
import { Loading, Problem } from "@/ui/pieces";
import { useColors } from "@/ui/theme";

/**
 * The frame every screen sits in (plans/45-phone-apps/02-the-frame.md). Before any screen is
 * shown the app asks the server its first question. Until the answer is in it says so; if the
 * server cannot be reached it says that and offers to try again; if this copy is too old it says
 * that and offers no way on.
 */
export default function RootLayout() {
  const dark = useColorScheme() === "dark";
  return (
    <SafeAreaProvider>
      <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
        <StatusBar style={dark ? "light" : "dark"} />
        <OpeningProvider>
          <Opened />
        </OpeningProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Opened() {
  const { opening, askAgain } = useOpening();
  const colors = useColors();
  if (opening.kind === "ready") return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      {opening.kind === "asking" ? <Loading words="Opening Connect…" /> : null}
      {opening.kind === "unreachable" ? <Problem words={opening.message} onRetry={askAgain} /> : null}
      {opening.kind === "update" ? <Problem words={opening.message} /> : null}
    </SafeAreaView>
  );
}
