/**
 * Opens a page of Connect's website in the phone's browser sheet, over the app
 * (plans/45-phone-apps/03-signing-in.md, decision 6). Only ever a page of the server in the app's
 * settings; nothing of the app's sign-in goes with it.
 */
import * as WebBrowser from "expo-web-browser";
import { SERVER_USABLE } from "./auth";
import { SERVER } from "./config";

/** Only pages anyone may read: a page that needs the website's own sign-in would show the browser's person, not the app's. */
export type WebsitePage = "/rules" | "/terms" | "/privacy";

export async function openWebsite(page: WebsitePage): Promise<void> {
  if (!SERVER_USABLE) return;
  await WebBrowser.openBrowserAsync(`${SERVER}${page}`).catch(() => {});
}
