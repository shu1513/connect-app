# Plan: Module 9 — Verified customers only

**Status: built, 14 November 2026 (pull request open). Astra checked the plan (verdict: build with changes; 10 findings, all taken in below) and then the code. The founder decided both questions as recommended: the company pays for the check, and the switch is off for a new host. What was found and decided is in `docs/module-record.md`.**

The founder's brief (14 November 2026): "a person can verify himself with his ID. hosts can choose
to only accept calls from customers who have verified his identity."

## What exists already (module 5)

- An ID check on Stripe's own pages (Stripe Identity): a photo of an ID and a selfie that must
  match it. We learn "real person, 18 or older" and the name on the ID. We never see or keep the
  photos, the date of birth or the ID number. Each person gets 3 tries.
- Hosts must pass it before their profile can be approved.
- Customers must pass it before a **free** call. For a **paid** call there is no ID check today:
  the card and the "I am 18 or older" statement stand in for it.
- The page `/identity` is already open to anyone who is signed in, but nothing invites a paying
  customer to use it, and nothing shows a host whether a customer has passed.

So the check itself is built. What is missing is small: a switch for hosts, a way for a paying
customer to reach the check and come back, and a mark hosts can see.

## What this module must prove

1. A host can switch on "Only people who have confirmed their ID can ask me for a call", and
   switch it off again.
2. With the switch on, a customer who has not passed the ID check cannot send that host a **new**
   request, by any route: a booked call, an "available now" call, or by finishing the card step of
   a request started earlier. Requests already waiting stay (the host sees who has the mark).
3. Such a customer is told plainly what to do, can do the check, and lands back where they were.
4. Any customer can do the check by choice, without a reason, from their account page.
5. A host sees an "ID confirmed" mark next to each customer who has passed, wherever they answer
   requests, whether their switch is on or off.
6. A host never sees the ID, the photos, or the name on the ID. Only the mark.
7. Nothing changes for hosts who leave the switch off, for free calls, or for calls already
   booked. Every earlier check still passes.

## Decisions for the founder

1. **Who pays for a customer's ID check.** Stripe charges about $1.50 per check (the figure in the
   safety plan; to be confirmed on Stripe's price page before launch).
   **Recommended: the company pays**, as it already does for hosts and for free calls. Each account
   gets 3 tries, so one account normally costs $1.50 and at most about $4.50. Asking customers to
   pay would need a payment step of its own and would lose customers at the door.
2. **Switch on or off for a new host.**
   **Recommended: off.** Showing ID is a hurdle, and some customers will leave rather than do it. A
   host who wants the extra safety turns it on in one click. Every host still sees the mark.

## How it works

**The host's switch.** A new section on the hosting settings page, "Who can ask you for a call",
with one tick box and a Save button:

> Only people who have confirmed their ID can ask me for a call.
> We check a photo ID and a matching selfie through Stripe. You see only that the check was passed,
> never the ID or the name on it. Fewer people may ask you for calls. Requests already waiting
> stay; you can decline them.

The switch is saved while holding the host's calendar lock, the same lock every request takes
before it reads the host's settings. So a request can never read "off" and still arrive after the
host has saved "on".

For a host whose calls are free, a note says everyone who asks already has to confirm their ID.

**What the customer sees.**

- On the host's public page, when the switch is on: "This host only takes calls from people who
  have confirmed their ID." A signed-in customer who has not passed also gets a "Confirm yours"
  link.
- On the two booking pages (a booked call and a call now): the "One thing first" screen that free
  calls already use, shown when the call is free **or** the host's switch is on and the customer
  has not passed. The wording says which reason applies. These two pages first check for a block
  between the two people (they do not today), so a blocked customer sees "no longer open" and is
  never invited to do an ID check that could not help them.
- The link to the check carries the address of the page the customer was on. After Stripe sends
  them back and the check is passed, the identity page shows "Continue to your booking". (The time
  they picked is checked again there, as always; for a call now it may have gone.) That address is
  checked at every step with the existing `safeNext` (only a path on this site), is dropped if it
  is longer than 500 characters, and is kept through a failed start and a "still checking" result.
  A customer who comes back logged out (the login ran out, or the check was finished on another
  device) logs in and is brought back to the same step, with the address still attached.
- On the account page: a new line "Your ID: confirmed" or "Your ID: not confirmed. Confirm who you
  are", so anyone can do it by choice.
- **Telling people what a host sees.** People who passed the check earlier (hosts, customers of
  free calls) did so before this mark existed. So the sentence "Hosts you ask for a call can see
  that your ID is confirmed. They never see your ID or the name on it." appears on the identity
  page for everyone (passed or not), on the account page next to the line above, and on both
  booking forms for a customer who has passed.
- The identity page's words also change to say who needs the check (hosts, free calls, hosts who
  ask for it).

**The rule itself** lives in one place: the check that every request already goes through before
it is sent (`checkMayAsk` in `src/lib/booking/bookings.ts`). Today it says "a free call needs a
passed ID check". It becomes "a free call, or a host with the switch on, needs a passed ID check".
That one place covers booked requests, "available now" requests and the card step.

- The message to the customer: "This host only takes calls from people who have confirmed their
  ID. Please confirm who you are on your account page." (The free-call message keeps its words; an
  earlier check script looks for them.)
