/**
 * The plain logic of search and a host's page in the app
 * (plans/45-phone-apps/05-search-and-a-hosts-page.md): checking the server's answers, and
 * grouping the open times by the phone's own days. The server sends moments on the world's clock;
 * which day each falls on is the phone's to say.
 */
import type { AppHostPage, AppSearch } from "../../../src/lib/app-door/types";
import { dayOf } from "../../../src/lib/home/rules";

const isThing = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isMoment = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const isListOf = (value: unknown, each: (item: Record<string, unknown>) => boolean): boolean => Array.isArray(value) && value.every((item) => isThing(item) && each(item));
const isRating = (value: unknown): boolean => value === null || (isThing(value) && typeof value.average === "number" && typeof value.count === "number");
const isLengths = (value: unknown): boolean => isListOf(value, (length) => typeof length.minutes === "number" && isText(length.words));
const isNumberOrNull = (value: unknown): boolean => value === null || typeof value === "number";

/** Whether an answer really is a search result, with the parts the screen reads. */
export function isSearch(data: unknown): data is AppSearch {
  if (!isThing(data) || !isText(data.typed) || typeof data.searched !== "boolean" || !isTextOrNull(data.hint) || !isTextOrNull(data.more)) return false;
  return isListOf(
    data.hosts,
    (host) => isText(host.handle) && isText(host.name) && isText(host.about) && isText(host.price) && Array.isArray(host.languages) && host.languages.every(isText) && isListOf(host.socials, (social) => isText(social.label) && isText(social.name)) && isRating(host.rating) && isTextOrNull(host.photoId),
  );
}

/** Whether an answer really is a host's page, with the parts the screen reads. */
export function isHostPage(data: unknown): data is AppHostPage {
  if (!isThing(data) || !isText(data.handle) || !isText(data.name) || !isText(data.about) || !isTextOrNull(data.photoId) || !isRating(data.rating)) return false;
  if (!Array.isArray(data.languages) || !data.languages.every(isText) || !isListOf(data.socials, (social) => isText(social.label) && isText(social.name) && isText(social.url))) return false;
  if (typeof data.own !== "boolean" || !isTextOrNull(data.shareUrl) || !isText(data.price) || !isText(data.callWords) || typeof data.verifiedOnly !== "boolean" || typeof data.confirmId !== "boolean") return false;
  if (data.follow !== null && data.follow !== "following" && data.follow !== "ended" && data.follow !== "none" && data.follow !== "visitor") return false;
  if (data.now !== null && !(isThing(data.now) && isLengths(data.now.lengths) && typeof data.now.answerMinutes === "number" && typeof data.now.paid === "boolean")) return false;
  const ask = data.ask;
  if (!isThing(ask) || !isText(ask.title) || !isTextOrNull(ask.closed) || !isTextOrNull(ask.words) || !isLengths(ask.lengths) || !isNumberOrNull(ask.chosen) || !isTextOrNull(ask.noTimes)) return false;
  if (!Array.isArray(ask.starts) || !ask.starts.every(isMoment)) return false;
  const membership = data.membership;
  if (membership === null) return true;
  if (!isThing(membership) || !(membership.invitedUntil === null || isMoment(membership.invitedUntil))) return false;
  if (membership.state !== null && !(isThing(membership.state) && isText(membership.state.status) && isText(membership.state.words))) return false;
  const member = membership.member;
  if (member === null) return true;
  return isThing(member) && isText(member.left) && isMoment(member.until) && isText(member.price) && isTextOrNull(member.held) && typeof member.tooLittle === "boolean" && isLengths(member.lengths) && isNumberOrNull(member.chosen) && isListOf(member.times, (time) => isMoment(time.startsAt) && typeof time.membersOnly === "boolean");
}

/**
 * Open times, day by day in a time zone, in order: each day as "2026-11-21" with its moments. The
 * phone names the days and writes the times itself.
 */
export function byDay(starts: readonly string[], zone: string): { day: string; starts: string[] }[] {
  const days = new Map<string, string[]>();
  for (const iso of [...starts].sort()) {
    const day = dayOf(new Date(iso), zone);
    days.set(day, [...(days.get(day) ?? []), iso]);
  }
  return [...days].map(([day, list]) => ({ day, starts: list }));
}
