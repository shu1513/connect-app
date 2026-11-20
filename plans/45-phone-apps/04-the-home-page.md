# Phone apps, part 04: the home page

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).

## For the founder: what this is

The first screen after signing in. It is the website's home page (plans 36, 37, 38, 41, 42 and
43) on a phone: the next call with its countdown, the calendar, requests, calls to rate, the
hosts a person follows, and suggested hosts. One page for everyone; a host sees more on it.

**Left out, on your word:** the diary posts of followed hosts and every other trace of
projects. Tips do not appear here either.

## What is there today (read in the code)

`src/app/page.tsx` (519 lines). Signed out, it is the front page; signed in, it puts together:

- the customer's requests and the host's waiting requests (`requestsOfCustomer`,
  `waitingForHost`), the next call (`nextCall`, `notOver`), calls still to rate (`callsToRate`);
- the calendar (plan 43): the calls that touch nine days either side of the day in view (at
  most 500, the nearest first), **plus** the soonest three for the next-call card, merged, so
  up to 503; requests as a start, an end and a count (`asksByTime`); a switch between Calendar
  and List; tapping a call opens its details; a host's total for the days in view; a notice
  when the list was cut short;
- what a host may see about a customer of a booked call (`customerDetailsFor`), what she
  earned (`currentSplit` then `earnedFrom`, `unsettled`), the payment line (`paymentLine`,
  `paymentsByCall`), photos by their ID (`photosOf`);
- the hosts a person follows (`followedHosts`; it also carries the diary choice, `tellPosts`)
  and their diary news (`diaryNews`, `picturesOf`): the news is the part left out;
- suggested hosts (plans 37, 41): read by `todaysSuggestions`; **made** by a separate step
  after the page has loaded (`makeSuggestionsAction`); "seen" is recorded when half a card is
  visible (`markSeenAction`), "opened" when it is touched, and one can be hidden;
- the paused notice; a line of shortcuts; the page refreshes itself every minute.

The laying-out rules for the calendar are plain files that load anywhere
(`src/lib/home/calendar.ts` and `rules.ts` import nothing a phone lacks). `scripts/home-check.ts`
checks the page by what it puts on the screen, so the reading can move as long as that stays.

The session that built the page left nine rules for a phone version. They are binding here:

1. What a host sees about a customer **of a booked call** is decided on the server only, by
   `customerDetailsFor`, and only for calls she hosts that are not over. (A waiting request is
   not a call; its rules are part 07's.)
2. Never sent, even hidden: a customer's email, the name from an ID check, card details,
   another host's note. Nothing is sent rather than an empty field.
3. What a host earned comes from `earnedFrom` only, with finished calls she hosted; a call she
   booked shows what she was charged.
4. A request on the calendar is a start, an end and a count; who asked stays in the list.
5. The host's private note is folded in lists.
6. No star rating beside a booked call.
7. The server does not know the phone's time zone: it sends the calls around the day asked
   for and the phone lays them out in its own zone.
8. Not every coming call is loaded: the soonest three, and the calls around the day in view.
9. The home page never opens a room; it leads to the call's own page.

## Decisions (the builder's)

1. **One address, `GET /api/app/home?day=…`,** answers with what the website's page shows,
   minus projects. The putting-together moves out of `page.tsx` into one shared function that
   both call; the website's page, its guest front page and its diary are unchanged, and
   `home-check` must pass untouched. **The answer is built field by field,** never by handing
   over whole rows: in particular the followed hosts go out without the diary choice.
2. **Reading does not make suggestions.** As on the website, the app asks for today's
   suggestions to be made in a separate step after the page is up. Four small addresses, on the
   same functions: make, seen, opened, hide. "Seen" is sent when half a card is on the screen.
3. **The calendar** shows three days at a time (the website already does in a narrow window),
   with arrows, "today", the switch to a list, a call's details on touch, the host's total and
   the cut-short notice. The app reads the website's own layout files; nothing is copied.
4. **Photos, here for the first time.** A photo is asked for by its ID through an address
   under the door that uses the website's own "may this person see this photo?" (`photoFor`).
   It answers a guest too (an approved, visible host's photo is open to anyone), uses the
   signed-in person where there is one, and never gives the founder's wider view. Same
   answers as the website: "not found" for anything not allowed; an open photo may be kept on
   that person's phone for five minutes and nowhere in between; every other photo and every
   refusal is never kept; initials when there is none. Signing in as someone else on the same
   phone must not show the first person's photos.
5. **Pull down to refresh,** a refresh when the app comes back to the front, and every minute
   while it is open at the front.
6. **Requests a host must answer** are listed with their countdown. The row leads to the
   request's own screen, and Accept and Decline appear, when part 07 has built them; until
   then the row is shown without a way further.
7. The shortcuts are the website's (there is no project shortcut on it today).

## How it is tried

- `home-check` and `suggestions-check` unchanged and green.
- The new check script asks `home` as a customer, as a host and as someone who is both, and
  looks for each of the nine rules by name; no diary field anywhere in the answer, the diary
  choice included; a photo asked for by someone who may not see it; photos after switching
  accounts.
- App tests: the calendar's layout for a call across midnight and for a phone in another time
  zone than the server.
- On the Android test phone, with pictures: each of the three kinds of person; an empty home
  page; a request counting down; moving the calendar; the list; hiding a suggestion; paused.

## Keeping the 4.9%

The page shows prices and earnings but sells nothing. No diary, no contribution, no tip, and
no word pointing to the website for any of them. The one hidden carrier Astra found, the
diary choice inside the followed hosts, is cut by decision 1.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *Making suggestions was missing* (reading alone never makes them). Decision 2.
2. *The calendar's controls, the host's total, the paused notice, the followed hosts and the
   minute refresh were not named.* "What is there today" and decisions 3 and 5.
3. *The diary choice travels inside the followed hosts.* Decision 1.
4. *Rule 1 is about booked calls only;* a waiting request is not a call. Rule 1, and part 07.
5. *"At most 500" is really up to 503.* "What is there today".
6. *The photo loader is first needed here, not in part 05.* Decision 4.
