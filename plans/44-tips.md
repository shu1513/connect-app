# Plan 44: A tip after a call

**Status:** a plan only; nothing is built. Written 20 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 71. Astra (gpt-6.2-astra)
checked the first draft against the code: "ready with changes", six must-fix points and a list of
details. All are worked in below; the list is at the end. After that check the founder decided
how the card fee is paid (decision 6).

**Its size, said plainly:** about half a module. No second payment system is built. A tip is
written into the books the way a contribution made once is (plans 23 and 25), so the careful money
code that exists (the hold, the taking, letting go, refunds, a bank dispute, the host's share,
"Collect earnings") does the work. What is new: the rules for when a customer is asked, a small
page before the card step, the places where the tip is shown, a founder's switch, and about a dozen
named places where the contribution code today assumes "there is always a project".

## For the founder: what this is

After a call that went through properly, the customer sees a small box on the call's results
page: "Thank *Name* with a tip", with $2, $5, $10 and a box for another amount. They pick one,
read a short summary, and pay by card. The host gets the whole tip; the cost of the card payment
is added on top for the customer. The money is first only held for three days, in which they can
cancel and pay nothing, and then taken. The host is told by email, sees the tip on that call's
page and among her earnings, and collects it with the same "Collect earnings" button.

A tip buys nothing. It is a thank-you for a call that has already taken place.

## What the founder said (20 November 2026)

- The idea: "after the customer's call, if the customer rates full 5 stars, the tip button shows up
  with the tip amount".
- The builder advised against tying it to exactly 5 stars (decision 2). Asked "Shall I write the
  plan?", the founder answered "Yes, write the plan", and not "Keep 5 stars only".
- "after the plan, actually build this feature with the workflow."
- About the fee: "customer keeps 100% tip minus stripe fees", and why: "because we need to have
  this feature in mobile. and in mobile app they have the rule to have customers take 100% of
  tip. (I hope minus the stripe fees)". Shown three ways to pay Stripe's card fee (the customer
  pays it on top; Connect pays it, as Uber and Lyft do; it comes out of the tip), the founder
  chose: **the customer pays it on top**. Asked afterwards whether taking it out of the tip would
  also do, the builder answered that it is fine on the website and the risky way for the phone
  apps, and kept the founder's choice. The founder: "research about it to make sure". What the
  research found is under decision 18; it did not change the choice.

So decisions 2 and 6 are the founder's. Every other decision is the builder's own choice and is
marked so. The founder can change any of them.

## What is there today (each read in the code by the builder)

- **Where a customer is after a call.** `/calls/[id]/results`
  (`src/app/calls/[id]/results/page.tsx`). It already holds the rating form, the refund request,
  the "follow" box, and the box about the host's project (`data-project-ask`, drawn from
  `askAfterCall` in `src/lib/projects/ask.ts`).
- **The rating.** One per person per call, 1 to 5 stars, for 7 days after the booked end, only
  when both were in the call together for at least 2 minutes (`src/lib/ratings/rules.ts`,
  `RATING`, `rateState`). Nobody is ever shown what one particular person gave them: ratings count
  only after the 7 days, each person once, in whole groups of three (`shownAverage`).
- **A contribution made once** is the nearest thing to a tip that exists. One row in
  `contributions` (kind `once`), one row in `contribution_payments` that owns everything at
  Stripe, and, when the money is taken, one line among the host's earnings in `payments` (kind
  `contribution`). The contributor pays on Stripe's card form within 30 minutes ("the card step"),
  the amount is held, and taken three days and three minutes later
  (`src/lib/contributions/charge.ts`).
- **The fee of a payment is kept on the payment itself** (`fee_percent_bps`, `fee_fixed_cents`,
  `fee_foreign_card_bps` on `contribution_payments`), and the host's share is worked out from
  those when the money is taken (`splitCharge` in `src/lib/payments/pricing.ts`). So a tip can
  have terms of its own without touching what a call or a contribution costs.
- **Everything below the contribution is already independent of projects.** Collecting
  (`src/lib/payments/collect.ts`), Stripe's messages (`src/lib/payments/stripe-events.ts`), the
  recovery of an unfinished action, refunds (`refund.ts`), a dispute (`dispute.ts`), letting a
  payment go as contributor, host or founder (`letPaymentGo` in `monthly.ts`), and the $1,000 rule
  (`countPair` in `charge.ts`) all work from the contribution's payment, the contributor and the
  host. Blocking, pausing, closing an account and suspending a host page find contributions by the
  two people (`ending.ts`). None of them reads the project.
