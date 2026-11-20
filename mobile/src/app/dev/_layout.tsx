import { Redirect, Stack } from "expo-router";
import { TEST_SCREENS } from "@/lib/config";
import { useColors } from "@/ui/theme";

/**
 * The test screens (plans/45-phone-apps/02-the-frame.md). They exist only in a test build: in any
 * other copy of the app, opening one, by a link too, leads to the front page.
 */
export default function TestScreens() {
  const colors = useColors();
  if (!TEST_SCREENS) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />;
}
