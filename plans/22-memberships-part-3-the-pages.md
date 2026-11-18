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
- **Starting or confirming a payment, and being given its secret:** that member, that month,
  and only while the month may still be paid.
- **Seeing or refreshing a payment's outcome** (the `sync` address, and the page after it):
  that member, for that month, always, also after the payment step has closed. Otherwise a
  member coming back from their bank after the helper finished the payment would be refused
  the very result they came back for.
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
  monthly amount, room, worked out by part one's `room.ts` ("Your weekly hours offer ... Room for ... more"), and before a change is saved the page of the rulebook's "Changing the membership": a
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

The switch has three positions (the rulebook's row "The founder's switch"): off, on for the
hosts the founder names, and on for everyone. Every page and action asks part one's one
question, "are memberships on for this host?", so a host who is not named sees and can do
exactly what she could with the switch off. Two different things, which the pages keep apart: **memberships have never been opened** (no
host has one: the "Membership" part says "Memberships are not open yet" and offers nothing), and
**selling was stopped while memberships exist**. In the second case, by the rulebook's row "The
founder's switch", months that have started go on: the host still sees her members and can still
pause and end them, a member still sees their membership, its receipts and its buttons to
cancel, and the founder's page shows everything. Only what starts something new is refused:
switching a membership on, inviting, joining, resuming, and switching a renewal back on. Editing
a membership that is already on stays possible where the rulebook allows it, such as lowering
the member price, and so does switching it off.

## 3b: the member's pages

No change to the database.

- **The invitation, joining and resuming** (a new `app/h/[handle]/membership/page.tsx` with
  `actions.ts`): what the rulebook's "Joining" shows, with its sentences and its tick box, read from
  `src/lib/membership/wording.ts`, which part one built and which also holds the wording's
  version, so the page and the record can never differ. It opens for an invited person (the link carries the invitation's `invite_id`) and for a
  paused member, also when the host's page is hidden. The host's own page
  (`app/h/[handle]/page.tsx`) shows an invited person a box with a link to it, as the rulebook's
  "Inviting" says. "Join" and "Resume" call `join.ts`, each form carrying a request id made when the page
  was drawn (part one's `request_id`), so a double press joins once; the page then shows the
  card form.
- **The card form** (a new `app/h/[handle]/membership/card-form.tsx`): Stripe's `Elements` and
  `PaymentElement`, like the booking's card step, with `confirmPayment` (`redirect:
  "if_required"`, and as `return_url` this same page) on the month's PaymentIntent. What makes
  the payment a hold and keeps the card (`capture_method`, `setup_future_usage`, card only) was
  set on the server when part one made the PaymentIntent; the browser sets none of it. A hold
  that went through shows as "waiting to be taken", not as "succeeded".
  - **Starting is an action; loading is only reading.** "Join" and "Resume" (through `join.ts`) and "Pay now" (through part one's `payNow`)
    are the only actions that may call `intentFor`. A page load never does: it reads the secret of the
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
  check for stale emails does not know this key (`notifications/delivery.ts:159`), and an email with no end could arrive after the payment it announces. For the
  same reason this key is added to that check: when the email is about to be sent, the
  membership is looked at once more, and a reminder written for a renewal is dropped if the
  renewal was stopped, or the membership paused or ended, in the meantime (the member has been told that by its own email). In
  the code that is a branch of its own in `noLongerWanted`, placed before the place where it
  gives up on a key it does not know, and it does not look at the person's choice about
  reminder emails. "A renewal is coming" includes the founder's switch covering that host.
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

The founder's switch. Turning it on is the founder's step, in two stages, by the rulebook's
"Before this can go live": first for the friend test, for the one host who takes part, and for
everyone only after the lawyer's and Stripe's points and that test.

(Changed after the build, on 18 November 2026: the founder decided that memberships are on for
every host from day one. See the rulebook, "The founder's decision after the build".)

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

## Built in 3a: where the code differs from this plan

- **The host's actions** are in a file of their own, `app/host/membership-actions.ts`, not in
  `app/host/actions.ts`. The page that shows a change before it is saved is at `/host/membership`
  and reads the proposed values from its address; saving posts them back with the mark.
- **"Who may be invited"** is one question asked once for the whole contacts page:
  `invitingFor(hostId)` in `membership/access.ts` (may this host invite at all, and her
  memberships by customer).
- **The step for a cut in hours** is shown whenever a cut would touch someone: members who no
  longer fit, and also invitations that would be taken back while every member still fits (the
  invited people are named). A host without members or invitations never sees it. The step is
  only ever about a stretch of the signed-in host's own hours; anything else in its address
  shows a refusal and no form.
- **With the founder's switch off** and memberships existing, the part says "Memberships are not
  open at the moment" above the member list, and no member row promises a renewal.
- **A member whose payment is still open** has "Pause now" instead of "Pause after this month":
  pausing cancels that payment and pauses them at once, and the sentence afterwards says so.
- **The founder's page** reads every membership, with no cut-off, so that its counts are whole.
  It will need pages once there are thousands.
- **The check "nothing can start a membership"** of part one became three checks in
  `scripts/membership-check.ts`: only the host's own pages reach the code that changes a
  membership; each of her seven actions asks who is signed in; and nothing in the app can join,
  resume, pay or cancel as a member yet (that is 3b).
- **The whole journey in a browser and its script** come with 3b, as planned. For 3a the pages
  were looked at in the running app as the test host and the test founder, also at phone width,
  with the switch on for the test host and again with it off.

## Astra's reviews of the code of 3a (18 November 2026)

Three rounds: not ready, not ready, ready. Every point was checked against the code before it
was taken; all were.

**First round (eight points):**
1. The step for a cut in hours looked the removed stretch up by its id alone, so an address with
   another host's id showed that host's day and times. It is now looked up as the signed-in
   host's own, and anything else shows a refusal and no form.
2. The step's save did not keep the calendar's rule for "Members only".
3. A cut that took invitations back while every member still fit was saved without being shown
   first; and the step only gave a count. It is now shown, with the names.
4. The rewritten check counted an older action of the contacts page (saving a note) and could
   never pass. It now looks at the seven membership actions.
5. The founder's page read only the 300 memberships changed last, so its counts could miss an
   old one with money still open.
6. A member's row said "renews then" also when the founder's switch was off or an offer of less
   time was unanswered.
7. Pausing a member whose payment was still open said they would be paused at the month's end
   and that it could be undone; they are paused at once.
8. A dispute that was won still counted under "Months under dispute".

**Second round (three points):**
1. The step's save answered "saved" when the hours had been changed in another tab meanwhile and
   the change was no cut any more: the library returned before it looked at the mark or the
   choices. Choices sent for a change that does not make the week shorter are now refused inside
   the step (`changeWeeklyHours`), and the page refuses to show choices for such a change.
2. "Pause now" was only shown for a failed payment, not while a renewal is being taken. It now
   follows the month ("still to be paid"), as the library does.
3. A stretch's id was checked only for its length and letters; it is now checked in full before
   it reaches the database.

## CodeRabbit's review of 3a (pull request 39, 18 November 2026)

Three comments, all small and all taken:

1. **A cut worked out as touching nobody could still take an invitation back** if hours were
   removed in another tab in the same moment: the save without choices took invitations back
   without looking. The calendar page now saves such a cut with the mark of what it just worked
   out and every member kept, so a change in between saves nothing and she looks again.
2. **"Pause after this month" on the step for a cut** was also shown for a member whose payment is
   still open, who is paused at once. The step now judges by the month (`openPayment` in
   `room.ts`, as saving does) and says "Pause now".
3. **A pause that was saved could be reported as "nothing was changed"** if reading the result
   afterwards failed. The read is now apart from the save.

## Built in 3b: where the code differs from this plan

- **The card step reads through a function of its own.** `secretToPay` (`membership/charge.ts`)
  is what a page load calls: it reads the secret of the payment the month already has, for its
  member, while the month can still be paid and the payment is ready to be paid by hand. It makes
  nothing and changes nothing. Only the actions ("Join", "Resume", "Continue to the card step",
  "Pay now") call `payNow`, which is the one way to `intentFor`.
- **"Pay now" is two steps on one page:** the button (an action) makes the payment ready, and the
  page then shows the card form for that same payment. Opening the page from the email starts
  nothing.
- **A page with no card form to show** (the payment is not waiting for a card) asks the `sync`
  address once and offers "Check again", so a hold the app has not heard of yet is found.
- **An old invitation link** is answered by `oldInvitationFor` in `access.ts`: for the person it
  was sent to it says the invitation is no longer open and why (ran out, taken back, replaced by
  a newer one, already used); for anyone else it is "not found". It never opens a newer
  invitation.
- **The host's own page** shows an invited person a box with the link, and a member at the card
  step, with a failed payment or paused a line and a link to the right page.
- **The reminder's kind is read back from its subject.** When its turn to be sent comes,
  `membershipReminderProblem` works out what the reminder would say now and drops it if that is
  no longer what was written (a renewal that was stopped, an offer that was answered, a pause
  that was taken back), or if the membership is paused, ended or in a later month.
- **The page and the receipt name one moment** for a held amount: the last moment "Cancel now"
  is offered. (The money is taken three minutes later; a member is not shown two times.)
- **The check "nothing can start a membership"** is now four checks in
  `scripts/membership-check.ts`: only the host's and the member's own pages reach the code that
  changes a membership or pays for one; each of the host's seven and the member's eight actions
  asks who is signed in; and no page that is only being opened can start a joining, a payment or
  a change.
- **The journey script** (`scripts/membership-journey-check.ts`, about 100 checks) posts every
  form as the page drew it. What it pretends is in its header: the welcome step, the host's
  approval and payout account, that two people had a call, and the waiting (a month's end, a
  renewal and the reminder run with a later clock).
- **Walked in a browser** at phone width and wide, as the test customer with the test host: the
  invitation, joining with Stripe's test card, the member's page, "Cancel now", resuming with a
  card that needs the bank's approval (failed once, then completed), a card step that ran out,
  "Your account" and the host's page. Not walked by hand: a failed renewal with "Pay now" and the
  cut in hours with three members, which the journey script covers through the real pages.

## Astra's reviews of the code of 3b (18 November 2026)

Every point was checked against the code before it was taken.

**First round (not ready, eight points, all taken):**
1. **A payment whose way back arrives after a deadline** could be told "you are not a member,
   nothing was charged", or get "not found", although a hold placed in time still counts and the
   helper would start the membership a moment later. The card step after its time, and "Pay now"
   after the time to pay, now ask the bank first and claim nothing before that. A first-time
   joiner still reaches the card step's page then, through `ownMembershipByHandle`.
2. **No way to cancel while a renewal is being taken**, or in the moment between a month's end
   and the next one. The page keeps a cancel button there.
3. **"Keep my membership" could say "your membership goes on"** when reading the result failed
   or another stop remained. It says so only when that was read.
4. **A reminder could go out with an amount that had changed** (the host lowered her price, or
   another offer replaced the one it named). The sentence a reminder is about is looked for
   again when it is sent.
5. **An open offer came before the founder's switch** in the reminder's words and on the page.
6. **The reminder's subject said "in 3 days"** also when written late.
7. **An offer's link kept silent** after the month had ended and before the helper tidied up.
8. **Three checks of the journey script proved less than they said.**

**Second round (not ready, five points, all taken):**
1. **The cancel button for a payment that is still open promised "nothing is charged"** although
   the payment can go through in the moment before the press. Its words now say both outcomes.
2. **The way a first-time joiner still reaches a card step that ran out** also showed the live
   card form when the host's page was closed to them for another reason (a declined profile).
   While the host's page is closed to a person, only the "time is over, we are checking" view is
   shown. (The automated security check on the commit found the same.)
3. **An old "Keep my membership" form** from another tab could still be answered with "your
   membership goes on" after the founder's switch went off. The answer now says what was done
   and leaves the renewal to the page.
4. **A host who changed her name** would have lost her member the reminder: its kind was read
   from the whole subject. It is now read from the subject's fixed ending.
5. **One new check of the journey script** said more than it proved.

**Third round (not ready, one point, taken):** the cancel button in the moment between a month's
end and the next one still promised that no new month would start, although the helper can start
it in the moment before the press. It says both outcomes now, like the other two.

**Fourth round (not ready, one point, taken):** the sentence after "Cancel" still offered "Keep
my membership", which can be closed by then (the founder's switch off, or the month over). It now
says only that the membership will not renew, and the page shows what is open.

**Fifth round: ready.** No finding left about money moving wrongly or about anyone seeing another
person's data.

## CodeRabbit's review of 3b (pull request 40, 18 November 2026)

Eighteen comments, all marked minor. Seventeen were taken, each in its smallest form:

- **The pages.** The invitation's open times are worked out as a member would find them (hours
  for members only were missing). A month whose payment has a problem the founder must look at
  is shown as that, not as an ordinary hold with time to book. "Keep my membership" is replaced
  by a sentence when it cannot work (the host's membership or the founder's switch is off). The
  card step and "Pay now" still open, and say so, when the payment service cannot be reached.
  A given-up month's receipt no longer says "no payment in 7 days" when the member or the host
  cancelled its open payment.
- **The buttons.** "Cancel now" and "Pay now" carry the month the page showed; if another month
  is the current one by the time of the press, nothing is done. The sentence after "Cancel now"
  says the hold "is being let go" (the helper finishes it if Stripe cannot be reached), and the
  one after "Cancel" no longer says a payment was cancelled when none was open.
- **The card form** stays usable when the connection drops while it asks the server.
- **The reminder** says the time left "as this is written", and names the one exception to
  "expires and is not paid back": time that came back because the host cancelled a call.
- **The checks.** The page-load check also refuses `syncMonth` in a page, and the one address
  that asks Stripe may only answer a post. The journey script refuses to start unless the
  founder's switch is off, proves that opening "Pay now" writes nothing and makes no payment at
  Stripe, checks the exact destination after paying, and names a test payment it could not
  cancel while cleaning up.

Not taken: clearing only this script's own rate-limit rows. The script clears the whole table, on
a local test database only, as the older journey and accounts scripts do; every request comes
from one network address, so the rows cannot be told apart.

