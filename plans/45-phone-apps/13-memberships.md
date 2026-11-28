# Phone apps, part 13: memberships, the member's side

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked the first draft ("not ready"); it was split in two (this part and 13b, the host's
side) and every point is worked in (the list is at the end). Brought up to date on 27 November
2026, after the website changed (that list is at the end too).

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
- **A membership's page** (`src/app/memberships/[id]/`, 514 lines on 27 November): the month,
  the time left,
  each month's receipt and money given back, paused and why, a month that is held and until
  when it can be cancelled free, cancel at the month's end or now (`cancelAction`,
  `cancelNowAction`), keep (`keepAction`), a changed offer (`acceptOfferAction`,
  `declineOfferAction`), the pay page for a month that failed.
- **Booking as a member** (`bookAsMember` in `src/lib/membership/book.ts`; `bookMember` is the
  website's form step): confirmed at once, from the month's time, with member-only times,
  with a once-only key. **If the month's money is still only held, the first booking takes
  it.** A payment can go through and the time be gone meanwhile; the page says so and offers
  another time. `continueMemberAction` carries on where a booking stopped. **A member's
  booking now carries the version of the words its page showed** (`wordsVersion`; plan 51):
  the page shows what ending the call himself costs (`MEMBER_END_NOW_RULE` in
  `src/lib/booking/rules.ts`), and a booking that comes without the current version is
  refused with "the words changed", so nobody books under words they did not see.
- **Cancelling a new membership within 14 days** (plan 46, part 3c): the member's own button,
  `ownFourteenDays` and `cancelWithin14Days` in `src/lib/membership/fourteen-days.ts`. The
  sentence ticked before joining (wording version "2026-11-26") promises that button "on
  your membership's page". The app's side of it is part 13c.
- **Paused with an account** (plans 53 and 55): when the member's or the host's account is
  paused, a membership in which there is a member (running, waiting for a payment, or in
  the middle of resuming) is paused, not ended (`ACCOUNT_PAUSE`). An invitation nobody had
  accepted ends, as before. A membership that was already paused for another reason stays
  as it was, with its own reason. At the pause, coming member calls are cancelled at no
  charge and the unused time of the paid month is paid back to the card: **no minutes are
  carried over.** The page says "the membership was paused with one of the two accounts",
  never which one. When the pause is lifted, the member is sent the way to resume, but only
  once both accounts are open again. Resuming is its own step and can be unavailable (the
  tidying-up of the old month is not finished, or the host has no offer that can be taken).
  It starts a **new month**: with the minutes a month they had before, and the lower of
  their old price and the host's price on that day (`resumeTerms` in
  `src/lib/membership/rules.ts`). The resume page sends the price and time it showed, and
  the step refuses if those are no longer what the member would get. Only a pause *with an
  account* keeps the old terms; after any other pause resuming means the host's membership
  as it is that day.
- **A customer with a bank dispute** cannot join, resume, take a host's new offer or switch
  renewal back on (`whyNoNewPayment`, plan 47). Booking from a month they have is not
  stopped by that rule. **A separate rule** freezes a month that a bank is itself looking at
  (nothing of that month can be changed while it is); the two are different checks with
  different sentences, and the app shows whichever the server sends. What a host is told
  when her member is the one who is stopped stays neutral, as on the website.
- **Time given back after the host collected** (plan 50, part 2) goes to the member's card,
  not back into the month, and the month's page shows each such line as "is being paid back
  to your card" or "paid back to your card". Behind those two sentences a pay-back can be
  owed and not yet sent, on its way, paid, or stuck (it failed at Stripe, a bank dispute
  froze it, or a person at Connect has to look): `src/lib/membership/payback.ts`.

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
7. **Nobody joins in an app before part 13c's button is there.** The sentence ticked before
   joining promises it. So part 13c is built in the same pull request as this part, or in
   the next one, and the apps' switch for memberships stays "off" until both are merged
   (part 13c, decision 1).
8. **Paused with an account is one more state, with the server's sentences.** Resuming after
   it shows the terms the server gives (`resumeTerms`), and the app sends back the price and
   the time it showed, as the website's page does. The app works out no price. In the middle
   position of the switch resuming is refused like every payment (decision 1).
9. **A member's booking sends the version of the words the server gave with the booking
   screen,** and shows the server's sentence about "End call now" with them. The app holds
   no copy of the words and no version of its own; "the words changed" is shown with the
   new words to be read and pressed again.
10. **A refusal because of a bank dispute** is the sentence the server sends the apps (part
    09a, decision 5: it names email and the website, not "your messages"), shown as it
    comes, on every step that would start something new to pay.
11. **Money on its way back to the card** is shown line by line with the state the server
    gives it: owed, on its way, paid back, or waiting for a person at Connect. The app never
    says "paid back" for anything the server has not called paid, and adds nothing up. (If
    the website's page has no sentence yet for a pay-back that is stuck, one is written for
    both when this part is built.)
12. **"Book a time" from a conversation** (part 17b, decision 13) leads a member to this
    part's booking only when the server says this member can book as a member now (the
    apps' switch fully on, the membership running, the host able to be booked). Otherwise
    the conversation keeps what part 17b gives it: the ordinary booking button, or its
    sentence for a closed conversation. It is built with whichever of the two parts comes
    second (part 17b, decision 20).

## How it is tried

- `membership-check`, `membership-journey-check`, `member-calls-check` unchanged and green.
- Check script for the app's addresses: join by invitation, pay, book as a member (also the
  booking that takes a held month), cancel both ways, keep, a changed offer accepted and
  declined; a member's booking without the words' version, and with an old one (both
  refused, nothing written); a membership paused with the member's account and one paused
  with the host's (the same sentence for both), resuming refused while the pause lasts,
  then resuming with the old time and the lower price, and refused when the app sends terms
  that are no longer true; joining and resuming refused for a customer with an open bank
  dispute. **Then every address again in each position of the apps' switch,** with the
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

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *The 14-day button exists and is promised before joining* (plan 46, part 3c). "What is
   there today"; decision 7 ties this part to part 13c.
2. *A paused account pauses its memberships, and the member comes back with the old time and
   price* (plans 53 and 55). "What is there today", decision 8, the check script.
3. *A member's booking records the words it showed* (plan 51). Decision 9.
4. *A customer with a bank dispute cannot start a membership payment* (plan 47). Decision 10.
5. *Time given back after collection goes to the card* (plan 50, part 2). Decision 11.
6. *Messages* (part 17b) have a way to book. Decision 12.

This plan is read against the code once more on the day it is built.

## Astra's check of this update (27 November 2026): "not ready", worked in

1. *"Every membership is paused and the member comes back as before" was too broad.* "What is
   there today" now says it state by state: which memberships pause, that no minutes carry
   over, when the way to resume is sent, when resuming is not possible, and that it is a new
   month.
2. *Two sentences were not enough for money on its way back.* Decision 11: four states.
3. *The refusal for a bank dispute, and the two different rules behind "a bank is involved".*
   "What is there today"; decision 10.
4. *Booking as a member from a conversation was promised without its conditions.* Decision
   12.
