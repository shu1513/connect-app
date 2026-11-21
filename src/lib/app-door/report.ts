/**
 * The report form for the phone app (plans/45-phone-apps/09-the-call.md, decision 9): the
 * website's form, in its words (src/lib/safety/report-words.ts), with its reasons and rules
 * (src/lib/safety/reports.ts). The app reports a person from a call, a request or a public
 * page; it has no diary posts to report.
 */
import "server-only";
import { callStopState } from "@/lib/safety/report-form";
import { REPORT_TEXT_MAX, REPORT_WORDS } from "@/lib/safety/report-words";
import { REPORT_REASONS } from "@/lib/safety/reports";
import type { AppReportForm } from "./types";

/** Where the app can report from. */
export const APP_REPORT_PLACES = ["call", "booking", "profile"] as const;
export type AppReportPlace = (typeof APP_REPORT_PLACES)[number];

/** The form. Like the website's page it shows itself for any place; whether the place is this person's to report from is decided when the report is sent. */
export async function reportFormFor(person: { id: string }, place: AppReportPlace, placeId: string): Promise<AppReportForm> {
  const stop = place === "call" ? await callStopState(person.id, placeId) : "no";
  return {
    title: REPORT_WORDS.title,
    stopped: stop === "stopped" ? REPORT_WORDS.stopped : stop === "stopping" ? REPORT_WORDS.stopping : null,
    words: REPORT_WORDS.aboutPerson,
    rules: { before: `${REPORT_WORDS.readThe} `, link: REPORT_WORDS.rules, after: "." },
    what: REPORT_WORDS.what,
    choose: REPORT_WORDS.choose,
    reasons: REPORT_REASONS.map((reason) => ({ key: reason.key, label: reason.label })),
    more: REPORT_WORDS.more,
    textMax: REPORT_TEXT_MAX,
    send: REPORT_WORDS.send,
    danger: REPORT_WORDS.danger,
  };
}
