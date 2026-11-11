/** When each reminder may be sent. Plain logic, tested on its own. */
const HOUR = 3_600_000;
const MINUTE = 60_000;

export type Kind = "day" | "hour" | "open";
/** Each reminder's window: from how long before the start it may be sent, until when. */
const WINDOWS: Record<Kind, { from: number; until: number }> = {
  day: { from: 24 * HOUR, until: 23 * HOUR },
  hour: { from: 60 * MINUTE, until: 30 * MINUTE },
  open: { from: 5 * MINUTE, until: 0 },
};

/** Which reminders are due for a call that starts at `startsAt`, right now. Plain logic, tested on its own. */
export function dueReminders(startsAt: Date, now: Date): Kind[] {
  const left = startsAt.getTime() - now.getTime();
  return (Object.keys(WINDOWS) as Kind[]).filter((kind) => left <= WINDOWS[kind].from && left > WINDOWS[kind].until);
}
