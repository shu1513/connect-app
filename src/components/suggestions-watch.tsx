"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { makeSuggestionsAction, markSeenAction } from "@/app/suggestions/actions";

/** After a failed try the next one comes this much later, and there are this many tries in all. */
const RETRY_MS = 60_000;
const TRIES = 3;

/**
 * Asks the server to make today's suggestions, and then for the page again (plans/37, decision
 * 8). Drawn only while today's suggestions do not exist yet, and with the day as its `key`, so a
 * tab that stays open past midnight asks again for the new day. The page itself never writes
 * while it is drawn; this is the part that does, from a real browser.
 *
 * One request per try. If it fails, it is tried again a minute later, three times in all; after
 * that the row stays away until the page is opened again. Never in a loop.
 */
export function MakeSuggestions() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const asked = useRef(-1);
  useEffect(() => {
    // Asked once for each try, also when the effect is run twice (as it is while developing).
    if (asked.current === tries) return;
    asked.current = tries;
    let again: ReturnType<typeof setTimeout> | undefined;
    makeSuggestionsAction().then(
      () => router.refresh(),
      () => {
        if (tries + 1 < TRIES) again = setTimeout(() => setTries(tries + 1), RETRY_MS);
      },
    );
    return () => clearTimeout(again);
  }, [router, tries]);
  return null;
}

/**
 * Tells the server which suggestion cards really came into view (plans/37, decision 14), each
 * once: a card counts when at least half of it is on the screen. `places` are the cards of the
 * page that are not marked as seen yet; they are found by their `data-suggested-place`. Drawn
 * with the day as its `key`, so what was told about one day is forgotten for the next.
 *
 * A card that was told successfully is no longer watched. If the telling fails, the card stays
 * watched and is told again the next time it comes into view; nothing is retried by itself.
 */
export function SeenSuggestions({ day, places }: { day: string; places: number[] }) {
  // The places being told right now, or told already.
  const told = useRef(new Set<number>());
  const key = places.join(",");
  useEffect(() => {
    const wanted = new Set(key === "" ? [] : key.split(",").map(Number));
    const cards = [...document.querySelectorAll<HTMLElement>("[data-suggested-place]")].filter((card) => wanted.has(Number(card.dataset.suggestedPlace)));
    if (cards.length === 0 || typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver(
      (entries) => {
        const seen: Array<{ place: number; card: Element }> = [];
        for (const entry of entries) {
          const place = Number((entry.target as HTMLElement).dataset.suggestedPlace);
          // The browser also calls this when a card only touches the screen's edge: half of it must be there.
          if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || told.current.has(place)) continue;
          told.current.add(place);
          seen.push({ place, card: entry.target });
        }
        if (seen.length === 0) return;
        markSeenAction(day, seen.map((one) => one.place)).then(
          () => seen.forEach((one) => watcher.unobserve(one.card)),
          () => seen.forEach((one) => told.current.delete(one.place)),
        );
      },
      { threshold: 0.5 },
    );
    for (const card of cards) watcher.observe(card);
    return () => watcher.disconnect();
  }, [day, key]);
  return null;
}
