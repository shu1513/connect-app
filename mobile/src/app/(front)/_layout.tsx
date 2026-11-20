import { Stack } from "expo-router";
import { useColors } from "@/ui/theme";

/** The first screens, for someone who is not signed in (plans/45-phone-apps/03-signing-in.md). */
export default function Front() {
  const colors = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />;
}
