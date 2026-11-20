import Ionicons from "@expo/vector-icons/Ionicons";
import { NativeTabs } from "expo-router/native-tabs";
import { useColors } from "@/ui/theme";

/**
 * The four places at the bottom of the app (plans/45-phone-apps/02-the-frame.md): Home, Search,
 * Calls, Account. A choice for phones: the website's top line also has Following and Hosting,
 * which are one touch from Home and from Account here.
 */
export default function Places() {
  const colors = useColors();
  return (
    <NativeTabs backgroundColor={colors.surface} indicatorColor={colors.notice} iconColor={{ default: colors.soft, selected: colors.accent }} labelStyle={{ default: { color: colors.soft }, selected: { color: colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="home-outline" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="search-outline" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calls">
        <NativeTabs.Trigger.Label>Calls</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="videocam-outline" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="person-outline" />} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
