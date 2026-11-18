# Plan 22: Memberships, part three: the pages, and switching it on

**Status:** a plan only; nothing is built. Written 17 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 32 and from plans 20 and 21,
which this part is built on top of. Astra's check is at the end.

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

## 3a: the host's pages and the founder's

No change to the database.

- **Hosting, "Membership"** (`app/host/page.tsx`, a new `app/host/membership.tsx` drawn into it,
  `app/host/actions.ts`): the switch, the member price, the time included, the sentence with the
  monthly amount, room ("Your weekly hours offer ... Room for ... more"), and before a change is
  saved the page of the rulebook's "Changing the membership", shown as a second step with the
  numbers and a "Save this change" button. The actions call `offers.ts`.
- **The member list**, in the same part: each member with the rulebook's fields and the two
  buttons, paused members marked, an open offer of less time with "Take back", a stopped renewal
  with "Undo". The actions call `ending.ts`.
- **Inviting** (`app/contacts/page.tsx`, `app/contacts/actions.ts`): the button on each person
  the rulebook allows, an open invitation with the time it runs out and "Take back". The actions
  call `join.ts`.
- **The calendar page's step for a cut in hours** (`app/host/calendar/page.tsx`, a new
  `app/host/calendar/cut/page.tsx` at `/host/calendar/cut`, `actions.ts`): changing a stretch in one go; when the change
  needs the host's choices, the action sends her to the step, which shows what the rulebook's
  "When a host later offers fewer hours" lists and saves the hours and the choices together
  through `changeWeeklyHours`. If something changed meanwhile, the step is shown again with the
  new state.
- **The admin page** (a new `app/admin/memberships/page.tsx` at `/admin/memberships`, linked from
  `app/admin/page.tsx`):
  every membership with where it stands; months not finished; payments that failed; pay-backs
  owed; months under dispute; and for each month its six places. It reads only. The switch stays
  on `admin/reports`, where part one put it.

## 3b: the member's pages

No change to the database.

- **The invitation, joining and resuming** (a new `app/h/[handle]/membership/page.tsx` with
  `actions.ts`): what the rulebook's "Joining" shows, with its sentences and its tick box, read from
  `src/lib/membership/wording.ts`, which part one built and which also holds the wording's
  version, so the page and the record can never differ. It opens for an invited person and for
  a paused member also when the host's page is hidden. "Join" and "Resume" call `join.ts`; the
  page then shows the card form.
- **The card form** (a new `app/h/[handle]/membership/card-form.tsx`): like the booking's card
  step, with `confirmPayment` on the month's PaymentIntent, whose secret the page reads on the
  server through `intentFor`. After Stripe answers, the form posts to an action that calls
  `syncMonth` and sends the person on; nothing the browser says is believed. The same form is
  the **"Pay now"** page for a failed payment (`app/memberships/[id]/pay/page.tsx`), reached
  from the email and from "Your account".
- **"Your account", "Memberships"** (`app/account/page.tsx`, a new
  `app/memberships/[id]/page.tsx` with `actions.ts`): the list; and for one membership the time
  left, the month's end or renewal, the monthly receipts, and the buttons of the rulebook's
  "Cancelling the membership", "Switching back on" and "A paused membership, and resuming", each
  shown only when the rulebook offers it, with the sentence about what pausing gives up before a
  cancellation is confirmed. An open offer of less time is shown here with its two buttons; the
  link in its email opens this page.
- **The reminder** (`src/lib/notifications/membership-reminders.ts`, run by the helper's
  reminder loop): one email per month under the key `month-reminder:<month id>`, with the
  rulebook's words for each case (a renewal coming, an offer of less time open, a pause coming),
  sent whatever the person chose for reminder emails.
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
real sign-ups, real pages fetched and read, real actions posted, Stripe's test area, a local
database only. One journey from end to end: a host sets up her membership and sees room; invites
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

**By hand in a browser**, as host, member and founder, on a wide screen and at phone size: every
page of this part; the card form with a test card and with a card that needs the bank's approval;
a sentence that is too long on a phone; the look of each page against the rest of the site.

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