- **Where the code does assume a project** (these are the places this plan changes):
  `contributions.project_id` is required; `whyNotAccept` and `whyMustEnd` read the project's
  status; `partsOf` in `emails.ts` reads its name; `contributionFor` (`start.ts`) and
  `founderRows` (`views.ts`) join it; `forFounder` adds money up by project; and eight places ask
  the *projects* switch (`projectsOnFor`) before doing anything new: `charge.ts` (six),
  `jobs.ts`, `recover.ts`. The step that saves the projects switch (`switch.ts`) and the helper's
  net behind it (`jobs.ts`, job 1) give up every open payment of a host the switch does not cover.
- **A card saved for a booking belongs to that booking only** (`src/lib/contributions/cards.ts`,
  `takeCardForContribution`; `isBookingsCard` in `charge.ts`). It is never used for anything else.
- **The founder's switches** are one row (`site_switches`), read by `switches()` in
  `src/lib/safety/switches.ts`.

## Decisions

Decisions 2 and 6 are the founder's. All others are the builder's choices.

**1. Who is asked, and when.** Only the customer of the call, on that call's results page. The
box is shown when all of this is true:

- the call took place: it came from a request, a "call now" or a member's booking (not a call made
  by a check script); it was not cancelled; its record is final and complete; and both were in the
  room together for at least 2 minutes. These are the rating's own conditions, so a call that can
  be rated is a call that can be tipped;
- it is at most 7 days since the call's booked end (the rating's window);
- the call was not ended with "End call and report", neither has reported or blocked the other,
  and the customer has not asked for a refund of this call;
- the customer has not rated this call 1, 2 or 3 stars (decision 2);
- there is no tip for this call that is being paid, is held, was taken, or is still being
  cancelled (decision 5);
- the host can receive one: her account is open and not paused, her host page is approved (a page
  she has hidden from search still counts; a suspended one does not), tips are switched on
  (decision 12), and Connect's own Stripe key is set. Her payout account does not have to be
  ready: a tip waits among her earnings like a call's money;
- the customer's own account is not paused;
- the box about the host's project is not shown (decision 3).

