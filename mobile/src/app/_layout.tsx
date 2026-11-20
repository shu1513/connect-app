import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCardReturns } from "@/lib/card";
import { OpeningProvider, useOpening } from "@/lib/opening";
import { whereFor } from "@/lib/where-rules";
import { Loading, Problem } from "@/ui/pieces";
import { useColors } from "@/ui/theme";

/**
 * The frame every screen sits in (plans/45-phone-apps/02-the-frame.md). Before any screen is
 * shown the app asks the server its first question. Until the answer is in it says so; if the
 * server cannot be reached it says that and offers to try again; if this copy is too old it says
 * that and offers no way on.
 *
 * Once the answer is in, it decides which part of the app is open
 * (plans/45-phone-apps/03-signing-in.md): the first screens for someone not signed in, the "18 or
 * older and terms" step, or the app itself. The other parts are not there to go to, by a link
 * either.
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
  // A bank's approval page hands the person back to the app by a link; Stripe's kit is told (an iPhone needs it).
  useCardReturns();
  if (opening.kind === "ready") {
    const where = whereFor(opening.start);
    return (
      // Every screen belongs to whoever is signed in. When that becomes someone else, every screen is made anew, so
      // nothing one person was shown (calls, notes, photos) can still stand on the next person's screen.
      <Stack key={opening.start.me?.id ?? "nobody"} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
        {/* The app itself, and the screens only someone signed in has: asking for a call, a request, a host's list of requests, a call's page, the call itself, the report form, the ID check. */}
        <Stack.Protected guard={where === "home"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="book/[handle]" />
          <Stack.Screen name="bookings/[id]" />
          <Stack.Screen name="requests" />
          <Stack.Screen name="calls/[id]" />
          {/* The call itself: no swiping back out of it by accident (the buttons on the screen leave it). */}
          <Stack.Screen name="room/[id]" options={{ gestureEnabled: false }} />
          <Stack.Screen name="report" />
          <Stack.Screen name="identity" />
        </Stack.Protected>
        <Stack.Protected guard={where === "welcome"}>
          <Stack.Screen name="(welcome)" />
        </Stack.Protected>
        <Stack.Protected guard={where === "front"}>
          <Stack.Screen name="(front)" />
        </Stack.Protected>
        <Stack.Screen name="dev" />
        <Stack.Screen name="+not-found" />
      </Stack>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      {opening.kind === "asking" ? <Loading words="Opening Connect…" /> : null}
      {opening.kind === "unreachable" ? <Problem words={opening.message} onRetry={askAgain} /> : null}
      {opening.kind === "update" ? <Problem words={opening.message} /> : null}
    </SafeAreaView>
  );
}
