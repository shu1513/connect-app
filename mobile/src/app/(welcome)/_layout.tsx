import { Stack } from "expo-router";
import { useColors } from "@/ui/theme";

/** The "18 or older and terms" step, for someone signed in who has not done it (plans/45-phone-apps/03-signing-in.md). */
export default function WelcomeStep() {
  const colors = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />;
}
