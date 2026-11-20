# Plan 36: The home page

**Status:** built, 19 November 2026 (pull request 61; see `docs/module-record.md`). Written
19 November 2026 by the builder alone (no helper agents), from the code as it is on `main` after
pull request 58, and from what the founder said that day.
Part two, the suggested hosts, is `plans/37-suggested-hosts.md`. Astra checked both plans once
("ready with changes"); every point was read against the code by the builder and is worked in
below (the list is at the end).

## For the founder: what this is

Today the page a person lands on after logging in is a list titled "Your calls": a small "Talk
now" box, a table of calls, and a short text list of new diary posts. Everything you asked for is
partly there, but it reads like a record, not like a home.

After this change the page is a home screen, from top to bottom:

1. **Your next call, with a countdown** to the moment you can enter the room. When the room
   opens, the countdown becomes a large "Enter the room" button.
2. **Waiting for you** (only when there is something): a call to rate, a request to answer.
3. **Your next calls**, soonest first, grouped by day: "Today", "Tomorrow", "Friday 27 November".
4. **Hosts you follow**, the ones who are available now first, each with a green dot and
   "Call now".
5. **News from your hosts**: their newest diary posts, with the first picture.
6. **Suggested hosts** (plan 37).

Calls that are over move to a page of their own, "Past calls".

```
+--------------------------------------------+
| YOUR NEXT CALL                             |
| (photo) Anna Lee         Today, 3:00 PM    |
|         30 minutes                         |
|  You can enter in  12:34                   |
|  [ Enter the room ]   <- when it is open   |
+--------------------------------------------+
  Waiting for you: Rate your call with Ben
  YOUR NEXT CALLS
   Today      3:00 PM  Anna Lee     30 min
   Friday     6:30 PM  David Kim    15 min
  HOSTS YOU FOLLOW
   (o) Emma  Available now - Call now
   ( ) Ben   ( ) Carla              See all
  NEWS FROM YOUR HOSTS
   Emma in "My first album", 2 hours ago
   [picture]  First lines of the post ...
  SUGGESTED HOSTS            (plan 37)
```

No money moves differently, no rule about who may enter a room changes, and the database does
not change. It is the same information, arranged for a customer, plus the countdown.

## What the founder said (19 November 2026)

"I am thinking for the home page for the customer, what should the customer see? probably all the
upcoming bookings that he has with different hosts. maybe the status of his followed hosts if
they are online, the countdown of the room that he can enter for the next call with the host, also
probably the new things the hosts have done in their gofundme equivalent projects (the ones in our
app) as the newsfeed like on facebook. also possibly some hosts suggestions".

And, about the order: "I think the countdown should be the first thing. then your next calls,
with all your hosts, soonest first. not sure if it should look like a calendar in a week."

## Decisions (the builder's; the founder can change any of them)

