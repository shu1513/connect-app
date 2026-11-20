# Plan 43: A calendar on the home page

**Status:** a plan, not built. Written 20 November 2026 by the builder alone, from the code as it
is on `main` after pull request 69 (plan 38, the home page as a host sees it), and from what the
founder said that day. Astra checked it once ("ready with changes"); what was taken is at the
end. The founder has seen a picture of it and has not yet said "build it".

**Two pull requests.** First the calendar itself: the grid, the arrows, tapping a call, what a
finished call earned, and the list of the same days. Second: requests on the calendar, the
total for the days in view, and the line for "now".

## For the founder: what this is

Today the home page lists the calls that are coming, by day. You asked for a calendar that looks
like the calendars people know, and sent a picture: the days of a week across the top, the hours
down the side, a block for every call, and "‹ Today ›" to move between weeks.

After this change "Your next calls" becomes **"Your calendar"**:

```
 Your calendar                      [ Calendar | List ]
 November 2026                         ‹   Today   ›
 This week: 6 calls hosted · earned $212.40 so far
        Sun 15   Mon 16   Tue 17   Wed 18   Thu 19   Fri 20   Sat 21
  9 AM
 10 AM           ┌──────┐
                 │ Ben  │                   ──────── now
 11 AM           └──────┘          ┌──────┐
                          ░░░░░░   │ Emma │          ┌╌╌╌╌╌╌┐
 12 PM                    ░Anna░   └──────┘          ╎2 asks╎
                          ░░░░░░                     └╌╌╌╌╌╌┘
  ■ You host   ■ You booked   ░ Finished   ╌ Asked for, not answered

 Tap a call:  Tue 17, 11:30 AM · Anna Lee · 30 minutes · finished
              You host this call · You earned $38.00            Open
```

- **One calendar for everything she has to turn up for:** the calls she hosts and the calls she
  booked with other hosts, in different colours.
- **Finished calls stay on it,** greyed, and each says what she earned (or, for a call she
  booked, what she paid). The week shows a total.
- **Requests she has not answered** are on it too, with a dashed edge, so a time that people
  are asking for never looks free.
- **On a phone** the same calendar shows three days at a time, because seven columns do not fit
  on a small screen. The arrows then move three days.
- **A switch, "Calendar | List",** gives the list by day as it is today, for anyone who prefers
  reading down a list.

Nothing new is stored, the database does not change, and no rule about money or calls changes.

## What the founder said (20 November 2026)

- After seeing a picture of the plan: "maybe on the calendar itself we show how much money
  earned from completed calls. as in each completed call square inside of the calendar shows
  the dollar earned for that call." (Decision 8.)
- "so the homepage calendar shows the week's schedule (also maybe there is a monthly view or
  next button for next week) where you see your calls that you booked, the calls someone booked
  to call you (you as a host) and the complete calls (and how much you earned in those calls).
  what do you think?"
- After the builder suggested a list of days for phones: "shouldn't the calendar looks like
  something like this? an actual calendar look that people are used to", with a picture of a
  week in a calendar app.

## Decisions (the builder's, except where it says the founder's)

