import { Redirect } from "expo-router";

/**
 * A link into the app that leads to no screen (an old link, a mistyped one) leads to the front
 * page. It sits inside the app's frame like every other screen, so a copy that is too old, or one
 * that cannot reach Connect, says that first (plans/45-phone-apps/02-the-frame.md).
 */
export default function NoSuchScreen() {
  return <Redirect href="/" />;
}
