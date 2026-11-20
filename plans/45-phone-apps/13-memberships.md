# Phone apps, part 13: memberships, the member's side

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked the first draft ("not ready"); it was split in two (this part and 13b, the host's
side) and every point is worked in (the list is at the end).

**This is the part to watch for the 4.9%.** Read "Keeping the 4.9%" below first.

## For the founder: what this is

A customer joins a host's membership (a fixed amount every month that is talk time with her),
pays, books as a member with no waiting, and manages it. All behind a switch for the apps
with three positions.

## Keeping the 4.9%, said plainly

- A single one-to-one call is clearly allowed outside the stores' payment. A membership is
  less clear. The talk time is the same kind of thing; but **member-only times and instant
  booking** could be read by a store as features that are bought, and then its own payment
  would be asked for.
- **Hiding the Join button does not settle that.** If a store sees those two benefits as
  bought features, it can object to them being used in the app at all, wherever they were
  paid for. So plan 39's first fallback (join on the website, use in the app) works only if
  that store accepts it. This plan no longer promises that it will.
- **Nothing here risks the 4.9% itself:** if a store objects, memberships leave the apps (the
  switch) and stay on the website. What is at risk is a refused or delayed review.
- **So, before the apps are first sent to the stores, the founder chooses** the switch's
  position, knowing this: *off* is the position with nothing to dispute; *on* is what plan 39
  chose, described openly as prepaid one-to-one talk time. One setting covers both stores;
  if they differ, the stricter one is used. Whatever a switch can turn on is described in
  what is sent to the reviewers, and they are given an account in which they can see it
  (part 20).

## What is there today (read in the code)

- **Three things can stop memberships, and they are different:** the founder's switch per
  host (`membershipsOnFor`), the host's own offer being on or off, and (new) the apps' switch.
  With either of the first two off, a month that was paid can still be used; nothing new
  starts and nothing renews.
- **Joining** (`src/app/h/[handle]/membership/`): by the host's invitation (`invitationFor`;
  an invitation runs out; the invited person can look at her times first,
  `openTimesForInvited`); the offer (`offerOfHost`); the agreement's sentences and box, with a
  wording version (`agreementSentences`, `agreementBox`); `join`; paying on Stripe's form
  (`secretToPay`), where the money of the first month is at first only held; `resume`;
  `payNow`; carrying on with a payment that was begun.
- **A membership's page** (`src/app/memberships/[id]/`, 473 lines): the month, the time left,
  each month's receipt and money given back, paused and why, a month that is held and until
  when it can be cancelled free, cancel at the month's end or now (`cancelAction`,
  `cancelNowAction`), keep (`keepAction`), a changed offer (`acceptOfferAction`,
  `declineOfferAction`), the pay page for a month that failed.
- **Booking as a member** (`bookAsMember` in `src/lib/membership/book.ts`; `bookMember` is the
  website's form step): confirmed at once, from the month's time, with member-only times,
  with a once-only key. **If the month's money is still only held, the first booking takes
  it.** A payment can go through and the time be gone meanwhile; the page says so and offers
  another time. `continueMemberAction` carries on where a booking stopped.

## Decisions (the builder's)

1. **The apps' switch has three positions, and each is defined by what the server refuses,**
   not by what the app hides:
   - **on:** everything below.
   - **on, but nothing is bought in the app:** refused to the app, on every address: joining,
     paying or paying again for a month, resuming, carrying on with a card step, switching
     renewal back on, accepting any new terms that are paid for, cheaper ones that charge
     later included, **and a member's booking that would take a held month's money.**
     Allowed: seeing the membership, booking from time that is already paid, and cancelling.
     No invitation and no offer is shown, and nothing says where to join. **This position is
     only used when the stores have accepted it.**
   - **Turning the switch does not reach a card sheet that is already open on someone's
     phone:** Stripe would still take that payment. So turning the switch to a stricter
     position happens in this order: **from the first moment, the server refuses every new
     membership payment asked for by an app** (so none can slip in while the rest is done);
     then it ends every membership payment that an app had begun and not finished, and
     settles any that was already sent; only then does the new position count as in force.
   - **off:** no membership address answers the app, except the two below.
2. **A member can always cancel, and always see what they are paying for, in any position:**
   their own membership, with months that are held or not paid yet, and both ways of
   cancelling that apply. A person whose membership renews must never be left without the
   way to stop it because a switch was turned. Their calls already booked stay in their
   calls.
3. **The agreement a customer accepts is the server's text, word for word,** with its wording
   version, ticked before paying. The app holds no copy.
4. **Paying a month** uses Stripe's sheet for phones on the payment the server already makes,
   with part 06's settings.
5. **What it is called in the app:** "Membership: monthly talk time with *Name*". The app adds
   no benefit and no wording the website does not have.
6. **Every state the website shows is shown,** with its sentence: invited, the invitation run
   out, joining, payment begun and not finished, not paid, paused and why, a held month and
   its deadline, time left, not enough time left, the payment went through but the time is
   gone.

## How it is tried

- `membership-check`, `membership-journey-check`, `member-calls-check` unchanged and green.
- Check script for the app's addresses: join by invitation, pay, book as a member (also the
  booking that takes a held month), cancel both ways, keep, a changed offer accepted and
  declined. **Then every address again in each position of the apps' switch,** with the
  founder's per-host switch and the host's offer switch on and off: exactly what is answered
  and what is refused, and that cancelling and seeing always work.
- On the Android test phone, with Stripe's test cards and pictures: joining and paying; a
  member booking; the membership's page in each state; each position of the switch.

## Astra's check (20 November 2026): "not ready", now worked in

1. *Hiding Join does not protect anything by itself,* and the middle position was promised
   too firmly. "Keeping the 4.9%"; decision 1.
2. *There were payment paths left open in the middle position:* a member's booking that takes
   a held month, resuming, paying again, the card step, renewal, a costlier offer. Decision 1
   lists and refuses them.
3. *A member must always be able to cancel.* Decision 2.
4. *Three different switches were treated as one.* "What is there today".
5. *Missing states and steps:* invitations running out and their preview, receipts and money
   given back, the held month's deadline, a payment that succeeds when the time is gone.
   Decision 6.
6. *Too big for one part.* The host's side is part 13b.
