/**
 * The guard against a customer who ends calls and reports the host again and again to pay less
 * (plans/51-end-call-now.md, decision 16; the builder's choice, on the founder's word "do what
 * you think is the best").
 *
 * Plain facts in, an answer out. No database and no clock.
 */

export const END_GUARD = {
  /** "His last 5 calls": this call and the 4 before it. */
  calls: 5,
  /** With this many of them lowered by a report of his, a further report lowers nothing. */
  line: 3,
  /** How far back "another person has also reported that host" looks. */
  othersWithinDays: 365,
} as const;

/**
 * What a customer's report after his own "End call now" did to that call's charge, as written on
 * the call when the report is taken and never worked out again:
 *   minutes            lowered to the time the call lasted, and it counts toward the line
 *   minutes_uncounted  lowered, and it does not count: another person has also reported that host
 *   whole              not lowered: he is past the line
 */
export type EndReportEffect = "minutes" | "minutes_uncounted" | "whole";

/** Whether this effect means "charged by the minutes". */
export const lowers = (effect: string | null | undefined): boolean => effect === "minutes" || effect === "minutes_uncounted";

/**
 * Decides one report. `earlier` is what stands on the calls before this one that took place,
 * newest first (null for a call with no such report); only the first 4 are read.
 * `crossesLine` is true for the report that makes it 3 of 5: the founder is told then, once.
 *
 * Past the line nothing lowers the charge, whoever else has reported that host. So what a
 * customer sees (lowered, or not) never depends on other people's reports, and tells him nothing
 * about them: they only decide whether his own report is counted.
 */
export function endReportEffect(input: { earlier: Array<string | null>; othersReported: boolean }): { effect: EndReportEffect; crossesLine: boolean } {
  const counted = input.earlier.slice(0, END_GUARD.calls - 1).filter((effect) => effect === "minutes").length;
  if (counted >= END_GUARD.line) return { effect: "whole", crossesLine: false };
  // Several people reporting one host is the strongest sign that a report is true: lowered like any other, and not counted.
  if (input.othersReported) return { effect: "minutes_uncounted", crossesLine: false };
  return { effect: "minutes", crossesLine: counted + 1 === END_GUARD.line };
}
