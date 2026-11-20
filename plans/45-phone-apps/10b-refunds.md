# Phone apps, part 10b: refunds after a call

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 10. It moves money back and forth, so it is
kept small and apart.

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

## Decisions (the builder's)

1. **The app has the customer's side and the host's side, and nothing of the founder's.** No
   address closes a request, and nobody decides in a host's place through the app: the app's
   addresses ask "is this the host of this call?" and nothing else. (A founder who hosts a
   call of their own answers it as any host does.)
2. **Addresses, on the same functions:** what the refund box shows for this person; the
   connection record for a customer about to ask; ask; answer before the money is taken;
   decline or give back after.
3. **The two moments keep their own words, from the server.** Before the money is taken the
   host is asked what to charge; after, what to give back. The app never shows one with the
   other's wording, since that could turn "charge in full" into the opposite. Every state
   listed above under "What the host is shown" has its screen, with the website's sentence.
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
  declining and giving back after; a second request for the same call; a member's call; a
  charge still being taken; nothing charged; a host of another call, the customer, and a
  founder who is not this call's host trying to decide through the app (all refused); no
  closing address exists; the same refund sent twice; a payment of another call.
- `refunds-check` and `payments-check` unchanged and green.
- On the Android test phone, with Stripe's test mode and pictures: a refund from asking to
  the money coming back, both reasons, both moments, and a declined one.

## Keeping the 4.9%

Refunds give money back for a one-to-one call. Nothing is sold.
