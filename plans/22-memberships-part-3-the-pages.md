# Plan 22: Memberships, part three: the pages, and switching it on

**Status:** a plan only; nothing is built. Written 17 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 32 and from plans 20 and 21,
which this part is built on top of. Astra's first check gave "ready with changes", small enough to make while building; every point is written in below (the list is at the end).

**The rulebook is `plans/19-memberships.md`.** This plan builds its part three ("The three
parts", "Part three: the pages, and switching it on"). It states no rule of its own, and it adds
no money rule: every page calls a function that parts one and two built and checked. If building
those parts changes something this plan relies on, this plan is updated and the change checked
before part three is built.

## For the founder: what this part is

Part three is everything a person sees and presses: the host setting up her membership, inviting
people and looking after her members; a person joining, paying, booking, cancelling, pausing and
coming back; the reminder before each month ends; and the founder's pages. When it is merged, the
whole feature exists, and it is still **off**. The founder turns it on, after the points under
the rulebook's "Before this can go live".

**Two pull requests:**

1. **3a, the host's pages and the founder's.** The "Membership" part of Hosting, inviting, the
   member list, the step for a cut in hours on the calendar page, the admin page.
2. **3b, the member's pages.** The invitation and joining, paying after a failed payment, "Your
   account", an offer of less time, the reminder, and the check of the whole journey.

## What is in, and what is left out

**In:** the pages the rulebook describes under "How it works for a host" and "How it works for a
member", its list of pages under "Changes to existing code", the reminder, the list of monthly
receipts, the full admin page, and its part three "Done when".

**Built before and used here** (by the names and at the addresses in the rulebook's "How the
parts connect"): every function behind every button (plans 20 and 21), the two functions that
work out what a change would do without saving it, the emails
that report an event, the short list for the founder, the founder's switch and its form, and the
pages part two already changed (the host's page and the booking page as a member sees them, the
page after a call, the call screen, the "Members only" tick).

**Left out, by the rulebook's "Not in the first version".**

**One line added to the rulebook with this plan.** The reminder three days before a month ends
also announces a payment. The app lets people switch reminder emails off
(`notifications/reminders.ts` skips a person who did). The line added: this reminder is sent
whatever that choice is, like a receipt, because it is the notice of a charge.

## What it relies on (each read in the code by the builder)

- **How a page changes something.** A form posts to a function in an `actions.ts` beside the
  page (`"use server"`), which calls the library, and ends with `redirect(withNotice(path,
  text))` (`app/host/actions.ts:28`). The sentence travels signed in the address and is read with
  `readNotice` (`lib/notice.ts`). Pages work without any script in the browser.
- **The one place a script is needed: Stripe's card form.** For a booking the page reads the
  secret on the server and hands it to a small component (`app/bookings/[id]/page.tsx:72`,
  `card-step.tsx`), which confirms a card set-up (`confirmSetup`, `:59`) and then asks the server
  to look at Stripe itself. On the call page the same kind of component confirms a payment
  (`app/calls/[id]/pay-panel.tsx:105`, `confirmPayment`). Neither trusts what the browser says.
- **The pages that get a new part:** Hosting (`app/host/page.tsx`, parts under headings, with an
  anchor per part such as `#paid`); the calendar page (`app/host/calendar/page.tsx`, removing a
  stretch through `removeHours`, `actions.ts:53`); "People you have talked to"
  (`app/contacts/page.tsx`); "Your account" (`app/account/page.tsx`); the admin pages
  (`app/admin/page.tsx`, `admin/reports/page.tsx` with the switches form at `:239`).
- **Every page is drawn inside `SitePage`**, which gives it the site's look; a link alone on its
  line carries `inline-flex min-h-11 items-center`.
- **Reminders** are written by the helper's own loop, once each, under a key that makes a second
  write impossible (`notifications/reminders.ts:30`, `:40`).
- **The check of the whole journey** (`scripts/journey-check.ts`) signs people up, walks the
  pages for each kind of person, and reads what they show.

## Who may see what (`src/lib/membership/access.ts`)

Knowing who is logged in is not the same as being allowed: `getUser()` (`lib/session.ts:66`) says
who someone is, also when their account is paused, and `SitePage` only draws the frame. So one small server-only reader, which part one built (the rulebook's "How the parts connect")
and part two's pages already use, stands in front of every page and every action of this part, and is
called before anything is drawn or sent, also the page's title and whatever is handed to a
component in the browser:

- **An invitation:** the logged-in person it was sent to, for that host, and for exactly that
  invitation (the link carries its `invite_id`; an old link never opens a newer invitation).
- **A membership and its receipts:** that membership's member.
- **Paying, and every action about a payment:** that member, that month, and only while the
  month may still be paid.
- **The host's controls:** the logged-in host, for her own memberships.
- **The founder's page:** `requireAdmin()` (`lib/admin-gate.ts`), with everything it checks
  today, not only a look in the list of admins.

A page that is someone else's and a page that does not exist give the same answer ("not
found"). Someone who is not logged in is sent to log in and comes back to the same address,
having been shown nothing. Every action checks again; a form is never trusted because the page
that drew it was allowed. The public reader of a host's page (`publicProfile`,
`profiles/profiles.ts:203`) is not loosened: it keeps refusing a hidden page and one that is
waiting for approval, and a member or an invited person reaches a hidden host through this
reader instead.

## 3a: the host's pages and the founder's

No change to the database.

- **Hosting, "Membership"** (`app/host/page.tsx`, a new `app/host/membership.tsx` drawn into it,
  `app/host/actions.ts`): the switch, the member price, the time included, the sentence with the
  monthly amount, room ("Your weekly hours offer ... Room for ... more"), and before a change is saved the page of the rulebook's "Changing the membership": a
  second page, drawn on the server from the function in `offers.ts` that works a change out
  without saving it, with the numbers and a "Save this change" button. That button is an
  ordinary form carrying the proposed values and the short mark of what was shown; saving
  checks the mark and, if anything changed meanwhile, shows the second page again. Nothing is
  kept anywhere between the two pages, and it works without a script. (A notice in the address
  is a signed sentence, not a place to carry a proposal.) The actions call `offers.ts`.
- **The member list**, in the same part: each member with the rulebook's fields and the two
  buttons, paused members marked, an open offer of less time with "Take back", a stopped renewal
  with "Undo". The actions call `ending.ts`.
- **Inviting** (`app/contacts/page.tsx`, `app/contacts/actions.ts`): the button on each person
  the rulebook allows, an open invitation with the time it runs out and "Take back". The actions
  call `join.ts`.
- **The calendar page's step for a cut in hours** (`app/host/calendar/page.tsx`, a new
  `app/host/calendar/cut/page.tsx` at `/host/calendar/cut`, `actions.ts`): changing a stretch in one go, which needs what the page does
  not have today (it only has "Remove" and "Add", `calendar/page.tsx:63`): an "Edit" form per
  stretch with its day, start, end and the "Members only" tick, sent as one replacement and
  never as a removal first; when the change needs the host's choices, the action sends her to
  the step, drawn on the server and saved by an ordinary form with the mark of what was shown,
  as for a changed membership, which shows what the rulebook's
  "When a host later offers fewer hours" lists and saves the hours and the choices together
  through `changeWeeklyHours`. If something changed meanwhile, the step is shown again with the
  new state.
- **The admin page** (a new `app/admin/memberships/page.tsx` at `/admin/memberships`, linked from
  `app/admin/page.tsx`):
  every membership with where it stands; months not finished; payments that failed; pay-backs
  owed; months under dispute; and for each month its six places. It reads only. The switch stays
  on `admin/reports`, where part one put it.

### With the founder's switch off

Two different things, which the pages keep apart: **memberships have never been opened** (no
host has one: the "Membership" part says "Memberships are not open yet" and offers nothing), and
**selling was stopped while memberships exist**. In the second case, by the rulebook's row "The
founder's switch", months that have started go on: the host still sees her members and can still
pause and end them, a member still sees their membership, its receipts and its buttons to
cancel, and the founder's page shows everything. Only what starts something new is refused:
saving a membership as on, inviting, joining, resuming, and switching a renewal back on.

## 3b: the member's pages

No change to the database.

- **The invitation, joining and resuming** (a new `app/h/[handle]/membership/page.tsx` with
  `actions.ts`): what the rulebook's "Joining" shows, with its sentences and its tick box, read from
  `src/lib/membership/wording.ts`, which part one built and which also holds the wording's
  version, so the page and the record can never differ. It opens for an invited person (the link carries the invitation's `invite_id`) and for a
  paused member, also when the host's page is hidden. The host's own page
  (`app/h/[handle]/page.tsx`) shows an invited person a box with a link to it, as the rulebook's
  "Inviting" says. "Join" and "Resume" call `join.ts`; the
  page then shows the card form.
- **The card form** (a new `app/h/[handle]/membership/card-form.tsx`): Stripe's `Elements` and
  `PaymentElement`, like the booking's card step, with `confirmPayment` (`redirect:
  "if_required"`, and as `return_url` this same page) on the month's PaymentIntent. What makes
  the payment a hold and keeps the card (`capture_method`, `setup_future_usage`, card only) was
  set on the server when part one made the PaymentIntent; the browser sets none of it. A hold
  that went through shows as "waiting to be taken", not as "succeeded".
  - **Starting is an action; loading is only reading.** "Join", "Resume" and "Pay now" are the
    actions that may call `intentFor`. A page load never does: it reads the secret of the
    PaymentIntent the month already has, for the member only and never from a cache shared
    between people, and if there is none yet it says "one moment" and offers the button again.
    So opening or reloading the page never restarts a joining, never makes a second month and
    never moves a deadline.
  - **Two ways back, one check.** After Stripe answers in the page, and when the member comes
    back from their bank's own approval page or reloads (the script that was running may be
    gone by then, as `card-step.tsx:41` already allows for), the page asks one address,
    `app/api/memberships/[id]/sync` (a route, like the call page's `payment/sync`; the card
    components here post to routes, not to actions). It checks the member again and calls
    `syncMonth` for the month's stored PaymentIntent. Nothing in the address the bank sends the
    member back to is believed.
  - **What the member is then shown** is the month's real state: the hold is in place; the card
    was refused; the bank wants approval (the form finishes that step on the same
    PaymentIntent); still processing; or the card step ran out, in which case part one has let
    any late hold go and the page says so and never "you are a member".
  - **Two tabs** show the same month and the same PaymentIntent; the one that is behind reloads
    into the real state. The same form is
  the **"Pay now"** page for a failed payment (`app/memberships/[id]/pay/page.tsx`), reached
  from the email and from "Your account".
- **"Your account", "Memberships"** (`app/account/page.tsx`, a new
  `app/memberships/[id]/page.tsx` with `actions.ts`): the list; and for one membership the time
  left, the month's end or renewal, the monthly receipts, and the buttons of the rulebook's
  "Cancelling the membership", "Switching back on" and "A paused membership, and resuming", each
  shown only when the rulebook offers it, with the sentence about what pausing gives up before a
  cancellation is confirmed. An open offer of less time is shown here with its two buttons; the
  link in its email opens this page.
- **The reminder** (`src/lib/notifications/membership-reminders.ts`): added to the helper's
  reminder loop beside the others (`worker/closer.ts`, where each reminder job is caught on its
  own). One email per month, queued with `queueEmail` under the key `month-reminder:<month id>`,
  which the outbox already refuses to hold twice. Its words are chosen from the state at that
  moment, by the rulebook (a renewal coming, an offer of less time open, a pause coming). It
  ignores the person's choice about reminder emails but not an address that delivery has
  blocked, and it carries the footer of a receipt, not `reminderFooter` and its unsubscribe
  headers, which promise something this email cannot keep. It is written only inside a window
  before the month's end and is given an end of its own no later than that moment: delivery's
  check for stale emails does not know this key (`notifications/delivery.ts:159`), and an email
  with no end could arrive after the payment it announces.
- **What each page shows in the states that are easy to forget** (the words are the
  rulebook's; this is the list the checks go through):

  | State | Must be shown |
  | --- | --- |
  | Not paid, also when the bank wants approval | No member time; why; "Pay now"; until when. |
  | The month is only held | The time is there to book; "held, not yet taken"; the exact last moment for "Cancel now", also when the card's hold makes it earlier. |
  | An invitation that ran out, was taken back or was replaced | No "Join"; an old link says so and never opens a newer invitation. |
  | An offer of less time that was taken back, ran out or was answered | An old button says it is no longer open (the link carries the `offer_id`). |
  | The host's page is waiting for approval | The membership and its receipts as usual; no new bookings, and why. |
  | Ended, by a dispute or for another lasting reason | Why; no "Resume" or "Keep"; receipts and what was paid back. |
  | Both sides stopped the renewal | Which stop is still there; neither "Undo" promises a renewal while the other remains. |
- **The home page's list** (`app/page.tsx`) is not given notices, by the rulebook.

## The order it can safely go in

Each pull request is merged in one go; neither changes the database. Every action that could
start or renew a membership refuses while the founder's switch is off, as part one built it, so
with 3a and 3b merged a host sees "Memberships are not open yet" in the "Membership" part and
nothing else. For the checks below, the switch is turned on in the local database only.

## How each "done when" is proven

| Rulebook, part three, "done when" | Proven by |
| --- | --- |
| The whole journey passes in a browser, also at phone size, including a failed payment, a cancellation, and the founder's switch turned off while months are running | The script and the walk below. |
| Merging this part does not turn anything on | With the switch off: every page of this part opened as a host, an invited person and a member, and every action posted by hand; nothing starts. |

**A new script, `scripts/membership-journey-check.ts`**, built like `scripts/journey-check.ts`:
real sign-ups, real pages fetched and read, Stripe's test area, a local database only. Two
things it needs that the existing script does not have. **Posting a form:** today's script
sends JSON to routes and calls the library directly (`journey-check.ts:65`); this one fetches
the page, takes the form as it was drawn with the fields Next puts in it, and posts it with
that person's cookies and the site's own origin, without any build-specific id written into the
script. It also posts forms as the wrong person, forms that are out of date, and a joining
without the tick. **The card step without a browser:** it confirms the PaymentIntent the app
itself made, with one of Stripe's test cards, as `journey-check.ts:341` does for a booking's
card set-up, and then calls the app's own `sync` address; it never makes a PaymentIntent of its
own and never writes "paid" into the database. That proves the server; Stripe's form and a
bank's approval page are proven in the browser. One journey from end to end: a host sets up her membership and sees room; invites
a person she had a call with; the person opens the invitation, reads the sentences, joins with a
test card; sees the receipt; books a member-only time (part two's page); the call; the page
after it; the reminder before the month ends; the renewal; a failed renewal and "Pay now";
"Cancel", "Keep my membership", "Cancel now" in a new month; a pause and "Resume" at a changed
membership; the host lowering her price (what she is shown, and what the member pays next); the
host cutting her hours and choosing "keep", "less time" and "pause" for three members; a member
accepting less time and one saying no; the host ending a membership; the founder's page showing
each of these; the switch turned off with a month running (the month goes on, nothing renews,
nobody can join). Every page is also opened by a stranger, by another host and by another member,
who must see nothing of it.

**In a browser, the whole journey**, as host, member and founder, on a wide screen and again at
phone size: setting up; inviting; joining with a test card and with one that needs the bank's
approval; booking; a failed payment and "Pay now"; cancelling, "Keep my membership" and "Cancel
now"; pausing and resuming; a cut in hours with the three choices; and the founder's switch
turned off while one month is held and another is paid (both go on; nothing new starts). Each
state in the table above is looked at. If Stripe's test keys or the founder's second login step
are missing on the machine, the walk is not done, and it is reported as not done, not as
passed.

**The twelve existing scripts and the scripts of plans 20 and 21** pass unchanged.

Also: `npx tsc --noEmit -p .`, `npx eslint src scripts worker`, `npx vitest run`, `npm run
build`.

Then, for each of the two pull requests: Astra reviews the code, CodeRabbit reviews the pull
request. Both are written into `docs/module-record.md`, with what the checks cannot cover: a real
card, a real bank's hold on a statement, a real renewal a month later, and two real people.

## What stays off after part three

The founder's switch. Turning it on is the founder's step, after the lawyer's and Stripe's points
and the friend test of the rulebook's "Before this can go live".

## Questions for Astra's check

1. Is `confirmPayment` on a PaymentIntent with `capture_method: "manual"` and
   `setup_future_usage: "off_session"` the right call in the browser, and is reading the secret
   on the server and re-reading Stripe in an action afterwards safe against a page left open, a
   second tab, and the card step running out?
2. Do the invitation page and the member's page leak anything to someone who is not the invited
   person or the member (that a membership exists, its price, the host's hidden page)?
3. Is the cut between 3a and 3b right, and can each be merged alone with the switch off?
4. Is anything here a rule the rulebook does not have?

## Astra's first check of this plan (17 November 2026)

Verdict: **ready with changes**, small enough to make while building, with its review of the
code afterwards. It found every page assigned to a part, the plan's statements about the code
right (with two additions, taken in), and nothing over-built. Its points, all written in above:

1. **Who may see what** was promised and not specified. One reader now stands in front of every
   page and action of this part.
2. **The card form** needed its way back from a bank's approval page, and a rule that loading a
   page never starts anything.
3. **With the switch off** the plan hid the host's whole "Membership" part, against the
   rulebook: existing memberships must stay visible and manageable.
4. **The invitation on the host's page** belonged to no part; it is in 3b. A table lists the
   states a page must be able to show.
5. **The journey script** cannot post a page's form today, and the browser walk was not the
   whole journey.
6. **The two "show it, then save it" pages** now say how what was shown is carried: an ordinary
   form with a mark of the state.
7. **The reminder:** where it runs, its footer, and an end so it cannot arrive late.
