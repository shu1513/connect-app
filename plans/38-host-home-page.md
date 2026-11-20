# Plan 38: A home page for hosts

**Status:** a plan, not built. Written 19 November 2026 by the builder alone, from the code as it
is on `main` after pull request 58, from plan 36 as it stands on the branch
`module/home-page-plans`, and from what the founder said that day. Astra was asked for its own
view before any plan was written, checked a first draft (the details on the shared home page),
and checked this rewrite. All three are at the end.

**How it stands next to plan 36 ("The home page"), which another session is building now.** Plan
36 is the home page for customers. This plan is a page of its own for hosts. It does not change
plan 36's page. It reuses three of its pieces (the countdown, the grouping by day, the money
line), so it is built after plan 36 is merged, and read against that code once more first.

**Two pull requests.** First the page itself. Second, and separate, where a host lands after
logging in (decision 4), because that one touches the way everyone logs in.

## For the founder: what this is

You asked: "the host's home page would see all her upcoming schedules and customers' information
yes?" Today the answer is no. A host sees her calls in a table with the customer's name and
nothing else about them, and "Hosting" is a long page of settings.

After this change, "Hosting" in the top bar opens **her working day**:

```
 HOSTING                 Settings · Calendar · Available now
+----------------------------------------------+
| YOUR NEXT CALL                               |
| Anna Lee              Today, 3:00 PM · 30 min |
|  "I would like advice on my first video."     |
|  ID confirmed · Your member · 3 calls before, |
|  the last on 12 November                      |
|  > Your notes about Anna        (tap to open) |
|  You can enter in  12:34   [ Enter the room ] |
+----------------------------------------------+
  WAITING FOR YOUR ANSWER (2)
   Friday 6:30 PM · David Kim · 15 min · $20.00
    4.8 from 6 ratings · ID confirmed
    "Quick question about sponsors"
    > Your notes about David      (tap to open)
    Answer by Thursday 6:30 PM   [Accept] [Decline]
  YOUR BOOKED CALLS
   Today
    5:00 PM · Ben Ortiz   15 min · $20.00 held
     First call with you
   Tomorrow
    10:00 AM · Carla Diaz 30 min · member's time
     2 calls before, the last on 3 November
  Your earnings: see and collect
  Your page: connect.app/h/anna   (public)
```

The long settings page stays exactly where it is, one tap away under "Settings". Nothing new is
stored, the database does not change, and no rule about money or calls changes.

## What the founder said (19 November 2026)

- "the host's home page would see all her upcoming schedules and customers' information yes?
  what's the best homepage for hosts in your opinion? also see what astra thinks"
- To "Shall I write the plan for the small first step?": "Yes, plan it".
- "the other session is building only the customer one or both customer and hosts' ones".
  (One page for both, designed for the customer, with nothing about the customer for a host.)
- After the first draft, which put the details on that shared page: **"I think hosts should have
  different home pages than the customers don't you think?"** The builder agreed: it was the
  builder's first idea too. This rewrite is the result.

## Decisions (the builder's, except where it says the founder's)

