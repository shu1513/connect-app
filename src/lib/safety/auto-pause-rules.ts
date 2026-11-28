/**
 * When the app pauses an account by itself (plans/52-automatic-pause.md): the numbers, the plain
 * logic and the sentences. No database. Every number is here and nowhere else.
 *
 * A pause ends the account's memberships and monthly contributions for good, so the lines are
 * high on purpose: they are meant to be reached by an account many different, real customers
 * complain about, and not by one angry person or by two who work together.
 */
import type { ShownAverage } from "@/lib/ratings/rules";

export const AUTO_PAUSE = {
  /** Reports: this many different people, whose reports count, within `withinDays`. */
  reporters: 5,
  withinDays: 90,
  /** ... and those people are at least one in this many of all the different people the account had a really paid call with in that time. */
  oneIn: 10,
  /** Ratings: an average of this or lower, from at least `minRaters` different people who each rated a call that was really paid for. */
  lowAverage: 2.0,
  minRaters: 10,
  /** Ratings: at this average or lower the person is warned by email, once. */
  warnAverage: 2.5,
} as const;

/**
 * Whether reports pause an account. `reporters`: the different people whose reports count.
 * `people`: all the different people the account had a really paid call with in the same time
 * (every counted reporter is one of them, so the share can never be above one).
 */
export function reportsPause(input: { reporters: number; people: number }): boolean {
  return input.reporters >= AUTO_PAUSE.reporters && input.reporters * AUTO_PAUSE.oneIn >= input.people;
}

/** Whether an average, counted as the shown one is, pauses an account. */
export function ratingsPause(shown: ShownAverage | null): boolean {
  return shown !== null && shown.count >= AUTO_PAUSE.minRaters && shown.average <= AUTO_PAUSE.lowAverage;
}

/** Whether an average is low enough for the one warning (and not yet for the pause). */
export function ratingsWarn(shown: ShownAverage | null): boolean {
  return shown !== null && shown.average <= AUTO_PAUSE.warnAverage && !ratingsPause(shown);
}

const roleWords = (as: "host" | "customer") => (as === "host" ? "as a host" : "as a customer");

/**
 * The sentences. `reason` is what the paused page shows the person and what the founder's list
 * shows; `because` goes on after "Your account has been paused" in the person's email. None names
 * who reported or rated, or says how many reports there were beyond the rule itself.
 */
export const AUTO_PAUSE_WORDS = {
  reports: {
    reason: `Paused automatically: ${AUTO_PAUSE.reporters} or more different people who had paid calls with this account reported it within ${AUTO_PAUSE.withinDays} days.`,
    because: `automatically, because ${AUTO_PAUSE.reporters} or more different people who had calls with you reported you to us within ${AUTO_PAUSE.withinDays} days. Nobody at Connect has judged those reports: the app does this by itself, and a person will look at it if you write to us.`,
    founderSubject: "An account was paused automatically: reports",
    founderText: (person: { name: string; email: string }, facts: { reporters: number; people: number }, listUrl: string) =>
      `The app has paused the account of ${person.name} (${person.email}) by itself: ${facts.reporters} different people who had paid calls with them reported them in the last ${AUTO_PAUSE.withinDays} days, out of ${facts.people} people they had paid calls with in that time. Their waiting requests are ended and their calls that have not started are cancelled at no charge; their memberships and monthly contributions have ended.\n\nThere is nothing to do unless they write in. If the pause is wrong, lift it here, and the reports made so far will not pause the account again:\n\n${listUrl}`,
    founderAlready: (person: { name: string; email: string }, listUrl: string) =>
      `The reports about ${person.name} (${person.email}) reached the line for an automatic pause, but the account was paused already, for another reason. Nothing was changed. Please keep it in mind before lifting that pause:\n\n${listUrl}`,
  },
  ratings: {
    reason: (as: "host" | "customer", shown: ShownAverage) =>
      `Paused automatically: an average rating ${roleWords(as)} of ${shown.average.toFixed(1)} from ${shown.count} people, counting paid calls only. The line is ${AUTO_PAUSE.lowAverage.toFixed(1)} or lower from ${AUTO_PAUSE.minRaters} or more people.`,
    because: (as: "host" | "customer", shown: ShownAverage) =>
      `automatically, because your average rating ${roleWords(as)}, counting paid calls only, is ${shown.average.toFixed(1)} from ${shown.count} people, and an account with an average of ${AUTO_PAUSE.lowAverage.toFixed(1)} or lower from ${AUTO_PAUSE.minRaters} or more people is paused. The app does this by itself, and a person will look at it if you write to us.`,
    founderSubject: "An account was paused automatically: ratings",
    founderText: (person: { name: string; email: string }, as: "host" | "customer", shown: ShownAverage, listUrl: string) =>
      `The app has paused the account of ${person.name} (${person.email}) by itself: their average rating ${roleWords(as)}, counting paid calls only, is ${shown.average.toFixed(1)} from ${shown.count} people. Their waiting requests are ended and their calls that have not started are cancelled at no charge; their memberships and monthly contributions have ended.\n\nThere is nothing to do unless they write in. If the pause is wrong, lift it here, and the ratings counted so far will not pause the account again:\n\n${listUrl}`,
    founderAlready: (person: { name: string; email: string }, listUrl: string) =>
      `The ratings of ${person.name} (${person.email}) reached the line for an automatic pause, but the account was paused already, for another reason. Nothing was changed. Please keep it in mind before lifting that pause:\n\n${listUrl}`,
    warnSubject: "Your ratings on Connect are low",
    warnText: (name: string, as: "host" | "customer", shown: ShownAverage, support: string) =>
      `Hi ${name},\n\nYour average rating ${roleWords(as)} on Connect, counting paid calls only, is ${shown.average.toFixed(1)} from ${shown.count} people. Your account page shows your average over all your calls.\n\nWe are telling you because an account whose average is ${AUTO_PAUSE.lowAverage.toFixed(1)} or lower from ${AUTO_PAUSE.minRaters} or more people is paused automatically. A paused account cannot book, host or join calls, and its memberships and monthly contributions end.\n\nA rating starts to count a week after the call, each person counts once, and nobody can see what one particular person gave. This is the only email of this kind you will get. If you have a question, write to ${support}.`,
  },
} as const;
