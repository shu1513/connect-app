/**
 * Opens a page of Connect's website in the phone's browser sheet, over the app
 * (plans/45-phone-apps/03-signing-in.md, decision 6). Only ever a page of the server in the app's
 * settings; nothing of the app's sign-in goes with it.
 */
import * as WebBrowser from "expo-web-browser";
import { SERVER_USABLE } from "./auth";
import { SERVER } from "./config";

/**
 * Only pages anyone may read: a page that needs the website's own sign-in would show the browser's person, not the
 * app's. These are the legal documents of the website, also one exact version of one ("/terms?version=2026-11-20"),
 * which is what the step that accepts them links to.
 */
const READABLE = /^\/(rules|terms|payment-terms|privacy|host-agreement|copyright|identity-notice)(\?version=[0-9A-Za-z-]+)?$/;

export function isWebsitePage(page: string): boolean {
  return READABLE.test(page);
}

export async function openWebsite(page: string): Promise<void> {
  if (!SERVER_USABLE || !isWebsitePage(page)) return;
  await WebBrowser.openBrowserAsync(`${SERVER}${page}`).catch(() => {});
}
