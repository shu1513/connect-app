# Phone apps, part 10b: refunds after a call

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 10. It moves money back and forth, so it is
kept small and apart. Brought up to date on 27 November 2026, after the website changed (the
list is at the end).

## For the founder: what this is

A customer asks for a refund after a call; the host answers. Your rule (plan 13): the host
decides. The app does exactly what the website does, with the same words.

## What is there today (read in the code)

`src/lib/refunds/requests.ts`, `refund-request.tsx` on the results page, and the actions in
`src/app/calls/[id]/actions.ts`:

- **Asking** (`askForRefund`): one request per call, and only for a call that can have one;
  until the time the server names (`askBy`: normally 24 hours from the call's booked start,
  sooner if a card hold would run out first; the server itself allows three minutes more
  than it shows, for a press at the last second). The customer
  picks a reason, "the connection" or "something else". For the connection they are first
  shown the record of both people's connection grades (`recordVisibleTo`, `loadSummary`) and
  send along a mark of what they saw; if the record changed meanwhile, it is shown again
  before anything is sent. For "something else" a sentence is required.
- **Answering, before the money is taken** (`answerRequest`): for each payment of the call the
  host chooses what to **charge**: in full, less (up to an amount), or nothing, with an
  optional message. "In full" means charge what the call's record supports, not "refund in
  full".
- **Answering, after the money was taken:** "no refund" (`declineRequest`), or give back an
  amount (`refundAction`, `refundPayment`), while that is still possible.
- A host can also give money back on her own, without a request.
- **What the host is shown** is only the charges still open for her answer, with the deadline;
  a charge that is being taken or looked at shows "being decided"; if nothing was charged,
  that is said. For a member's call the answer gives back membership time, or its value to
  the card, as the server works out; a month under dispute can hold the settling up.
- **Only the host of that very call decides.** On the website the founder can step in with a
  full admin sign-in, which is written into the record; and only the founder can close a
  request the host never answered (`closeRequestAction`).
- A refund asked of Stripe twice counts once (the same request number is used again), and an
  answer that is not known yet is told apart from a refusal (`OutcomeUnknownError`).
- A host cannot collect the money of a call with a request she has not answered.
- **After the host has collected a payment, she cannot give it back herself** (plan 46, part
  3, choice B): the server refuses with its own sentence. Only Connect can then refund, from
  the founder's pages on the website, and the host owes her share back (plans 46 and 50;
  what she owes is part 16b's screen). The same holds for a member's call: after
  collection only Connect gives the time back, and the money goes to the member's card.
- **A refund can be "on its way" for days, or fail at Stripe**; the helper finishes those
  later and never sends an old request again once it has stood still too long
  (`src/lib/payments/refund-tries.ts`, pull requests 113, 116 and 121). The page says what
  is true of each.

## Decisions (the builder's)

1. **The app has the customer's side and the host's side, and nothing of the founder's.** No
   address closes a request, and nobody decides in a host's place through the app: the app's
   addresses ask "is this the host of this call?" and nothing else. (A founder who hosts a
   call of their own answers it as any host does.)
2. **Addresses, on the same functions:** what the refund box shows for this person; the
   connection record for a customer about to ask; ask; answer before the money is taken;
   decline or give back after; **and a host giving money back on her own, with no request**
   (the same function the website's button uses, with the same limits).
3. **The two moments keep their own words, from the server.** Before the money is taken the
   host is asked what to charge; after, what to give back. The app never shows one with the
   other's wording, since that could turn "charge in full" into the opposite. Every state
   listed above under "What the host is shown" has its screen, with the website's sentence.
3a. **After collection the host's side shows the server's sentence and no button.** The app
   asks the server what this host can still do with each payment and never offers "give
   back" by itself; a press that arrives after a collection is refused by the same function
   as on the website. No address of the app refunds as Connect, and none sets the mark
   "after collection" (`afterCollection` in `giveTimeBack`, `src/lib/membership/give-back.ts`).
4. **Every answer about money asks once more** with the amount, in the website's sentence. A
   refund's outcome that is not known yet is shown as exactly that, with "look again"; the
   app never says "refunded" on its own, and a retry uses the same request number.
5. **The connection record is shown to the customer before asking,** and shown again if it
   changed, as on the website. The host sees it only where the reason is the connection.
6. **A payment is always checked to belong to this call** before anything is done with it, as
   the website's actions do.

## How it is tried

- Check script: asking inside and after `askBy`; both reasons; the record changed between
  showing and sending; answering in full, less and nothing before the money is taken;
  declining and giving back after; a host giving money back with no request at all, and
  more than was charged (refused); a second request for the same call; a member's call; a
  charge still being taken; nothing charged; a host of another call, the customer, and a
  founder who is not this call's host trying to decide through the app (all refused); no
  closing address exists; the same refund sent twice; a payment of another call; a host who
  has collected tries to give back through the app, for an ordinary call and for a member's
  call (both refused, nothing written, no debt made).
- `refunds-check` and `payments-check` unchanged and green.
- On the Android test phone, with Stripe's test mode and pictures: a refund from asking to
  the money coming back, both reasons, both moments, and a declined one.

## Keeping the 4.9%

Refunds give money back for a one-to-one call. Nothing is sold.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. `src/lib/refunds/requests.ts`
changed by one comment only. What changed in this plan:

1. *After collection only Connect refunds, and the host then owes her share* (plans 46 and
   50). "What is there today", decision 3a, the check script.
2. *A refund that is on its way or failed* is said as that. "What is there today"; decision 4
   already shows an unknown outcome as unknown.

This plan is read against the code once more on the day it is built.