1. **One home page for everyone who is logged in.** A person can be a customer and a host with
   the same account, so the page keeps what a host needs (the calls they host, "requests waiting
   for your answer"). It is designed for the customer first.
2. **The order** is the list above. "Waiting for you" stands between the countdown and the next
   calls, because those few lines need an action and appear only when there is one. Say if you
   want them lower.
3. **The countdown.**
   - It is about the soonest call that is not over, whichever role the person has in it. "Not
     over" means, here and everywhere on this page: the person is its host or its customer, it
     is not cancelled, it was not ended with a report, and its booked end has not passed.
   - A room opens 5 minutes before the booked start (that rule exists and does not change). The
     countdown runs to that moment, and a line says so: "The room opens 5 minutes before the
     start."
   - Two days or more away it says "in 3 days"; between one and two days "in 1 day 4 hours";
     under a day "in 5 hours 12 minutes"; in the last hour it shows minutes and seconds and
     moves every second.
   - When it reaches zero the card says "Checking…" and the page asks the server again. Only
     when the server says the room is open does the card show "The room is open" and the button
     "Enter the room". While the room is open the card also says how long until the booked
     start, or how long ago the booked start was (it does not claim that anyone has joined).
   - It follows the server's clock, not the phone's. The server sends its own time with the
     page; the browser only counts the seconds that pass from there, with a counter that does
     not jump when the device's clock is changed. Each time the page asks the server again
     (every minute, and when the person comes back to the tab) it is set right again. On a slow
     connection it can run behind by the time the page took to arrive; it does not run ahead,
     and the server has the last word.
   - The button is only a link to the call's page. **That page alone decides who may enter**, as
     today. The home page never opens a room. If the call is not paid yet, the call's page asks
     for the payment first, so the button then reads "Open the call" and the money line beside
     it says "not paid yet".
   - When the booked end of that call passes, the page asks the server again and the card moves
     on to the next call.
   - With no call coming up, the card says so and offers the search box.
4. **Your next calls: a list grouped by day, not a week calendar.** Most customers will have one
   to three calls coming. A week grid would be mostly empty boxes and is hard to read on a phone.
   Days are named in the person's own time zone, as their browser knows it. Each line shows the
   time, the other person's photo and name, the length, the money line exactly as today ("$20.00
   held"), and a link to the call. A call the person hosts carries a small label, "You host this
   call". With a single call coming the list is left out: that call is already in the card
   above. The person's own requests that are not calls yet stay a short list of their own
   under it, as today.
5. **Hosts you follow.** At most eight on the home page, in the order the "Following" page
   already uses (available now first), with "See all" leading to that page. A host who is
   available shows a green dot and "Call now". The page asks the server again every minute while
   it is in front. Today it does so only for someone who follows a host, has a call coming, or
   has just finished one; from now on for everyone who is logged in, because the page no longer
   loads the calls that are over and so cannot tell who has just finished one. (That is what
   lets a new follow and the reminder to rate appear without a reload.)
6. **News from your hosts.** The newest diary posts of the hosts the person follows: at most
   **ten, from the last 30 days** (today: five, from the last seven days, which leaves the feed
   empty most of the time). Each shows the host's photo and name, the project's name, when it was
   written, the first 280 characters, and the post's **first picture**, if it has one that
   everyone may see. Only hosts the person follows; never a post from a stranger. Who may read
   what does not change: a post the host removed or the founder hid is never there, and each
   picture is fetched from its own address, which decides afresh each time.
7. **Past calls move to their own page**, `/calls`, with the table as it is today (start, with,
   role, status, payment, links), the newest first, 50 to a page. The home page links to it.
   Today the home page loads every call a person ever had; from now on it loads only the calls
   that are not over (decision 3), and `/calls` holds exactly the others: the person's calls
   that are cancelled, were ended with a report, or whose booked end has passed. Neither page
   ever shows a call the person is not part of.
8. **The link in the top bar** changes from "Your calls" to "Home".
9. **Someone new**, with no calls and nobody followed, sees a welcome line, the search box and
   the suggested hosts.
10. **The look** is the site's warm look (the cards of the search page), one column, built for a
    phone first. The page greets the person by their first name.
11. **A paused account** sees the page as today, with the red line that says why.

## What it relies on (each read in the code by the builder)

- **The page today:** `src/app/page.tsx`. A visitor who is not logged in gets the front page
  from the same file; that part does not change.
- **When a room opens:** `roomOpensAt` and `roomState` in `src/lib/calls.ts`
  (`OPEN_EARLY_SECONDS`, 5 minutes). `roomState` looks at the times only: it does not know about
  a cancelled call or one ended with a report, so the page asks for those itself, as today's
  `stillOn` does (`src/app/page.tsx:186`). Who may enter: `canJoin`, asked by the call's own
  page, which also asks for the payment first when a call is not paid
  (`src/app/calls/[id]/page.tsx:112`).
- **The server's clock in the browser:** the call page receives the server's time when it is
  drawn and counts from the difference to the device's clock
  (`src/app/calls/[id]/call-room.tsx`, around line 196), and measures again when the person
  joins. The countdown takes the server's time the same way, but counts with the browser's
  steady counter and is set right at each refresh. `formatDuration` is in `src/lib/format.ts`.
- **Who gets a fresh page today:** `src/app/page.tsx:194` and `:244`: someone who follows a
  host, has a call coming, or finished a call in the last quarter of an hour whose follow is not
  decided yet.
- **Followed hosts and who is available:** `followedHosts` in `src/lib/follows/follows.ts`. It
  already hides availability from someone the host has blocked, and orders the list.
- **Diary news:** `diaryNews` in the same file (five posts, seven days, plan 31, decision 9).
  Pictures everyone may see: `picturesOf` in `src/lib/projects/pictures.ts`, as the diary page
  uses it (`src/app/h/[handle]/project/diary.tsx:44`); shown with `DiaryPicture`.
- **Host photos:** `photosOf` in `src/lib/profiles/photo.ts`, shown with `HostPhoto`.
- **Asking the server again:** `RefreshEvery` (`src/components/refresh-every.tsx`), every 60
  seconds (`FOLLOW.refreshSeconds`).
- **Times in the person's own zone:** `LocalTime` shows a UTC time in the browser's zone once the
  page runs there. Grouping by day is done the same way.
- **Check scripts that read the home page:**
  - `scripts/journey-check.ts:289` looks for the host's name and the words "Not open yet" for a
    call that is coming, and `:298` for "Waiting for your rating".
  - `scripts/follow-emails-check.ts`, part 9 (from line 502) asks `diaryNews` for "five at
    most" and "never older than a week", names the exact fields it returns (`:516`), and has a
    post that is eight days old, which the new 30 days would let in.
  - `scripts/accounts-check.ts:1196` reads the visitor's front page, which does not change.

## The changes

- `src/lib/home/rules.ts` (new, plain logic with tests): what the countdown says for a number of
  seconds; which call is "the next call"; how calls are grouped into days for a time zone.
- `src/components/countdown.tsx` (new, runs in the browser): shows the countdown from the
  server's time, moves every second in the last hour, shows "Checking…" at zero and asks the
  server again, and asks again when the booked end passes. It starts afresh when the next call
  becomes another one.
- `src/components/calls-by-day.tsx` (new, runs in the browser): the list grouped by day in the
  browser's time zone. Before the page runs in the browser it shows the plain list with full
  dates, so nothing is ever grouped by a wrong day.
- `src/app/page.tsx`: the home page in the new order. The front page for visitors is untouched.
  The query for calls asks only for calls that are not over, the soonest first. `RefreshEvery`
  is there for everyone who is logged in.
- `src/app/calls/page.tsx` (new): "Past calls", with the table moved from the home page as it
  is.
- `src/lib/home/payment-line.ts` (new): the money line of a call, moved out of the home page
  as it is, because both pages now show it.
- `src/lib/follows/follows.ts`: `diaryNews` gives ten posts from 30 days, and with each the
  host's id (for the photo). The two numbers go into `FOLLOW` in `rules.ts`.
- `src/components/site-page.tsx`: "Your calls" becomes "Home".
- `scripts/follow-emails-check.ts`, part 9: ten at most, checked with eleven posts where it
  writes seven today, so the limit is really reached; never older than 30 days (the old post of
  the check becomes 31 days old); the list of fields with the host's id added.
- `scripts/journey-check.ts:289`: the coming call is still found on the home page under the
  host's name; the words it looks for become the new card's ("You can enter in"). `:298` stays.
- `scripts/home-check.ts` (new): see below.
- `docs/module-record.md`: what was built.

## How it will be checked

- **Tests of the plain rules:** the countdown's words at each boundary (a day, an hour, a
  minute, zero, after zero); the next call among several, with cancelled and ended ones; days
  grouped right on both sides of midnight and on the day the clocks change.
