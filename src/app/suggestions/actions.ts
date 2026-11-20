"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { hideSuggestion, makeSuggestions, markSeen } from "@/lib/suggestions/suggestions";

/**
 * Makes the logged-in person's suggestions for today, if they have not been made yet (plans/37).
 * Called by the home page once it is in the browser, never while the page is drawn. Whose
 * suggestions they are comes from the login; nothing is taken from the browser.
 */
export async function makeSuggestionsAction(): Promise<void> {
  const user = await requireUser();
  // A paused person gets no suggestions; nothing is written for them, so they get theirs on the day the pause ends.
  if (user.paused) return;
  await makeSuggestions(user.id, new Date());
}

/**
 * Marks suggestion cards as really seen on the screen: the person's own, of the day the page
 * showed, in these places. What the browser sends is only read as a day and a few numbers.
 */
export async function markSeenAction(day: string, places: number[]): Promise<void> {
  const user = await requireUser();
  if (typeof day !== "string" || !Array.isArray(places)) return;
  await markSeen(user.id, day.slice(0, 10), places.slice(0, 12).filter((place): place is number => typeof place === "number"), new Date());
}

/** The X on a suggestion: hides that host from this person's suggestions for good. A paused person can do this too. */
export async function hideSuggestionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  let notice = "Hidden. You will not be suggested this host again. You can still find them with the search.";
  try {
    await hideSuggestion(user.id, String(formData.get("handle") ?? ""), new Date());
  } catch (error) {
    console.error("[suggestions] could not hide a suggestion", error);
    notice = "Something went wrong. Nothing was changed. Please try again.";
  }
  redirect(withNotice("/", notice));
}