1. **Hosts get a home page of their own (the founder's).** One account can still be both. The
   top bar keeps two doors: "Home", the customer's page of plan 36, and "Hosting", the host's
   home. A host is at work on this page; a customer is not. They need different things.

2. **Where it lives.** At a new address, `/host/home`. The settings page keeps its address,
   `/host`. About 30 places in the app, 28 lines of the check scripts and several emails point at
   `/host` for settings ("set up payouts", "your profile was approved"), and they stay right.
   "Hosting" in the top bar leads to the new page.

3. **Who gets it: anyone who has hosting to do.** That is a person whose host profile is
   approved (also while they hide it), **or** who hosts a call that is not over, **or** who has
   a request waiting. The last two matter: a host who changes her display name goes back to
   "waiting for approval", and a host who is declined or suspended can still have booked calls.
   She must still see them. Anyone else who opens the page is sent to the settings page, where
   "Getting started" is. So "Hosting" in the top bar is right for everyone, and the top bar
   needs no extra question to the database. A paused account sees the page, with the red line
   that says why, as on the other pages.

4. **A host lands on it after logging in (the second pull request).** When a person who has
   hosting to do (the same rule as decision 3) logs in and was not on their way to some other
   page, they arrive at "Hosting" instead of "Home". How: the log-in page chooses, once, a small
   address `/start` as the place to go when the person was heading nowhere in particular. That
   address checks the person like any page (so someone part-way through signing up still gets
   their next step, and a closed account gets nothing) and then sends them to "Hosting" or to
   "Home", and nowhere else. A page the person was really heading for is kept, also when that
   page is "Home". The shared "Home" never sends anyone away by itself.

5. **The order, top to bottom.**
   - **Your next call:** the countdown and "Enter the room" of plan 36, about the soonest call
     she hosts, with what she should know about the customer (decision 6).
   - **Waiting for your answer:** the requests, with Accept and Decline on the spot.
   - **Your booked calls:** every call she hosts that is not over, by day, each with the
     customer's details.
   - **Your earnings:** one link to the place where she sees and collects them.
   - **Small things:** whether she is available now, her public page's address, and a warning
     if she has no hours set.
   Only when a part has something to show. With nothing booked and nothing waiting, the page
   says so and offers her page's address to share and the way to her calendar.

6. **What she sees about the customer of a booked call.** Five things, each only when there is
   something to show:
   - **What they want to talk about:** the words the customer wrote when asking. (Calls right
     now and calls booked with membership time have no such words, so nothing is shown.)
   - **"ID confirmed"**, when the customer has passed the ID check. Never the ID or the name on
     it.
   - **"Your member"**, while the customer has a membership with her that is active: a month is
     held or running. Not for one that is only invited, paused, or unpaid.
   - **How often they have talked:** "First call with you", "1 call before, on 12 November",
     "3 calls before, the last on 12 November". The same count as "People you have talked to".
   - **Her own private note about them** (plan 32), folded: a line "Your notes about Anna" that
     opens with a tap.

7. **In a list, the private note is folded; the rest is open.** A note can hold frank words,
   can be 5,000 characters long, and creators often show their screen. Folded, it is one line.
   One tap opens it in the usual box, which scrolls. This holds for the booked calls and for the
   list of requests, on this page and on the requests page (where the note is open today). On
   the page of one call or one request, and on the "Available now" panel, it stays open as
   today. The page asks the server again every minute: a note she
   opened stays open for the same call, is closed again when the card moves on to another call,
   and disappears if it may no longer be read. Folding makes an accident less likely. It cannot
   stop a host from showing her screen, and it cannot take back what was already on it.

8. **No star rating next to a booked call.** A customer's rating helps a host decide on a
   request, and stays with the requests. Once she has accepted, it no longer helps and could
   colour the call. (Astra's point; the builder agrees.)

9. **When there is a block either way, or the customer's account is closed: no details at
   all.** Not the customer's words, not the labels, not the count, not the note. Such a call can
   still be on the list (a block cancels only calls that have not started, and a cancelling can
   fail), and it is then shown with the name, the time and the money only.

10. **A test call set up by a check script shows no details,** also when that customer has real
    calls with her.

11. **Requests are the same list as on the requests page,** drawn by the same piece of code so
    the two can never differ: grouped by time, with the rating, "ID confirmed", the customer's
    words, her note, the deadline, Accept and Decline. The home page shows the first five
    times (a time with three people asking counts as one); "See all" leads to the requests
    page. After Accept or Decline she is back on her home page with the usual message. A request
    for a call right now is in this list too, as it is on the requests page today, at the top
    because it is the soonest. The "Available now" page stays the place that shows it the
    moment it arrives; she has to have that page open to be available at all. What the list
    shows about a customer is not changed by this plan, except that the note is folded.

12. **Earnings are a link, not a sum.** "Your earnings: see and collect" leads to the part of
    the settings page where the sums and the button are. Working out the sums asks the database
    once for each contributor and each refund request, which is too much for a page that asks
    again every minute. This page never asks Stripe anything, so it never waits for Stripe.
    The reminder to rate a call stays on "Home" for the same reason.

13. **Only her own.** The page is for the logged-in person as host. Every question to the
    database is asked with her account's id as the host, on the server. No row on this page
    belongs to another role, so nothing has to be hidden from anyone. The code names each field
    it reads about a customer, one by one.

14. **Never shown:** the customer's email, the name from their ID check, anything about their
    card, other hosts' notes about them, their calls with other hosts. On booked calls also not
    their rating (decision 8).

15. **Plan 36's "Home" is left as it is.** It still lists the calls a person hosts, with the
    label "You host this call" and without details. Whether it should stop doing that for
    someone who has "Hosting" is a question for later, with both pages in use.

## What it must prove

1. A host who opens "Hosting" sees her next call, her requests and her booked calls by day.
   So does a host whose profile is hidden, waiting for approval again after a new name, declined
   or suspended, as long as she has a booked call or a request. A person with no profile and no
   hosting to do is sent to the settings page. A paused host sees the page with the red line.
2. On the card and in the list, each of the five facts appears exactly when it applies: a
   first-time customer; a returning one with a note, a confirmed ID and an active membership; a
   membership that is paused, unpaid or only invited (no label); one whose renewal is stopped
   but whose month still runs (label).
3. The count is the number the "People you have talked to" page shows. Not counted: a cancelled
   call, a call the customer never joined, a call that is still running. A call that had time
   added counts once.
4. With a block in either direction, or the customer's account closed, a call that is still on
   the list shows no details. Tried with calls that survived, not only with cancelled ones, and
   with an account closed between two refreshes. The check for several customers at once gives
   the same answer as the single check for each of them, also for a request that was abandoned
   at the card step, a test call, and the two people the other way round.
5. A test call shows no details.
6. The page of one host never holds anything of another host's: asked as a second host, and as
   the founder who is a host too. What the page sends when it refreshes is searched as well, not
   only the first page.
7. A note that was open stays open over a refresh for the same call, closes when the next call
   becomes another one, and is gone from the page after a block.
8. Accept and Decline on the home page do what they do on the requests page, and come back to
   the home page with the message, also when the answer is a refusal ("someone else was
   accepted"). A made-up return page in the form, or a message made for another page, gets
   nowhere.
9. The page asks Stripe nothing. With one booked call or thirty, it asks the database a fixed
   number of questions, not more for each call. Counted with a host who also has refund
   requests and contributions, which must not add any.
10. The settings page, and every link, email and check script that points at it, works as
    before.
11. (Second pull request.) After logging in, with a password, with the second step, or with
    Google, a person with hosting to do arrives at "Hosting"; a customer arrives at "Home"; a
    person who was heading to another page arrives there, as today; someone part-way through
    signing up gets their next step; nobody is sent in a circle.

## What it relies on (each read in the code by the builder)

- **Plan 36's pieces,** read in the other session's worktree, not merged and still able to
  change: `Countdown` (`src/components/countdown.tsx`), `notOver`, `nextCall` and `byDay`
  (`src/lib/home/rules.ts`), `paymentLine` (`src/lib/home/payment-line.ts`).
- **Hosting today:** `src/app/host/page.tsx` is the page for setting up and running the
  business (profile, social accounts, photo, payouts and earnings, membership, project, rules).
  It has no list of calls. When Stripe is set up and the host has a payout account, it waits
  for Stripe's answer (`refreshPayoutsReady`, line 72) before it shows.
- **A profile that is not approved can still have calls:** a new display name sends an approved
  profile back to "pending" (`src/lib/profiles/profiles.ts:164`), and declining or suspending
  does not cancel booked calls (same file, from line 229).
- **What points at `/host`:** counted with a search on 19 November: 31 places in `src/`, 28 in
  `scripts/` (`membership-journey-check`, `journey-check`, `accounts-check`,
  `project-journey-check`), and the emails of memberships and of the profile decision.
- **The top bar:** `src/components/site-page.tsx`. Plan 36 changes one word in it ("Your calls"
  to "Home"); this plan changes where "Hosting" leads.
- **Requests:** `waitingForHost` (`src/lib/booking/bookings.ts:869`) and the list in
  `src/app/host/requests/page.tsx`. Accept and Decline go back to one of two pages, chosen from
  a fixed list by a hidden field named `from` (`src/app/bookings/[id]/actions.ts:16`). Messages
  are signed for the page they are shown on (`src/lib/notice.ts`). The list holds requests for a
  call right now too, and shows the note open.
- **What the customer wrote:** `bookings.note` (`src/db/schema.ts:450`), found through
  `bookings.callId`. Empty for a call right now (`src/lib/booking/bookings.ts:478`) and for a
  call booked with membership time. The founder's page of reports also shows it for a reported
  call; nothing here changes that.
- **ID confirmed:** `verifiedAmong` (`src/lib/safety/identity.ts:54`), one question for many.
- **Member:** `memberships.status`; `active` means a month is held or running
  (`src/db/schema.ts:1375`). A stopped renewal is not a status.
- **Calls before:** the rule in `contactsOf` (`src/lib/people/contacts.ts:41`): both roles,
  over by its booked end, not cancelled, not made by a check script, each of the two joined.
- **The private note:** `hostNotesAbout` (`src/lib/people/contacts.ts:158`) asks the shared
  check once for each note, with up to three questions each. Shown with `AboutCustomer`.
- **Blocks and closed accounts:** a block cancels only calls that start in the future, and a
  failure is caught and counted (`src/lib/safety/blocks.ts:57`); closing an account can leave a
  call too (`src/lib/profiles/closing.ts:103`).
- **Money:** `unsentEarnings(now, hostId)` (`src/lib/payments/collect.ts:428`) never asks
  Stripe, but asks the database once for each contributor (line 446) and, through
  `requestHolds`, once for each refund request (`src/lib/refunds/requests.ts:149`).
- **Calls to rate:** `callsToRate` (`src/lib/ratings/ratings.ts:119`) looks at each call one by
  one (line 143).
- **Logging in:** the page the person was heading for is read once on the log-in page
  (`src/app/login/page.tsx:33`) and is `/` when there is none (`src/lib/safe-next.ts`). The
  forms go on to it after a password (`src/components/auth-forms.tsx:89`), give it to Google
  (line 54), and carry it through the welcome step and the email confirmation (lines 42, 102,
  190, 251). Someone already logged in who opens the log-in page is sent on to it too. A page
  for people who may use the app asks `requireUser` (`src/lib/session.ts:76`), which sends
  anyone else to their next step. `scripts/journey-check.ts:444` expects a logged-in person who
  opens `/login` to be sent to `/`.

## What gets built

No new table and no database change. Two pull requests, after plan 36 is merged.

**First pull request: the page.**

- `src/app/host/home/page.tsx` (new): the page, in the order of decision 5. It asks the server
  again every minute, like plan 36's.
- `src/lib/home/hosting.ts` (new, server only): "has hosting to do" (decision 3), used by the
  page and later by `/start`.
- `src/lib/home/briefing.ts` (new, server only): for the calls a person hosts that are not
  over, the five facts of decision 6, with decisions 9 and 10 applied. A fixed number of
  questions for all the calls together.
- `src/lib/people/contacts.ts`: the rule for "a call that counts" is written once and used by
  `contactsOf` and by a new count for several people at once. The check for the note gets a
  form that answers for several customers in a fixed number of questions, with every rule of
  the single check; `hostNotesAbout` uses it.
- `src/lib/home/rules.ts`: the words for the calls before, with tests.
- `src/components/hosted-calls.tsx` (new, runs in the browser): the booked calls by day with
  their details, and the note that opens and closes (decision 7).
- `src/app/host/requests/request-list.tsx` (new): the list of requests, moved out of the
  requests page, with the note folded, and used by both pages.
- `src/app/bookings/[id]/actions.ts`: the fixed list of pages Accept and Decline may go back to
  gets a third, the home page.
- `src/components/site-page.tsx`: "Hosting" leads to `/host/home`. The back links "← Hosting" on
  the requests, calendar and "Available now" pages too. The settings page gets the heading
  "Hosting settings" and a link back. Links that are about setting something up keep pointing
  straight at the settings page, and the one sentence that sends a host to "the Hosting page"
  for payouts (`src/app/host/now/page.tsx:44`) says "Hosting settings".
- `scripts/host-home-check.ts` (new): proofs 1 to 10.
- `docs/module-record.md`: what was built.

**Second pull request: where a host lands.**

- `src/app/start/page.tsx` (new): asks `requireUser("/start")`, then sends the person to
  `/host/home` or `/`, and nowhere else.
- `src/app/login/page.tsx`: when the person was heading nowhere in particular, the place to go
  is `/start`. Nothing else about logging in changes; `safeNext` is not touched.
- `scripts/journey-check.ts:444` and `scripts/host-home-check.ts`: proof 11.
- `docs/for-the-lawyer.md`: nothing new. A host's notes about a customer are already there
  (plan 32); this plan shows them in one more place, to the same host only.

Before any code: read the guides in `node_modules/next/dist/docs/` that apply, as `AGENTS.md`
asks.

## How it is checked

- **Automatic tests** for the words of the calls before, and for where a person is sent after
  logging in.
- **`scripts/host-home-check.ts`**, against the running app and the test database: the people
  and calls of "What it must prove". For point 6 it searches the first page and the refresh for
  the other host's note, labels and counts. For point 9 it counts the questions to the database.
- **The check scripts that read the settings page or log in,** run again
  (`accounts-check`, `journey-check`, `membership-journey-check`, `project-journey-check`), for
  point 10, and again after the second pull request. Some of them use Stripe's test mode. The
  local test database is shared with other sessions, so the scripts take turns.
- **In a browser, by hand,** on a phone-sized window: a host a few minutes before a call, a long
  note opened, through a refresh, to "Enter the room"; then Accept on a request; then log out
  and in again.
- The new page itself touches no outside service (no Stripe, no video service), so there is no
  real-money or real-service try for this plan.

**What the automatic checks cannot test:** how it reads on a real phone, and whether this is the
right page for a real host's day. Both are for the browser try and for you.

## Not built now

- **Moving the settings to another address.** See decision 2.
- **A week or month calendar of booked calls.** The list by day, as plan 36 chose.
- **Writing the note from this page.** It is written after a call and on "People you have
  talked to", as today.
- **The sums of her earnings, collecting, and the reminder to rate a call on this page.** See
  decision 12. The sums can come once they are cheap to work out.
- **Requests for a call right now on this page.** See decision 11.
- **A faster settings page.** It still waits for Stripe; a host now opens it far less often.
- **Numbers about her hosting** (calls this month, earnings over time).

## Still open, for the founder

- **A host lands on "Hosting" after logging in** (decision 4). The builder's choice. Say if you
  would rather everyone lands on "Home".
- **The order of the page** (decision 5), **the five facts** (decision 6), **the note folded**
  (decision 7) and **no rating on booked calls** (decision 8). Each is a small change after you
  have seen the page.
- **The note folded in the list of requests too** (decision 7). Today it is open there (plan
  32). Say if you want it left open.
- **Whether "Home" should stop listing the calls a person hosts** (decision 15).

## Astra's own view, before any plan (19 November 2026)

Asked the founder's question with the files to read, and not told what the builder thought.

**Taken:** there is no page that gives a host her calls with anything useful about the customer;
show the calls before and the date of the last; keep the rating for the moment of deciding on a
request; never the email or the ID name, which are both stored; keep the rules about blocks and
closed accounts; do not let the page wait for Stripe or load every call a person ever had; a
request with a deadline belongs near the top.

**Not taken:** Astra advised one page for both roles, improved in place, as the small first
step. The first draft followed that. The founder then asked for a page of the host's own, and
the builder agrees with the founder: the two roles come to do different things.

## Astra's check of the first draft (19 November 2026)

The first draft put the details on plan 36's shared page. Verdict: "ready with changes", seven
points. The builder read the code behind each. What still applies to this rewrite was taken:

- **A block does not always cancel the call, and neither does closing an account,** so the plan
  must say what is shown for a call that survives. Taken: no details at all (decision 9), tried
  with surviving calls (proof 4).
- **"Your member" needs an exact meaning.** Taken: `active` only, said in those words, with the
  stopped renewal tried (decision 6, proof 2).
- **Do not promise "four questions".** The check for the note asks up to three for each note.
  Taken: a form of that check for several customers at once, and the promise is "a fixed
  number" (proof 9).
- **One shared rule for "calls before" is sound if it stays exact:** both roles, over by its
  booked end, a call with added time counted once. Taken (proof 3).
- **The customer's words are missing for calls right now and for member calls; a test call must
  be left out by where its booking came from; and the plan was wrong to say those words are
  shown on two pages only** (the founder's reports show them too). All taken (decisions 6 and
  10, and "What it relies on").
- **An opened note is not sure to stay open over a refresh,** and a note must go when it may no
  longer be read. Taken: the page keeps "open" for a call itself (decision 7, proof 7).
- **A label saying "you host this" is how a row looks, not who may see what.** On a page of the
  host's own this cannot go wrong in the same way, since no row belongs to another role. What
  was kept: ask on the server with the host's own id, name every field, and search the refresh
  too (decision 13, proof 6).

## Astra's check of this rewrite (19 November 2026)

Verdict: "ready with changes", seven points. The builder read the code behind each.

**Taken:**

- **The sums of the earnings and the calls to rate are not cheap:** each asks the database once
  per contributor, refund request or call. Taken as Astra advised: a link to the earnings, and
  the reminder to rate stays on "Home" (decision 12).
- **An approved profile is not the same as having hosting to do.** A renamed, declined or
  suspended host can still have booked calls. Taken: decision 3 now asks about the calls and
  the requests too.
- **Landing after logging in: sound, but say the whole journey and ship it separately.** Taken:
  a second pull request, the place chosen once on the log-in page, `requireUser` on `/start`,
  a real destination always kept, "Home" never sending anyone away (decision 4, proof 11).
- **The check for several customers must keep every condition of the single one.** Taken
  (proof 4).
- **The hidden field is named `from`; show five times, not five requests; say what happens to
  requests for a call right now and to the note in that list.** Taken (decisions 7 and 11).
- **The settings page is more than settings, and it waits for Stripe only when there is a
  payout account.** Taken: said as it is under "What it relies on".
- **More to prove:** paused, hidden and pending hosts; a refusal on Accept; a made-up return
  page; counting with refunds and contributions; and "no outside service" is true of the new
  page, not of the older check scripts. Taken.

**Not taken:**

- Changing what the list of requests shows about a customer whose account was closed a moment
  ago. That list is as it is today (apart from the folded note); closing an account ends its
  waiting requests, and the private note already goes through its own check. Out of this plan.