1. **A real week calendar (the founder's).** Days across, hours down, a block per call placed at
   its time, with its length as its height. "‹" and "›" move a week; "Today" comes back.

2. **Both kinds of calls and the finished ones, with earnings (the founder's).** Three looks,
   and a line under the calendar that names them, so nobody has to guess a colour: calls she
   hosts, calls she booked, finished calls. A cancelled call is not on the calendar; it is on
   "Past calls".

3. **Three days at a time on a narrow screen.** Today and the two days after it; the arrows move
   three days. On a screen wide enough for seven readable columns, the whole week. The calendar
   decides by its own width, not by the kind of device.

4. **No month view now.** On a phone a month can only show dots, and "›" already gets to any
   week. Easy to add later.

5. **Only the hours that matter are drawn.** From 9 in the morning to 6 in the evening,
   stretched when a call in view is earlier or later. Not all 24 hours. (First planned as 8 to
   8; in the browser that was taller than a phone's screen with nothing in it.)

6. **Short calls stay readable.** Calls can be 5 minutes long. An hour is drawn tall enough that
   a 15-minute call has room for a time and a name, and no block is drawn smaller than one line.
   A block that small is a small thing to tap; the list has full-size rows for every call.

7. **Tapping a call shows it under the calendar,** in the row the list uses: the time, the
   name, the length, the money, and "Open", which leads to the call, or to its results when it
   is finished. For a call she hosts that is not over, the row has the customer's details of
   plan 38, decided by the same server code. A finished call has no such details: "3 calls
   before" would count the finished call itself. Which call is chosen is remembered by the
   call's id only; what is shown comes fresh from the server each time, so details that may no
   longer be shown disappear at the next refresh.

8. **What a finished call says about money (the amount in the block is the founder's).** The
   block of a finished call she hosted shows what it earned, right on the calendar: "10:30 Ben ·
   $38.00". Where a block is too small for both, the amount stays and the name is shortened;
   tapping shows everything. A call she booked shows no amount in its block; what she paid is
   there when she taps it. In words, under the calendar, a call she hosted says: "You earned
   $38.00". That is
   her share of what was charged for that call, added time included, after Connect's fee and
   before the 25 cents taken when she collects. A refund that has gone through lowers it; a
   call refunded in full says $0.00. While part of the call's money is not settled yet (held,
   not paid, waiting for a review), it says "so far" and keeps today's words for that part.
   With nothing charged yet it says only today's words ("$40.00 held", "Free"): never a guess.
   A call paid from a member's month counts with the share written down for it. A call ended
   with a report shows that its money waits for a decision. A call she booked says what she
   was charged, as today. It is not "ready to collect": that depends on what she has collected
   already, and stays on the earnings page.

9. **The total over the days in view** (second pull request): "6 calls hosted · earned $212.40
   so far". The calls she hosted that took place in those days, each counted once. Not a
   cancelled call, also not one cancelled late and charged; the line says "from calls that
   took place".

10. **Requests on the calendar.** A time people have asked her for shows one dashed block,
    "1 request" or "3 requests", which leads to the requests. A request she sent to another host
    is not on the calendar; it is under "Your requests", as today.

11. **A line for "now"** across today's column.

12. **Times are the viewer's own,** as everywhere on the home page: the calendar is laid out in
    the browser, in its time zone. Which day a week starts on follows the browser's language
    where the browser can say (Sunday in the United States, Monday in most of Europe), and is
    Sunday otherwise. A call that runs past midnight is drawn in both days and counted once. On
    the two days a year the clocks change, a call sits at the time its clock shows.

13. **Which days are shown is in the page's address** (`/?day=2026-11-23`), so the arrows are
    links, the back button works, and the page's own refresh every minute stays where she is.
    The server cannot know her time zone, the first day of her week, or how wide her screen is.
    So for the day in the address it sends every call that touches the eight days before and
    after it, and the browser picks the three or seven days it shows. Until the browser has
    said what its zone and width are, the list is shown, as "Your next calls" does today.

14. **"Calendar | List".** The list shows the same days as the calendar, by day, in the rows
    of today's list. The calendar is shown first. The choice lasts while the page is open.

17. **Calls that would sit on top of each other are put side by side.** Two short calls a few
    minutes apart are each drawn at least one line tall, and then share the width of the day.

18. **Only what is shown is sent.** The calendar runs in the browser, so it is handed, for each
    call, the words and numbers it draws and nothing else: never a payment's or a request's
    whole record. What a host earned is worked out on the server and sent only with the calls
    she hosts.

15. **For someone with no call in view** the calendar is still drawn, empty, with the arrows:
    it is how she gets to the week that has one. Someone with no calls at all, past or coming,
    and no requests, gets no calendar, as she gets no list today.

16. **It reads without colour and without a mouse.** Every block is a button that says in words
    what it is ("Tuesday 11:30 AM, 30 minutes, Anna Lee, you host, finished"). The list is the
    plain way to read the same calls.

## What it must prove

1. A call is drawn on its own day at its own time in the viewer's time zone, also a call close
   to midnight and on the day the clocks change. A call that runs past midnight is drawn in both
   days.
2. Hosted, booked and finished calls each have their look and their words; a cancelled call is
   not there.
3. A finished hosted call says what she earned, worked out from each of its charges exactly as
   the earnings page works out the share of one charge: with time added, with a refund in part
   and in full, paid from a member's month, with part still held ("so far"), with nothing
   charged (no figure), and ended with a report. It does not change when she collects. A
   finished call she booked says what she was charged.
4. The total counts exactly the hosted calls in the days in view.
5. "›", "‹" and "Today" move as they should on a wide and on a narrow screen, and the address
   keeps the week through the minute's refresh. A made-up day in the address is read as today.
6. Requests for one time show as one dashed block with the right number.
7. Tapping a hosted call that is not over shows the customer's details exactly as plan 38
   allows them, and nothing for a finished call, a call she booked, a test call, or across a
   block. After a block, the details of a call that was chosen are gone at the next refresh.
   A customer never gets a host's earnings: the whole page as sent is searched, for a person
   who is host of one call and customer of another too.
8. Nobody's calendar holds a call they are not part of.
9. A week with a hundred short calls is still readable, nothing is left out without saying
   so, and the page still answers quickly.
10. Two calls a few minutes apart do not cover each other. Every call can be reached and opened
    with the keyboard alone. Turning a phone, or making the window narrower, keeps the day she
    was looking at.

## What it relies on (to be read against the code again before building)

- **The home page** (`src/app/page.tsx`) loads only the calls that are not over. The calendar
  needs the calls of the days in view, also the finished ones: one more question, by time.
- **The row and the details:** `ListedCall`, `CallsByDay` and `CustomerDetailsLines`
  (plans 36 and 38); `customerDetailsFor` decides on the server what a host is shown. The row
  is written inside `CallsByDay` today, says nothing about a finished call and always links to
  the call: it becomes a piece of its own that both views use.
- **The calls before** (`talkedBefore`) count every call that is over, so beside a finished call
  they would count that call too (decision 7).
- **Days in the viewer's zone:** `dayOf`, `dayAfter` and `byDay` in `src/lib/home/rules.ts`,
  used in the browser as `CallsByDay` does.
- **A host's share of a call:** `currentSplit` in `src/lib/payments/actions.ts`, per payment
  with the status "charged"; a call has its own payment and one for each time more time was
  added (`paymentsByCall`). A free call has no payment. A member's call has its share written
  on its payment (`src/lib/membership/calls.ts`). The earnings page shows only shares she has
  not collected yet, and takes the collection charge off (`src/lib/payments/collect.ts`).
- **The money line:** `paymentLine` (`src/lib/home/payment-line.ts`).
- **Requests waiting:** `waitingForHost`, already loaded by the home page.
- **Past calls:** `/calls` keeps the full list of the calls that are over, newest first, 50 to
  a page.
- **A page's address:** a page reads `searchParams` by awaiting it, and `router.refresh()` keeps
  what the browser parts remember (`node_modules/next/dist/docs/`, the guides on `page` and
  `useRouter`).

## What gets built

No new table and no database change. Two pull requests.

**First: the calendar.**

- `src/lib/home/calendar.ts` (new, plain logic with tests): the days in view for a day and a
  number of columns; where a call sits in a day, also across midnight; calls side by side; the
  hours to draw; which day a week starts on; reading the day from the address.
- `src/lib/home/earned.ts` (new, plain logic with tests): what a hosted call earned, from its
  payments (decision 8).
- `src/components/call-row.tsx`: the row, moved out of `CallsByDay`, which can now say that a
  call is finished and what it earned, and link to its results.
- `src/components/calls-calendar.tsx` (new, runs in the browser): the grid, the arrows, the
  blocks as buttons, the chosen call under the grid, the switch to the list.
- `src/app/page.tsx`: reads the day from the address; loads the calls that touch the eight days
  before and after it, not cancelled, of this person only; their payments; the details for the
  hosted ones that are not over. Hands the calendar only what it draws. The card of the next
  call keeps its own question, as today.

**Second:** requests on the calendar (one number for each time asked for, nothing else about
them), the total, and the line for "now".

**Both:**
- `scripts/home-check.ts`: what the server sends: the right calls for a week, earnings, no
  cancelled calls, nobody else's calls, the details only where plan 38 allows.
- `docs/module-record.md`: what was built.

## How it is checked

- **Automatic tests** of the plain rules: days in view, positions, midnight, the day the clocks
  change, the week's first day, a bad day in the address.
- **`scripts/home-check.ts`** for what the server hands to the page.
- **In a browser, by hand,** wide and phone-sized: a week with hosted, booked, finished calls
  and requests; the arrows; tapping calls; the total; the list.
- No outside service is touched.

**What the automatic checks cannot test:** how the calendar looks and feels. That is for the
browser try and for you.

## Not built now

- **A month view** (decision 4).
- **Her open hours shaded on the calendar,** and changing hours from it. Hours stay on "Your
  calendar" under Hosting.
- **Dragging a call to another time.** A call's time is fixed when it is booked.
- **"Add to my calendar"** (Apple, Google) for a call.
- **Cancelled calls on the calendar.**

## Still open, for the founder

- **Three days on a phone** (decision 3) and **no month view** (decision 4): say if you see it
  differently.
- **Requests on the calendar** (decision 10): the builder's addition.
- **The week's first day follows the browser's language** (decision 12). Say if it should
  always be Sunday, as in your picture.

## Astra's check of this plan (20 November 2026)

Verdict: "ready with changes". The builder read the code behind the points on money and on the
row before taking them.

**Taken:**

- **Money.** The sum of the host's share over a call's charged payments is right, with added
  time and member calls. But it is before the collection charge, and the earnings page shows
  only what she has not collected yet, so the two can rightly differ: the proof now compares
  how one charge is worked out, not two totals. "So far" while part is unsettled, no figure
  when nothing is charged, a call ended with a report, and what the total leaves out
  (decisions 8 and 9, proof 3).
- **Only what is drawn is sent** to the part that runs in the browser: never whole payments or
  requests (decision 18).
- **A day in the address does not tell the server the week or the width.** The server now sends
  every call that touches eight days either side; the list is shown until the browser knows its
  zone and width (decision 13). Calls across midnight, and the days the clocks change
  (decision 12).
- **What is chosen is kept by its id only,** so details that may no longer be shown do not
  linger after a refresh (decision 7, proof 7).
- **The row is not a piece of its own today,** and "calls before" beside a finished call would
  count that call (decision 7, "What it relies on").
- **Short calls close together would cover each other** (decision 17, proof 10).
- **"The list unchanged" and "the same calls" did not agree.** The list now shows the same days
  as the calendar (decision 14).
- **Two pull requests** (the status above).

**Not taken:**

- Telling the server the browser's zone and width after the page has loaded, so it can send
  exactly the days in view. Sending eight days either side is simpler and is a few dozen calls
  at most.
- An index on the calls table by time. The question stays "this person's calls", which has an
  index, narrowed by time; it can be added when a host has thousands of calls.
