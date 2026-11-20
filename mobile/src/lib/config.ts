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