- **`scripts/home-check.ts`**, against the running app and the test database: a customer with
  three calls sees the soonest in the card; a call whose room is open shows the button and not a
  countdown; a call that is not paid yet shows "Open the call"; a cancelled call, and one ended
  with a report, is never "the next call" and is on `/calls`; a host sees the call they host with its
  label; the list holds only calls that are not over, and `/calls` holds the rest; a followed
  host who is available shows as such, and not to a follower they have blocked; the news shows
  ten at most, never a removed or hidden post, with a picture only when everyone may see it;
  someone new sees the welcome; nobody sees another person's calls on either page.
- **A real try in the browser**, on a phone-sized window and a wide one: a call booked a few
  minutes ahead, watched until the countdown reaches zero and the button appears, then into the
  room.
- **The other check scripts** that touch the home page, run again.

**What the automatic checks cannot test:** how the page looks and feels on a real phone, and a
countdown on a device whose clock is wrong by hours. Both are for the browser try and for you.

## Not built

- A week or month calendar for customers (decision 4). Hosts keep theirs.
- "Add to my calendar" for a call.
- Sounds or notifications from the browser when a room opens. The reminder emails stay as they
  are.
- News about anything but diary posts (a new project, a goal reached).
- Posts from hosts the person does not follow.

## Still open, for the founder

- The order of the page (decision 2) and the list instead of a calendar (decision 4): both are
  the builder's choices and easy to change after you have seen the page.

## Astra's check of this plan (19 November 2026)

"Ready with changes." Each point was read against the code by the builder. The numbers are
Astra's; the points about the suggestions are in `plans/37`.

| # | What Astra found | What was done |
|---|---|---|
| 3 | "Not over" was not defined, the rule for a room looks at times only, and a call that is not paid cannot be entered. | Taken: the definition in decision 3; `/calls` holds exactly the rest; "Open the call" when it is not paid; "the booked start was" instead of "running since". |
| 6 | Loading only the calls that are not over removes what keeps the page fresh after a call, and someone new never got a fresh page. | Taken: the page asks again every minute for everyone who is logged in, and when the next call's booked end passes. |
| 9 | Copying the call page's clock would count the time the page takes to arrive as if it had not passed, and would follow a change of the device's clock. | Taken in a light form: a steady counter in the browser, set right at each refresh, "Checking…" at zero, the server has the last word. Not taken: a request of its own just to ask the time. |
| 11 | Two check scripts look for more than the plan listed. | Taken: the lines are named under "What it relies on" and "The changes". |

**Second check, the same day,** of the plan as changed: points 3 and 6 resolved. Taken: the
countdown no longer promises to be at most a second or two behind, and the check of "ten at
most" writes eleven posts.

Astra also confirmed, with nothing to change: grouping by day in the browser; one page for
someone who is both host and customer; and that a public diary post stays readable for a follower
the host has blocked, which is how it is today.

## The review of the pull request (19 November 2026)

CodeRabbit answered that its review limit was reached, so, by the founder's rule for that case,
the builder reviewed the pull request line by line himself. Found and corrected in this plan: the
sentence under the countdown ("The room opens 5 minutes before the start"), the words for one
to two days ("in 1 day 4 hours"), that the list is left out when a single call is coming, the
greeting by first name, and the file the money line moves to. Nothing was found in plan 37 or in
the lawyer's file.