- The rule looks only at the customer's own passed check. Having a host profile gives no pass: a
  host who is still waiting for approval may not have passed yet.
- While here, two small repairs in the same function: the ID lookup and the site-switch lookup
  each used a second database connection inside the request's transaction. Both now read through
  the transaction itself.
- The check comes **after** the block check, so a blocked person still sees only "that time is no
  longer open", as today.
- A check Stripe is still looking at does not count yet. A check passed by someone under 18 never
  counts (already so).

**What the host sees.** "ID confirmed" next to the customer's name on the requests page, in the
"available now" panel, and on the page of a single request. Nothing is shown for a customer who
has not passed ("not passed" covers never tried, still being checked and failed, and the host has
no need to tell them apart). One small helper answers "which of these people have passed" for a
whole list in one question to the database; only a yes or no ever reaches the browser. The mark
means exactly what the rule means: a passed check by an adult.

**One exception, on purpose.** The admin's test-call page makes a booked call directly, without a
request. It stays as it is; only an admin can use it, and it goes away in the final clean-up.

## Edge cases, decided

| Case | What happens |
| --- | --- |
| The host turns the switch on while requests are waiting | They stay. The host sees who has the mark and declines the others if they wish. Nothing is declined automatically. |
| The host turns the switch on while a customer is typing their card | When the card step finishes, the request ends with the reason shown to the customer (it tells them to confirm their ID and ask again). The card is removed by the helper a little later, as for any request that ends at that step. Nothing reached the host. |
| Calls already accepted | Not touched. |
| Adding time during a call | Not touched. |
| The customer has used all 3 tries | They cannot ask this host. The identity page says to write to us, as today. |
| The host turns the switch off | Everyone can ask again at once. |
| The customer passed the check for a free call months ago | They count as confirmed. A check is done once. |
| The host is the one sending a request to another host | They are a customer there, and have already passed (hosts must). |

## What changes in the code

1. **Database** (migration 0020): one new field on a host's settings, `verified_only`, off by
   default. No other change. A host with no settings row yet counts as "off".
2. **`offerOf`** carries the switch (`verifiedOnly`), so every place that reads a host's offer
   knows it.
3. **`checkMayAsk`**: the one-line rule above, written in place (no separate rule function), and
   the two lookups moved onto the transaction. `identityState` gets an optional reader for that.
4. **`src/lib/safety/identity.ts`**: `verifiedAmong(userIds)` for the mark; the Stripe return
   address, built from the app's configured address, carries the safe "where to go next".
5. **Pages**: hosting settings (the switch; saved under the calendar lock), the host's public page
   (one line), the two booking pages (block check, the screen's condition and wording, the "what
   a host sees" sentence), identity and its return page ("next", the sentence), account page,
   requests page and single-request page (the mark), and the "available now" panel (the mark; the
   yes or no is added to what `liveForHost` in `src/lib/booking/now.ts` sends it).
6. **Tests**: a new journey script `scripts/verified-check.ts` (below); the README and the module
   record.

## How it will be checked

- **Journey script** against the real database, with real requests:
  - switch on, customer not confirmed: refused for a booked call, for a call now, and at the end
    of the card step; the refusal names the reason;
  - switch on, customer confirmed: goes through, and the host's list shows the mark;
  - switch off: a paying customer who is not confirmed goes through, as today;
  - a free host: unchanged, with the switch on or off;
  - a blocked customer still gets the "no longer open" answer, not the ID message;
  - the switch turned on with a request waiting: the request stays and can be accepted;
  - the switch turned on during the card step: the request ends with the reason and keeps the
    card's reference so the helper removes it;
  - a host with no settings row counts as "off";
  - the "where to go next" address: a path on this site is kept, another site's address and an
    overlong one are dropped;
  - "passed but under 18" and "Stripe still checking" do not count, and get no mark;
  - only the host can change their own switch.
- **Every earlier script** still passes (booking, now, extend, ratings, notifications, safety,
  accounts, payments), plus the automatic tests, lint, types and build.
- **In a browser**: the host flips the switch; the public page shows the line; a customer who is
  not confirmed is stopped with the right words; a confirmed one gets through and the host sees
  the mark. The real Stripe check with Stripe's test documents, including coming back to the
  booking, once the key below exists.

## What only the founder can do

- **A Stripe key for reading ID results** (`STRIPE_IDENTITY_KEY`, a "restricted key" in Stripe's
  test area with permission to read sensitive verification results). It has been missing since
  module 5; without it nobody can pass the real check on this computer. The automatic checks do
  not need it; the browser test of the real check does.
- Before launch: Stripe's written yes to using its ID check for this business (already on the
  list), and a line in the privacy policy that a host can see whether a customer's ID is confirmed.

## Not in this module

- Customers paying for their own check.
- A "confirmed" filter in search, or a public badge on a customer.
- Checks that expire and must be done again.
- A daily limit on how many checks the whole site can start, and making the 3-tries limit exact
  when two checks are started in the same instant (guards against someone running up the bill with
  many fake accounts; today the guards are a confirmed email and 3 tries each). This module adds no
  new way in, only more ordinary use. Worth doing before launch.
- A check when the host accepts, or when time is added to a call. Astra agreed neither is needed.
- Showing the host the name on the ID.
