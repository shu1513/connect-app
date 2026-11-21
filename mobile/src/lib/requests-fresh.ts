/**
 * A host's list of requests is kept on its screen while she looks at one of them
 * (plans/45-phone-apps/07-a-hosts-requests.md). When she blocks someone from a request's screen,
 * what the list held about that person must not be shown again, also not for the moment a fresh
 * reading takes, and not if that reading fails. The request's screen says so here; the list looks
 * here when it comes back in front, and shows nothing it held from before.
 */
let blocks = 0;

/** A block was sent from a request's screen (whatever became of it: after it, only a fresh reading counts). */
export function blockSent(): void {
  blocks++;
}

/** How many blocks were sent so far in this run of the app. A list remembers the number it was read under. */
export function blocksSent(): number {
  return blocks;
}
