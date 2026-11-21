/**
 * A host's page and the search for the phone app
 * (plans/45-phone-apps/05-search-and-a-hosts-page.md): what the website's pages show, minus
 * projects, from the very same gathering (src/lib/profiles/host-page.ts, src/lib/profiles/search.ts).
 *
 * The answers are built field by field, never by handing over whole records: the host's account
 * id, which the website's page keeps on the server, never travels; nor does anything of a
 * project, a diary or a contribution, which is not read at all.
 */
import "server-only";
import { NOW } from "@/lib/booking/now-rules";
import { REPORT_WORDS } from "@/lib/safety/report-words";
import { lengthWords } from "@/lib/booking/rules";
import { timeWords } from "@/lib/membership/rules";
import { formatMoney } from "@/lib/payments/access";

import { gatherHostPage, hostProfileFor } from "@/lib/profiles/host-page";
import { ASK_WORDS, askTitle, callWords, lengthChoice, membershipStateWords, notTakingWords, priceWords } from "@/lib/profiles/host-page-words";
import { languageNames } from "@/lib/profiles/languages";
import { sellerLine } from "@/lib/profiles/profiles";
import { searchHosts } from "@/lib/profiles/search";
import { SEARCH, searchTerms } from "@/lib/profiles/search-rules";
import type { AppHostPage, AppSearch, AppSwitches } from "./types";

/**
 * For how long the app may go on saying "available now" without asking again. A host is available
 * only while her own screen keeps saying so every few seconds; a page read a while ago knows nothing
 * of now. The app asks again well within this, and takes the words away when it could not.
 */
const NOW_FRESH_SECONDS = 90;

