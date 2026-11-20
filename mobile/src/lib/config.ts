/**
 * The app's settings (plans/45-phone-apps/02-the-frame.md).
 *
 * Which server the app talks to is a setting, never written into the code: the test build on this
 * Mac talks to the website running on this Mac, a real app talks to the real address. It comes
 * from EXPO_PUBLIC_SERVER_URL when the app is built (see mobile/README.md).
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

/** The server's address, without a slash at the end. Empty when the setting is missing: nothing is then sent at all. */
export const SERVER = (process.env.EXPO_PUBLIC_SERVER_URL ?? "").trim().replace(/\/+$/, "");

/** This copy's version, as the server is told it. */
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

export const PLATFORM: "android" | "ios" = Platform.OS === "ios" ? "ios" : "android";

/**
 * Whether this copy has the test screens (the kit check and "the look"). Always in the everyday
 * test build; in a build made the way a store build is made, only when it was built with
 * EXPO_PUBLIC_TEST_SCREENS=1 to try the kits there (see mobile/README.md). A build for a store is
 * made without it, and the test screens then cannot be opened at all, by a button or by a link.
 */
export const TEST_SCREENS = __DEV__ || process.env.EXPO_PUBLIC_TEST_SCREENS === "1";

/**
 * Whether the server's address may be a plain `http` one. Only in a test build, where the server
 * is the website on this Mac. Any other copy of the app sends nothing over a connection that is
 * not locked: with a plain address in its settings it reaches nothing at all.
 */
export const PLAIN_HTTP_ALLOWED = TEST_SCREENS;
