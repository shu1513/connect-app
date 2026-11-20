# Phone apps, part 04: the home page

**Status:** built, 20 November 2026 (see `docs/module-record.md`). Written that day by the
builder alone. Part of plan 45. Astra checked the plan once ("ready with changes"; the list is at
the end) and the code (the list is before it). What the building changed or added is under "What the building changed"; where that
list and a decision differ, the list is what was built.

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

## What the building changed (20 November 2026)

1. **The putting-together now lives in `src/lib/home/gather.ts`,** and the website's page and
   the app's address both call it. The website's page asks for the diary news; the app's
   address never does, and then nothing of a diary is read at all. The page's own sentences
   that both show (how a request stands, what the card says when no call is coming, "Why these
   hosts?") moved to one place each, so the two cannot come to differ.
2. **No account's number leaves the server.** A followed host goes out as a name, a page, "is
   available" and a photo; a suggested host by her page's name and her place in the row. The
   plan did not say; the website's page does not show them either.
3. **Requests a host must answer** (decision 6) go out as: when, how long, the price, the name,
   and the time to answer by. The rating, "ID confirmed", what the person wrote and the host's
   own note about them are on the request's own screen, which is part 07's.
4. **Rows do not lead anywhere yet.** The call's own page (parts 08 and 09), a request's
   screen (07), a host's page (05), rating a call (10), "see all" of the followed hosts and the
   people talked to (17) and the hosting shortcuts (11, 15, 16) are each wired in by the part
   that builds the screen. Until then the home page shows them and stops there. Decision 6
   said this of requests; it holds for all of them.
5. **Photos** (decision 4) are asked for through the app's one way of asking the server, never
   by the phone's own picture loader, which keeps pictures on the phone by its own rules. A
   photo anyone may see is kept in the app's memory for five minutes; every other photo lives
   only on the screen that asked for it. Nothing is written to the phone's storage: the
   server's answer always says "do not store", and says in a header of its own how long the
   app may keep an open photo in memory. (Decision 4 said the phone may keep an open photo
   "for five minutes"; said the usual way, the phone's own keeping of web answers would have
   stored it on the phone.) What is kept belongs to one sign-in and is dropped the moment
   who is signed in changes. As on the website, someone with "18 and terms" still to do is a
   guest to the photos.
6. **"Available now"** beside a followed or suggested host also follows the apps' own switch
   (part 01): with it off, nobody is shown as available in the apps.
7. **The app reads the website's calendar files as they are** (decision 3). For that the app's
   bundler and its tests are told where those two folders are (`mobile/metro.config.js`).
8. **Every page can now be pulled down to ask again,** and knows when it has come to rest (a
   suggested host counts as seen when the middle of its card is on the screen then).
9. **If the server says today's suggestions are not made, the app asks for them** each time it
   reads the page, not once per opening of the app. Once made, the server says so, so it is
   still once a day.

## Astra's check of the code (20 November 2026): "not ready", now worked in

It found the website's page unchanged by the move, and nothing private in the home answer. Four
points it called "must", and seven smaller ones; all taken but the last, which is the plan's.

1. *A host who has to accept the terms again was still handed a customer's photo* (the website
   treats her as a guest until she has). Point 5 above.
2. *A photo kept for one person could be shown to the next person on the same phone* after its
   owner had hidden her page; and the phone's own keeping of web answers could have stored it.
   Point 5.
3. *When the server refused (the sign-in ran out, the terms to accept again), the old home page
   stayed on the screen.* It is taken off at once now, for all three of the page's requests.
4. *Moving the calendar to days not loaded yet showed "No calls in these days"* until the answer
   came, and for good if it did not. The calendar now shows the days the server answered for,
   and says "Loading other days…" meanwhile.
5. *A host's private note opened for one customer stayed open when another customer's call took
   its place.* Each call has its own.
6. *The countdown counted the time since the last answer twice for a moment after each new
   answer,* which could ask the server too early. And a call ended early with a report could be
   sent as both "open" and "finished"; it is never "open" once finished.
7. *A photo that was refused could leave the picture before it on the screen.* Each photo id
   has a piece of its own.
8. *The check of the home answer did not look inside its lists,* so a missing part there broke
   the screen instead of showing an error.
9. *"Seen" was measured against the whole screen, tab bar included, and was lost if the request
   failed.* It is measured against the page's own window, and told again if it could not be
   passed on. Hiding a host answers plainly when it fails.
10. *Three checks proved less than their labels said* (another person's suggestion lines, the
    words about the money, two requests "at the same time"). Rewritten.
11. *Small calendar blocks are hard to hit; the shortcuts line is not shown.* Left: the list
    beside the calendar has full-size rows, and the shortcuts come with the parts that build
    the screens they lead to (point 4 above).

## Astra's second look at the code (20 November 2026): "not ready", now worked in

The ten fixes were found sound. Three further points it called "must", and four smaller ones; all
taken.

1. *One person signing in right after another on the same phone could, in one order of events,
   leave the first person's home page standing for a moment.* Every screen now belongs to the
   person signed in, and all of them are made anew when that person changes.
2. *A photo already on the screen was never asked for again,* so it could stay for hours after
   its owner hid her page. A photo on a page that keeps asking the server now asks again too,
   at most every five minutes, and is taken away on a "no".
3. *"Seen" and "hide" skipped what a refusal does on this page.* One piece of code now decides
   that for every request of the page: the page is emptied and the opening question asked.
4. *A "seen" that could not be sent was tried again at once, and again,* with no connection.
   It is tried again the next time the page comes to rest. What waits to be sent belongs to its
   day.
5. *On an iPhone the page runs on behind the bar at the bottom,* so a card behind it could
   count as seen. That strip is left out. (To be looked at on a real iPhone in part 20.)
6. *The check of the answer took any text for the calendar's day.* It must be a real day.
7. *"Loading other days…" was shown, or not shown, at the wrong moments.* It is shown exactly
   while a question is under way for days other than the ones on the screen.

## Astra's check of the plan (20 November 2026): "ready with changes", worked in

1. *Making suggestions was missing* (reading alone never makes them). Decision 2.
2. *The calendar's controls, the host's total, the paused notice, the followed hosts and the
   minute refresh were not named.* "What is there today" and decisions 3 and 5.
3. *The diary choice travels inside the followed hosts.* Decision 1.
4. *Rule 1 is about booked calls only;* a waiting request is not a call. Rule 1, and part 07.
5. *"At most 500" is really up to 503.* "What is there today".
6. *The photo loader is first needed here, not in part 05.* Decision 4.