/** The website's own address, as the emails write it: a shared link leads to a host's page on the web. */
function site(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** The search, as the website's page does it: open to anyone; a pair with a block in either direction never find each other. */
export async function searchFor(viewer: { id: string } | null, q: unknown): Promise<AppSearch> {
  const typed = typeof q === "string" ? q.slice(0, 200) : "";
  const searched = searchTerms(typed) !== null;
  const results = searched ? await searchHosts(typed, viewer?.id ?? null, new Date()) : [];
  return {
    typed,
    searched,
    hint: typed !== "" && !searched ? `Type at least ${SEARCH.min} letters or numbers.` : searched && results.length === 0 ? "Nobody found. Check the spelling, or try their handle or social media name." : null,
    hosts: results.map((host) => ({
      handle: host.handle,
      name: host.displayName,
      about: host.about,
      price: host.pricePer15Cents === 0 ? "Free calls" : `${formatMoney(host.pricePer15Cents)} per 15 minutes`,
      languages: languageNames(host.languages),
      socials: host.socials.map((social) => ({ label: social.label, name: social.name })),
      rating: host.rating ? { average: host.rating.average, count: host.rating.count } : null,
      photoId: host.photoId,
    })),
    more: results.length === SEARCH.results ? `Showing the ${SEARCH.results} best matches. Type more to narrow it down.` : null,
  };
}

/**
 * A host's page for this viewer, or null when there is none for them (the same answer for a page
 * that does not exist and one this person may not open). `asked` carries the lengths chosen.
 */
export async function hostPageFor(viewer: { id: string } | null, handle: string, asked: { length?: unknown; mlength?: unknown }, switches: AppSwitches): Promise<AppHostPage | null> {
  // With memberships switched off for the apps, nobody is a member here: a page that only a member or an invited
  // person may open is then not opened for them either.
  const profile = await hostProfileFor(switches.memberships === "off" ? null : viewer, handle);
  if (!profile) return null;
  // Never the project: projects are not in the apps, and nothing of one is read for them.
  const page = await gatherHostPage(viewer, profile, asked, { project: false, membership: switches.memberships !== "off" });
  const { offer, memberView } = page;
  // "Available now" also follows the apps' own switch; memberships follow theirs.
  const now = switches.availableNow ? page.now : null;
  const memberships = switches.memberships !== "off";
  const member = memberships ? memberView : null;
  // Where the apps may not take a monthly payment ("use only"), a month whose money is only held cannot be booked
  // from: the first booking of such a month takes the payment. Its times are then not offered here.
  const memberCanBook = Boolean(member) && (switches.memberships === "on" || member!.month.status !== "held");
  const closed = notTakingWords(profile.displayName, offer, page.chosen);
  const state = memberships && page.own && (page.own.status === "joining" || page.own.status === "unpaid" || page.own.status === "paused") ? page.own.status : null;
  // An invitation leads to joining, which takes a monthly payment: only where the apps may take one.
  const invitedUntil = switches.memberships === "on" && page.invitedUntil ? page.invitedUntil.toISOString() : null;
  return {
    handle: profile.handle,
    name: profile.displayName,
    about: profile.about,
    photoId: profile.photoId,
    languages: page.languages,
    rating: page.rating ? { average: page.rating.average, count: page.rating.count } : null,
    socials: profile.socials.map((social) => ({ label: social.label, name: social.name, url: social.url })),
    own: viewer?.id === profile.userId,
    // As on the website's page: anyone signed in can report a page that is not their own. Only a page anyone may
    // open: a report about a page is looked up as such a page, so for a hidden page the link would lead to a
    // form that cannot be sent.
    report: viewer && viewer.id !== profile.userId && profile.openToAll ? REPORT_WORDS.reportPage : null,
    shareUrl: profile.openToAll ? `${site()}/h/${profile.handle}` : null,
    follow: page.follow,
    price: priceWords(profile.pricePer15Cents),
    seller: await sellerLine(profile.userId, profile.displayName),
    callWords: callWords(profile.freeCancelMinutes),
    verifiedOnly: Boolean(offer?.verifiedOnly),
    confirmId: page.offerIdCheck,
    now: now ? { lengths: now.lengths.map((minutes) => ({ minutes, words: lengthChoice(minutes, now.offer.pricePer15Cents) })), answerMinutes: NOW.answerMinutes, paid: now.offer.pricePer15Cents > 0, freshSeconds: NOW_FRESH_SECONDS } : null,
    ask: {
      title: askTitle(Boolean(member), Boolean(now)),
      titleNotNow: askTitle(Boolean(member), false),
      closed,
      words: closed ? null : ASK_WORDS.notReserved(profile.displayName),
      lengths: !closed && offer ? offer.lengths.map((minutes) => ({ minutes, words: lengthChoice(minutes, offer.pricePer15Cents) })) : [],
      chosen: closed ? null : page.chosen,
      starts: closed ? [] : page.starts.map((start) => start.toISOString()),
      noTimes: !closed && page.starts.length === 0 ? ASK_WORDS.noTimes : null,
    },
    membership:
      invitedUntil || state || member
        ? {
            invitedUntil,
            state: state ? { status: state, words: membershipStateWords(state) } : null,
            member: member
              ? {
                  left: `${timeWords(member.minutesLeft)} left`,
                  until: member.monthEndsAt.toISOString(),
                  price: `${formatMoney(member.month.pricePer15Cents)} per 15 minutes`,
                  held:
                    member.month.status !== "held"
                      ? null
                      : memberCanBook
                        ? `This month's ${formatMoney(member.month.totalCents)} is only held on your card so far. It is taken when you make your first booking of the month.`
                        : `This month's ${formatMoney(member.month.totalCents)} is only held on your card so far.`,
                  tooLittle: memberCanBook && !page.memberChosen,
                  canBook: memberCanBook,
                  lengths: memberCanBook ? member.lengths.map((minutes) => ({ minutes, words: lengthWords(minutes) })) : [],
                  chosen: memberCanBook ? page.memberChosen : null,
                  times: memberCanBook ? page.memberTimes.map((time) => ({ startsAt: time.startsAt.toISOString(), membersOnly: time.membersOnly })) : [],
                }
              : null,
          }
        : null,
  };
}