**The moment that counts is the moment the customer sends the summary page** ("Continue to the
card step"). Everything above is asked again then, by the server, from the call and the login
alone. After that the customer has the card step's 30 minutes whatever happens to the stars or to
the 7 days in between.

It is a box on the page, not a pop-up, and there is no email that asks for a tip. (The founder is
"the customer" of a call they booked themselves, like anyone else.)

**2. The stars: not "5 stars only" (the founder's, on the builder's advice).** The founder's
first idea was to show the tip button only after a 5-star rating. The builder advised against
tying it to exactly 5, for three reasons:

- *It gives the rating away.* Today a host can never tell who gave which rating. If a tip can only
  follow 5 stars, every tip tells her "this person gave me 5".
- *It bends the ratings.* Some customers would give 4 to avoid being asked, and hosts would start
  asking for 5.
- *A happy customer who gave 4, or who never rates, could not tip at all.*

What the founder's idea was right about: someone who has just rated a call low must not be asked
to tip for it. So: the box is there before the customer rates and after a rating of 4 or 5, and it
is gone after a rating of 1, 2 or 3. A tip therefore tells the host at most "this person had not
rated me 3 or lower when they started the tip", which is true of nearly every customer.

To keep that true, **a host is never shown a tip before its hold is in place.** A tip that was
started and left at the card step is not shown to her at all: otherwise "started and did not pay"
would tell her something too.

Nothing about a tip ever touches ratings, search order or suggestions. A tip that was already
given stays as it is when the customer rates low afterwards: letting it go by itself would tell
the host what the rating was. The customer can cancel it themselves while it is held.

(Two things this plan does not change: the box about a host's *project* is still shown whatever
the stars; and a host who is told of a tip may still rate that customer afterwards. Both are
noted for the founder at the end.)

**3. One box, not two.** A host with a running project already has "*Name* is working on
*project*" on this page. When that box is shown, the tip box is not: one request for money on a
page is enough. A customer who already contributes to her project is not shown the project box
(plan 23), so they get the tip box.

**4. The amounts.** $2, $5 and $10, and a box for another amount. The smallest tip is $2. The
largest is whatever keeps the card payment at $100,000 or less, the ceiling of every card payment
on Connect. The amounts are the same for every host; a host does not set them in the first
version.

**5. One tip for each call.** A new tip for a call can be started only when every earlier tip for
that call is certainly gone: its card step ran out, or its hold was let go and Stripe has
confirmed that. While one is being paid, is held, was taken, or is still being cancelled, no
second one can be started, also not when two are started at the same moment. A tip whose money
was taken counts for good, also after it was refunded. After another call they can tip again.

**6. The host gets the whole tip; the customer pays the card fee on top (the founder's).** Connect
keeps nothing of a tip.

- Stripe's card fee is 2.9% plus 30 cents. The customer is charged the smallest amount that leaves
  the whole tip after that fee: a $2 tip costs $2.37, $5 costs $5.46, $10 costs $10.61.
- The box and the summary page both show the total before anything is paid.
- **A card from outside the United States** costs Stripe 1.5% more, and that is only known once
  the card has been typed. The host still gets the whole tip; Connect carries that part (about
  8 cents on a $5 tip).
- **The 25-cent charge of a collection** (Stripe's charge for a payout) is not changed. It is for
  a whole collection, not for a tip: a tip collected together with other earnings adds nothing to
  it. A host who collects one $5 tip and nothing else gets $4.75.
- **A refund after the money was taken costs Connect Stripe's fee.** A refund gives the customer
  back what they paid, in proportion, as every refund on Connect does; Stripe keeps its fee on a
  refunded payment, and Connect has no share of a tip to cover it (46 cents on a $5 tip).
  Cancelling during the three days costs nobody anything, which is what the hold is for.

The other two ways, for the record. *Connect pays the card fee* (what Uber and Lyft do, who keep a
large part of every ride): cleanest, but about 45 cents on every $5 tip, and Connect's fee on calls
is sized to only just cover its costs. *The fee comes out of the tip* (the host would get $4.55 of
$5): fine on the website, but then the host does not get 100%, which is what Apple's and Google's
rules for a money gift ask for (decision 18).

**7. How it is paid: Stripe's card form, a hold for three days, then the money.** Exactly as a
contribution made once: the customer has 30 minutes for the card step, the amount is held, and it
is taken three days later (sooner when a bank makes that card's hold shorter; the real moment is
always shown and emailed). Until it is taken the customer, the host or the founder can let it go
at no cost to anyone.

The customer types their card again. The card they used for the call is not charged with one
press: a card saved for a booking belongs to that booking alone, by a rule that the money code
relies on everywhere, and the customer agreed to nothing else when they saved it. This will cost
some tips. "One press with the card on file" is the first improvement to consider once tips are
live (see "Not built now").

**8. What the customer reads before paying.** A summary page, as for a contribution, with these
sentences (kept in one place with a version, and what they agreed to is recorded):

- "You pay $5.46, once: a tip of $5.00 for your call with *Name* on *date*, and a payment fee of
  46 cents."
- "*Name* receives the whole $5.00. Connect keeps nothing of it; the payment fee covers what the
  payment itself costs."
- "The amount is first only held on your card, normally for three days, and taken after that.
  Until it is taken you can cancel and pay nothing."
- "A bank can make that time shorter for a card. You are always shown, and sent by email, the real
  moment your money is taken."
- "A tip is a thank-you for a call that has taken place. It does not buy another call or any
  promised reward, and it is not a donation to a charity."
- "Once money has been taken, giving it back is *Name*'s decision."

**9. What the host sees.** One email when the hold is in place ("*Customer* sent you a tip of
$5.00"), which says that it is first only held; one such email for each call at most, however
often a tip for it is cancelled and given again. On the results page of that call: the tip, where
it stands, "Let it go" while it is held, and "Refund" once it is taken. Among her earnings it reads
"Tip for the call on *date*", with a link to the call. She collects it with "Collect earnings",
7 days after the money was taken, like a contribution.

**10. Refunds are the host's decision,** as everywhere on Connect: in full or in part, until her
share has been sent to her. After that only the founder can refund it. This is the contribution's
code, unchanged (and see decision 6 for what a refund costs).

**11. What lets a held tip go.** The customer cancels it; the host or the founder lets it go;
either blocks the other; either account is paused or closed; the host's page is suspended; the
founder switches tips off; the bank drops the hold; or it cannot be taken in time. What does *not*
touch a tip: the host ending her project, the *projects* switch, a refund request for the call,
and a low rating given afterwards. Money already taken is never touched by any of these.

**12. A founder's switch: "Tips: on or off".** On for every host from the start, as memberships
and projects are; Connect is not live, and the list at the end says what has to be settled before
it is. While it is off: the box is not shown; no tip can be started; a card step that is open can
no longer be paid; and every tip that is not taken, held or still at its card step, is given up
and its hold let go, in the step that saves the switch, with the helper as the net behind it (as
the projects switch does for contributions, so that nothing is taken while a feature is off).
Letting go, refunds, disputes and recovery keep working while it is off. If Stripe had already
been asked to take a tip's money at that very moment and does, it is recorded and paid back in
full, by the code that already does this for a contribution. Tips that were taken before stay. A
host cannot switch tips off for herself in the first version.

**13. The $1,000 rule counts tips and contributions together.** It is counted for one person
paying one host (plan 23), whatever the money is called, on what the customer pays. A tip that
brings a pair over $1,000 in 30 days waits 30 days like a contribution, and the founder gets the
same email, which now says "contributions and tips".

**14. A bank dispute** holds that tip's share back while it is open or lost, as for a
contribution. It ends nothing else.

**15. Where the customer finds their tips.** "Your account" gets a short list, "Tips you gave",
shown only when there is one: the host, the amount, where it stands, and a link to the tip's own
page, which has "Cancel, nothing is charged" while it is held. The results page of the call shows
the same line in place of the box. "Projects you support" stays about projects only.

**16. The emails** are the contribution's four, in a tip's words: the hold (which is the receipt),
"nothing was charged" once a hold is certainly gone, a refund, and the host's "you got a tip".
Nothing says "donation".

**17. The founder's page.** The admin page for projects gets the tips switch and a list "Tips",
page by page, so the founder can reach any tip to let it go, hold its share back, or refund it
after the host has collected. A tip that needs a look (a problem, a dispute, over the $1,000 line)
appears in the list that already exists for contributions, named as a tip. What a project has
received stays a sum of contributions to that project.

**18. Phone apps: not in the first version of the app, but built to fit.** Read on 20 November
2026 on Apple's and Google's own pages:

- Apple lets one person give another a money gift outside its own payment when the gift is the
  giver's free choice, 100% of the funds go to the receiver, *and* the gift is not "connected to
  or associated at any point in time with receiving digital content or services" (guideline
  3.2.1(vii)). With decision 6 the first two hold. The third is the open one: a tip for a call is
  connected to a call.
- Apple does let a real-time, one-to-one service be paid outside its own payment (3.1.3(d)), which
  is why calls cost 4.9% in the app. Whether a tip for such a call counts as part of paying for it
  is not written down.
- Google regards a tip as a payment between two people when 100% of it goes to the receiver and
  it gives access to no digital content or service; otherwise its own billing must be used. With
  decision 6 that fits: a tip opens nothing.
- Neither store says whether a card fee may come off a tip first. A developer asked Apple that
  on its own forum and got no answer. In the two cases the builder found, the receiver got the
  full amount: Clubhouse's tips on iPhone in 2021 went through Stripe with "100% of the payment"
  going to the creator and "a small card processing fee" charged to the sender on top; Insight
  Timer took nothing from its teachers' tips. (Uber and Lyft pay the card cost themselves, but a
  ride is not under these rules at all.)
- **What Apple really looks at is what a tip is attached to.** In 2024 it made the meditation app
  Insight Timer pay 30% on tips of which 100% went to the teachers, because they were given at
  live classes and recordings ("digital content"). Two things from that case speak for Connect:
  Apple let the tips given from a teacher's *profile page* stay free of its cut, and it told the
  company that a one-to-one gift is free while one at a class of two or more people is not.
  Connect's calls are one-to-one.

So decision 6 puts tips in the strongest position the rules allow, and only a store's own review
can say yes. When the app is planned, the safest form there is a tip offered as a gift to the
person, for example from the host's page, and that is a choice for the app's plan. Until then the
app treats tips like contributions (plan 39): it does not show, link to or mention them. A note
is added to plan 39.

Sources, read 20 November 2026: Apple's App Review Guidelines
(https://developer.apple.com/app-store/review/guidelines/); Google Play, "Understanding Google
Play's Payments policy" (https://support.google.com/googleplay/android-developer/answer/10281818);
TechCrunch on Clubhouse Payments, 5 April 2021
(https://techcrunch.com/2021/04/05/clubhouse-payments/); TechCrunch on Apple and Insight Timer,
21 February 2024
(https://techcrunch.com/2024/02/21/in-a-reversal-apple-is-now-demanding-30-of-the-donations-to-meditation-app-insight-timers-teachers/);
Lyft's own post on its fee and tips
(https://www.lyft.com/blog/posts/an-update-for-drivers-now-the-lyft-fee-is-capped-every-month).

## What it must prove

1. The box is shown to the customer after a good call, and not: to the host or the founder; after
   a cancelled call; before the record is final; when the two were together under 2 minutes; after
   "End call and report"; when either reported or blocked the other; when a refund was asked;
   after a rating of 1, 2 or 3; later than 7 days; when the project box is shown; while tips are
   off; and once there is a tip. It *is* shown with no rating, and after a rating of 4 or of 5.
2. The server refuses what the page would not offer: a summary sent by another customer, by the
   host, for a call that does not qualify, or from a page that was opened before the customer
   rated 2 stars. The same press sent twice is one tip.
3. One tip from start to end against Stripe's test mode: summary, card step, hold, both emails,
   the taking after three days, the host's share being the whole tip ($5.46 paid, $5.00 hers), and
   collecting it after 7 days.
4. The amounts: every tip from $2 up leaves the host exactly the tip (tested for every cent
   amount over a wide range); $1.99 and nonsense are refused; too large an amount is refused.
5. A second tip for the same call is refused while one is being paid, held, taken or still being
   cancelled, also when two are started at the same moment, and also when a cancelled tip's money
   was taken after all (then it is paid back in full, once, with nothing for the host). After a
   tip that is certainly gone a new one works. After a second call a second tip works.
6. The customer cancels a held tip; the host lets one go; the founder lets one go. "Nothing was
   charged" is said only once the hold is certainly gone.
7. A card step that runs out undoes the tip; a hold placed in time and heard of late still counts.
8. The host refunds part and then the rest before collecting; after collecting only the founder
   can.
9. A block, a pause, a closed account and a suspended host page each let a held tip go and leave a
   taken one alone. A taken tip is still shown to both afterwards.
10. Ending the host's project and switching *projects* off do not touch a held tip. Switching
    *tips* off gives up held tips and open card steps, stops new ones, refuses a card form that
    was open before, and does not touch a held contribution. Switched on again, nothing old comes
    back.
11. Tips and contributions of one person to one host are counted together for the $1,000 rule.
12. A tip changes nothing about ratings; a low rating given after a tip leaves the tip alone; and
    the host is shown nothing of a tip that never got a hold.
13. A disputed tip can be neither collected nor refunded, and a monthly contribution of the same
    person goes on.
14. Every page is fetched with that person's login, as the journey checks do: the box, the
    summary, the tip's page, "Tips you gave", the host's line on the call with its buttons, "Tip
    for the call on..." among her earnings, and the founder's list and switch.
15. Everything contributions could do before still works: the contribution checks pass unchanged.

## What gets built

**The database (one migration).**

- `contributions`: `project_id` may be empty; a new `call_id`; a new `tip_cents` (the tip itself,
  what the host gets; `amount_cents` stays what the customer pays); `kind` may also be `tip`. A
  tip has a call and a tip amount and no project; a contribution has a project and neither of the
  two (a rule in the database). The smallest amount stays $5 for a contribution; a tip is at
  least $2. One more rule in the database, as the last net behind the code's own check: for each
  call at most one tip that has not ended or that ended as "paid".
- `contribution_payments`: the smallest amount becomes $2.30 or more for a tip's payment in
  practice; the rule in the database is lowered to $2, and the rule on `contributions` keeps
  contributions at $5.
- `site_switches`: `tips_off`, false at the start.

The host's share stays a line of kind `contribution` in `payments`, with no call on it, exactly as
today: so nothing in collecting, refunds or disputes changes, and a tip never mixes with the
call's own charge or refund request. That it is a tip, and for which call, is read from the
contribution.

**The rules and the reading, in one new file that only reads**
(`src/lib/contributions/tips.ts`; the plain part is tested on its own):

- the amounts: reading a typed tip (its own function with the $2 floor; the shared one for
  contributions is not changed), and `chargeFor(tip)`: what the customer pays for a tip;
- `mayTip(facts)`: decision 1 as plain logic, no database;
- `tipFacts(reader, viewer, call)`: reads everything `mayTip` needs, through the reader it is
  given. The box and the start both use it, so the page can never offer what the server refuses;
- `tipOfCall(...)`: the tip of a call as the customer, the host or the founder may see it.

So that the start can ask all of it inside its own database step, `askAfterCall`
(`projects/ask.ts`), `ratingStateOf` and `myRating` (`ratings/ratings.ts`) get an optional
reader, as `loadAttendance` already has. Without one they read as today.

**Starting a tip, and the switch** (`src/lib/contributions/tip-start.ts`):

- `startTip(...)`. The call is looked up first, without a lock; the two people come from the call
  and the login, never from the form. Then, in the app's one order of locks: the switch (shared,
  the lock a contribution takes too), the two people's lines, the host page's line, the pair, and
  the call's line last. Under them it asks `mayTip` again with everything read through this step,
  refuses unless every earlier tip for the call is certainly gone (decision 5), and writes the
  tip, what was agreed to, and its first payment with the 30 minutes of the card step and the
  tip's own fee terms. A press that is sent twice gets the first tip back, but only if the
  customer, the kind and the call are the same.
- `saveTipsSwitch(...)`: saves the switch with its line in the record of the founder's actions,
  under the lock that starting a tip waits for. Switched off, it gives up every tip payment that
  is not taken, held or waiting for a card, in the same step, and lets the holds go afterwards.

**The contribution code, widened in named places.**

- One function, `takingOnFor(contribution)`, replaces `projectsOnFor(hostId)` in the eight places
  that ask "may anything new be done for this payment?": for a tip it reads the tips switch, for
  everything else the projects switch, as today. `payNow` and `secretToPay` (`start.ts`) ask it
  too, so a card form that was open before the switch is not handed a way to pay.
- `switches()`, its default when nothing was ever saved, and `setSwitches` learn `tipsOff`.
- The helper's first job gets a search of its own for tips while they are off (every tip payment
  that is held or waiting for a card, chosen in the search itself, before its limit), and the
  search for the projects switch leaves tips out. So does the step that saves the projects switch.
- `writeDownPayment` takes the fee terms it is given; a tip's are 2.9% plus 30 cents and nothing
  extra for a card from abroad.
- `whyNotAccept` and `whyMustEnd` read the project only when there is one.
- A tip ends when it is paid, and when its only payment is given up, as a contribution made once
  does (`applyTaken`, `giveUpInStep`: "not monthly" in place of "once").
- "Stop contributing" (`stopContribution`) refuses anything that is not monthly.
- `emails.ts`: a tip's words in the four emails; no project is looked up for a tip; the host's
  email is named by the call, so it is sent once for a call; the founder's $1,000 email says
  "contributions and tips".
- `views.ts`, `start.ts`, `collect.ts`: `contributionFor` and the founder's rows allow a
  contribution with no project; what each project received is added up for projects only; the
  earnings list (`unsentEarnings`) carries the kind and the call.

**The pages.**

- Results of a call: the tip box for the customer (`data-tip-ask`), with the three totals; the
  tip's line for the customer; and for the host, once a hold was in place, the tip with "Let it
  go" and "Refund". Those two buttons get actions of their own that act on that call's tip and
  come back to the call's page (the project page's actions go back to the project).
- `/tips/new`: the summary before paying. Opening it writes nothing.
- `/contributions/[id]`: the page a tip's card step and payment live on, in a tip's words.
- "Your account": "Tips you gave".
- The host's earnings: "Tip for the call on *date*" in the list of what is not ready yet, and the
  line about what is ready says tips and contributions by name (today it calls every share that
  has no call "expired member time").
- The founder's projects page: the tips switch, the list of tips, and "a tip" in place of an
  empty project's name.
- The terms and privacy placeholders name tips where they name contributions.

**The record and the lawyer's file** are updated in the same pull request.

## How it is checked

- Plain tests for `mayTip`, the amounts and `chargeFor`.
- A check script, `scripts/tip-check.ts`, against Stripe's test mode and the local test database,
  that proves the points above with real pages and Stripe's test cards, the way
  `scripts/contribution-check.ts` and `scripts/project-journey-check.ts` do.
- The existing check scripts, all of them, because contribution code is touched.
- One try in a browser of the box, the summary and the card step.
- Astra checks this plan and then the code; CodeRabbit reviews the pull request.

**What the automatic checks cannot test:** a real card and a real bank (only Stripe's test mode
is used), a real payout to a host's bank, what Stripe really charges Connect for a tip (the plan
uses Stripe's published 2.9% plus 30 cents), and how real customers react to typing their card
again and to the added card fee.

## Not built now

- One press with the card on file. It needs its own consent wording when the card is saved, and a
  change to the rule that a booking's card belongs to the booking.
- Tips in the phone apps (decision 18).
- A few words from the customer with the tip (there is no messaging on Connect).
- A host switching tips off for herself, or choosing her own amounts.
- Amounts as a percentage of the call's price.
- A tip during a call, or later than 7 days after it.
- A total of tips on the host's home page.
- An email that asks for a tip.
- Hiding the *project* box after a low rating. It is shown whatever the stars today (plan 23).
- Keeping a host from rating a customer after she was told of their tip.

## For the founder

Choices of the builder that you may want to change: the amounts ($2, $5, $10, smallest $2); one
box and not two; the box goes away after 3 stars or fewer; the customer types their card again;
Connect carries the extra 1.5% of a card from outside the United States; the 25-cent collection
charge stays as it is; and a host is emailed about a tip while she can still rate that customer.

Things only you can do before tips go live:

- **Stripe's word.** The model you describe to Stripe for approval should now include tips.
- **The lawyer.** The points are in `docs/for-the-lawyer.md`. The main one: the payment fee added
  on top of a tip. In the United Kingdom and the European Union a business may not add a charge
  for paying by card, also not under another name, and in the United States card rules do not
  allow one on debit cards. A fee that every payment carries, whatever it is paid with, is not
  such a charge; Connect takes cards only, so every tip carries it. Whether that is enough, with
  one total shown before paying, is the lawyer's to say.

## Astra's check of the first draft (20 November 2026): "ready with changes"

Astra agreed with the way a tip is kept: in the contribution's books, with the call named on the
contribution and not on the share's line. Its six must-fix points, all taken:

1. *The database rule alone lets a second tip start too early*, because a tip that is being
   cancelled is marked ended before Stripe has confirmed that its hold is gone; and if the money
   is taken at that very moment, the first tip was paid after all. Now: a new tip only when every
   earlier one is certainly gone, asked under the pair's lock (decision 5); the database rule
   stays as the last net.
2. *The start has to ask everything the box asks*, not only about the two people and the switch,
   or an old page or a made-up form gets past the stars, the 7 days or the project box. Now: one
   function reads the facts for both; the moment the summary is sent is the moment that counts
   (decision 1); a repeated press must match the call.
3. *The order of locks, and reading through the step's own connection.* Now written out under
   "Starting a tip"; the three functions that read with a connection of their own get a reader.
4. *Switching off has to reach an open card step and the helper.* Now: decision 12 and the
   helper's own search.
5. *More places read contributions than the first draft named:* the founder's sums by project,
   "Projects you support", the founder's row, the earnings list and its "ready" line, and the
   host's buttons on the call's page. All named under "What gets built".
6. *More to prove at the edges.* Points 2, 5, 9, 10, 12 and 13 of "What it must prove" come from
   this. Two of its ideas were not taken, because the code they test is the contribution's own and
   is not changed here: a message from Stripe that arrives twice, and a card step that runs out
   while Stripe still calls the payment "processing" (`contribution-check` covers the first; the
   second is noted in the record as a question about contributions, not about tips).

Of its smaller points, taken: a host sees a tip only once it was held; one email to the host for
a call; a tip's own amount reader, so the smallest contribution stays $5; saying plainly what
"Stripe is set up" means; the founder's $1,000 email; "Stop contributing" refusing a tip; the
founder as a customer; and that "on from the start" means in the code, with the list of what must
be settled before going live. Noted and left as they are: the project box after a low rating, and
the host's rating of a customer after a tip (both under "Not built now").
