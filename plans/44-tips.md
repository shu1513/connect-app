# Plan 44: A tip after a call

**Status:** a plan only; nothing is built. Written 20 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 71.

**Its size, said plainly:** about half a module. No second payment system is built. A tip is
written into the books the way a contribution made once is (plans 23 and 25), so the careful money
code that exists (the hold, the taking, letting go, refunds, a bank dispute, the host's share,
"Collect earnings") does the work. What is new: the rules for when a customer is asked, a small
page before the card step, the places where the tip is shown, a founder's switch, and about a dozen
named places where the contribution code today assumes "there is always a project".

## For the founder: what this is

After a call that went through properly, the customer sees a small box on the call's results
page: "Thank *Name* with a tip", with $2, $5, $10 and a box for another amount. They pick one,
read a short summary, and pay by card. The money is first only held for three days, in which they
can cancel and pay nothing, and then taken. The host is told by email, sees the tip on that call's
page and among her earnings, and collects it with the same "Collect earnings" button.

A tip buys nothing. It is a thank-you for a call that has already taken place.

## What the founder said (20 November 2026)

- The idea: "after the customer's call, if the customer rates full 5 stars, the tip button shows up
  with the tip amount".
- The builder advised two changes (decisions 2 and 6 below explain both). Asked "Shall I write the
  plan?", the founder answered "Yes, write the plan", and not "Keep 5 stars only".
- Then: "after the plan, actually build this feature with the workflow."

So the rule about stars below (decision 2) is the builder's advice that the founder accepted. Every
other decision is the builder's own choice and is marked so. The founder can change any of them.

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
- **Everything below the contribution is already independent of projects.** Collecting
  (`src/lib/payments/collect.ts`), Stripe's messages (`src/lib/payments/stripe-events.ts`), the
  recovery of an unfinished action, refunds (`refund.ts`), a dispute (`dispute.ts`), letting a
  payment go as contributor, host or founder (`letPaymentGo` in `monthly.ts`), and the $1,000 rule
  (`countPair` in `charge.ts`) all work from the contribution's payment, the contributor and the
  host. None of them reads the project.
- **Where the code does assume a project** (these are the places this plan changes):
  `contributions.project_id` is required; `whyNotAccept` and `whyMustEnd` read the project's
  status; `partsOf` in `emails.ts` reads its name; `contributionFor` (`start.ts`),
  `founderRows` (`views.ts`) join it; and eight places ask the *projects* switch
  (`projectsOnFor`) before doing anything new: `charge.ts` (six), `jobs.ts`, `recover.ts`.
  The step that saves the projects switch (`switch.ts`) and the helper's net behind it
  (`jobs.ts`, job 1) give up every open payment of a host the switch does not cover.
- **A card saved for a booking belongs to that booking only** (`src/lib/contributions/cards.ts`,
  `takeCardForContribution`; `isBookingsCard` in `charge.ts`). It is never used for anything else.
- **The founder's switches** are one row (`site_switches`), read by `switches()` in
  `src/lib/safety/switches.ts`.

## Decisions

Decision 2 is the builder's advice, accepted by the founder. All others are the builder's choices.

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
- there is no tip for this call yet (decision 5);
- the host can receive one: her account is open and not paused, her host page is approved (a page
  she has hidden from search still counts; a suspended one does not), tips are switched on
  (decision 12), and Stripe is set up;
- the customer's own account is not paused;
- the box about the host's project is not shown (decision 3).

It is a box on the page, not a pop-up, and there is no email that asks for a tip.

**2. The stars: not "5 stars only".** The founder's first idea was to show the tip button only
after a 5-star rating. The builder advised against tying it to exactly 5, for three reasons:

- *It gives the rating away.* Today a host can never tell who gave which rating. If a tip can only
  follow 5 stars, every tip tells her "this person gave me 5".
- *It bends the ratings.* Some customers would give 4 to avoid being asked, and hosts would start
  asking for 5.
- *A happy customer who gave 4, or who never rates, could not tip at all.*

What the founder's idea was right about: an unhappy customer must never be asked. So: the box is
there before the customer rates and after a rating of 4 or 5, and it is gone after a rating of 1,
2 or 3. A tip therefore tells the host at most "this person had not rated me 3 or lower when they
tipped", which is true of nearly every customer.

Nothing about a tip ever touches ratings, search order or suggestions. A tip that was already
given stays as it is when the customer rates low afterwards: letting it go by itself would tell
the host what the rating was. The customer can cancel it themselves while it is held.

**3. One box, not two.** A host with a running project already has "*Name* is working on
*project*" on this page. When that box is shown, the tip box is not: one request for money on a
page is enough. A customer who already contributes to her project is not shown the project box
(plan 23), so they get the tip box.

**4. The amounts.** $2, $5 and $10, and a box for another amount. The smallest tip is $2 (below
that, the 30 cents of every card payment eat most of it). The largest is $100,000, the same
ceiling as a contribution, so there is one rule for money a customer gives a host. The amounts are
the same for every host; a host does not set them in the first version.

**5. One tip for each call.** While a tip for a call is being paid, is held, or was taken, no
second one can be started for that call. A tip that was cancelled, or whose card step ran out,
does not count: the customer can tip again. After another call they can tip again.

**6. Our fee is the usual one,** on every tip: 4.9% plus 30 cents, plus 1.5% for a card from
outside the United States, taken from the tip. Of $2 the host gets $1.60; of $5, $4.45; of $10,
$9.21. The summary page says so in plain words before the customer pays (decision 8).

The builder first suggested that Connect take nothing from a tip, hoping that tips could then be
offered in the phone apps without Apple's and Google's cut. Reading the rules showed that does not
hold (see "Phone apps" below), and with no fee Connect would pay Stripe's card cost on every tip
out of its own pocket (about 36 cents on $2). So the fee is the usual one, which "just barely
covers our operating expenses" (the founder's rule for fees, plan 2).

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

- "You pay $5.00, once, as a tip for your call with *Name* on *date*."
- "Of it, *Name* receives $4.45. The rest covers the card payment and Connect's fee. (A little
  less reaches them if your card is from outside the United States.)"
- "The amount is first only held on your card, normally for three days, and taken after that.
  Until it is taken you can cancel and pay nothing."
- "A bank can make that time shorter for a card. You are always shown, and sent by email, the real
  moment your money is taken."
- "A tip is a thank-you for a call that has taken place. It does not buy another call or any
  promised reward, and it is not a donation to a charity."
- "Once money has been taken, giving it back is *Name*'s decision."

**9. What the host sees.** One email when the hold is in place ("*Customer* sent you a tip of
$5.00"), which says that it is first only held. On the results page of that call: the tip, where
it stands, "Let it go" while it is held, and "Refund" once it is taken. Among her earnings it reads
"Tip for the call on *date*", with a link to the call. She collects it with "Collect earnings",
7 days after the money was taken, like a contribution.

**10. Refunds are the host's decision,** as everywhere on Connect: in full or in part, until her
share has been sent to her; our fee goes back in the same proportion. After that only the founder
can refund it. This is the contribution's code, unchanged.

**11. What lets a held tip go.** The customer cancels it; the host or the founder lets it go;
either blocks the other; either account is paused or closed; the host's page is suspended; the
founder switches tips off; the bank drops the hold; or it cannot be taken in time. What does *not*
touch a tip: the host ending her project, the *projects* switch, a refund request for the call,
and a low rating given afterwards. Money already taken is never touched by any of these.

**12. A founder's switch: "Tips: on or off".** On for every host from the start. While it is off:
the box is not shown, no tip can be started or paid, and tips that are only held are let go (as
the projects switch does for contributions, so that nothing is taken while a feature is off).
Tips that were taken stay. A host cannot switch tips off for herself in the first version.

**13. The $1,000 rule counts tips and contributions together.** It is counted for one person
paying one host (plan 23), whatever the money is called. A tip that brings a pair over $1,000 in
30 days waits 30 days like a contribution, and the founder gets the same email.

**14. A bank dispute** holds that tip's share back while it is open or lost, as for a
contribution. It ends nothing else.

**15. Where the customer finds their tips.** "Your account" gets a short list, "Tips you gave",
shown only when there is one: the host, the amount, where it stands, and a link to the tip's own
page, which has "Cancel, nothing is charged" while it is held. The results page of the call shows
the same line in place of the box.

**16. The emails** are the contribution's four, in a tip's words: the hold (which is the receipt),
"nothing was charged" once a hold is certainly gone, a refund, and the host's "you got a tip".
Nothing says "donation".

**17. The founder's page.** The admin page for projects gets the tips switch and a list "Tips",
page by page, so the founder can reach any tip to let it go, hold its share back, or refund it
after the host has collected. A tip that needs a look (a problem, a dispute, over the $1,000 line)
appears in the list that already exists for contributions.

**18. Phone apps: not in the first version of the app.** Read on 20 November 2026 on Apple's and
Google's own pages:

- Apple lets one person give another a money gift outside its own payment only when all of it
  goes to the receiver *and* the gift is not "connected to or associated at any point in time with
  receiving digital content or services" (guideline 3.2.1(vii)). A tip for a call is connected to
  a service, so this rule does not free it, whatever Connect's fee is.
- Apple does let a real-time, one-to-one service be paid outside its own payment (3.1.3(d)), which
  is why calls cost 4.9% in the app. Whether a tip for such a call counts as part of paying for it
  is not written down.
- Google regards a tip as a payment between two people when all of it goes to the receiver and it
  gives access to nothing; otherwise its own billing must be used. Its one-to-one rule is the same
  as Apple's in substance.

So nobody can say today that tips may be taken in the apps without the stores' 15 to 30%. Until
that is settled the app treats tips like contributions (plan 39): it does not show, link to or
mention them. A note is added to plan 39.

## What it must prove

1. The box is shown to the customer after a good call, and not: to the host or the founder; after
   a cancelled call; before the record is final; when the two were together under 2 minutes; after
   "End call and report"; when either reported or blocked the other; when a refund was asked;
   after a rating of 1, 2 or 3; later than 7 days; when the project box is shown; while tips are
   off; and once there is a tip. It *is* shown with no rating, and after a rating of 4 or of 5.
2. One tip from start to end against Stripe's test mode: summary, card step, hold, both emails,
   the taking after three days, the host's share with the right split ($5 gives $4.45), and
   collecting it after 7 days.
3. The same press sent twice is one tip. A second tip for the same call is refused while one is
   being paid, held or taken, also when two are started at the same moment. After a cancelled one
   a new one works.
4. The customer cancels a held tip; the host lets one go; the founder lets one go. "Nothing was
   charged" is said only once the hold is certainly gone.
5. A card step that runs out undoes the tip; a hold placed in time and heard of late still counts.
6. The host refunds part and then the rest before collecting; after collecting only the founder
   can.
7. A block, a pause, a closed account and a suspended host page each let a held tip go and leave a
   taken one alone.
8. Ending the host's project and switching *projects* off do not touch a held tip. Switching
   *tips* off lets held tips go, stops new ones, and does not touch a held contribution.
9. Tips and contributions of one person to one host are counted together for the $1,000 rule.
10. A tip changes nothing about ratings, and a low rating given after a tip leaves the tip alone.
11. $1.99 is refused, $2 is taken, $100,000.01 and nonsense are refused.
12. Every page is fetched with that person's login, as the journey checks do: the box, the
    summary, the tip's page, "Tips you gave", the host's line on the call with its buttons, "Tip
    for the call on..." among her earnings, and the founder's list and switch.
13. Everything contributions could do before still works: the contribution checks pass unchanged.

## What gets built

**The database (one migration).**

- `contributions`: `project_id` may be empty; a new `call_id`; `kind` may also be `tip`. A tip has
  a call and no project; a contribution has a project and no call (a rule in the database). The
  smallest amount stays $5 for a contribution and is $2 for a tip. One more rule in the database:
  for each call at most one tip that has not ended or that ended as "paid".
- `contribution_payments`: the smallest amount becomes $2 (the rule above keeps contributions at
  $5).
- `site_switches`: `tips_off`, false at the start.

The host's share stays a line of kind `contribution` in `payments`, with no call on it, exactly as
today: so nothing in collecting, refunds or disputes changes. That it is a tip, and for which call,
is read from the contribution.

**The rules, in one new file** (`src/lib/contributions/tips.ts`, with the plain part tested on its
own):

- `mayTip(facts)`: decision 1 as plain logic, no database.
- `whyNotTip(reader, customer, call)`: the part of decision 1 that is about the two people, the
  switch and Stripe. Starting a tip, paying it and the box all ask this one function.
- `tipAfterCall(...)`: what the results page needs: the box, or the tip that exists, or nothing.
- `startTip(...)`: as `startContribution`: the request's id makes one press one tip; the wording's
  version is checked; under the locks (the switch, the two people, the host's page, the pair) it
  asks `whyNotTip` again, refuses a second tip for the call, and writes the tip, what was agreed
  to, and its first payment with the 30 minutes of the card step.
- `saveTipsSwitch(...)`: saves the switch with its line in the record of the founder's actions
  and, when it is switched off, gives up every tip payment that is not taken, in the same step;
  the helper's first job is the net behind it.

**The contribution code, widened in named places.**

- One function, `takingOnFor(contribution)`, replaces `projectsOnFor(hostId)` in the eight places
  that ask "may anything new be done for this payment?": for a tip it reads the tips switch, for
  everything else the projects switch, as today.
- `whyNotAccept` and `whyMustEnd` read the project only when there is one.
- A tip ends when it is paid, and when its only payment is given up, as a contribution made once
  does (`applyTaken`, `giveUpInStep`: "not monthly" in place of "once").
- The step that saves the *projects* switch, and the helper's net behind it, leave tips out.
- `emails.ts`: a tip's words in the four emails; no project is looked up for a tip.
- `views.ts` and `start.ts`: the joins that need a project become ones that allow none; the
  founder's rows and the earnings list also carry the kind and the call.

**The pages.**

- Results of a call: the tip box for the customer (`data-tip-ask`); the tip's line for the
  customer and for the host, the host's with "Let it go" and "Refund".
- `/tips/new`: the summary before paying. Opening it writes nothing.
- `/contributions/[id]`: the page a tip's card step and payment live on, in a tip's words.
- "Your account": "Tips you gave".
- The host's earnings: "Tip for the call on *date*".
- The founder's projects page: the tips switch and the list of tips.
- The terms and privacy placeholders name tips where they name contributions.

**The record and the lawyer's file** are updated in the same pull request.

## How it is checked

- Plain tests for `mayTip` and the amounts.
- A check script, `scripts/tip-check.ts`, against Stripe's test mode and the local test database,
  that proves the thirteen points above with real pages and Stripe's test cards, the way
  `scripts/contribution-check.ts` and `scripts/project-journey-check.ts` do.
- The existing check scripts, all of them, because contribution code is touched.
- One try in a browser of the box, the summary and the card step.
- Astra checks this plan and then the code; CodeRabbit reviews the pull request.

**What the automatic checks cannot test:** a real card and a real bank (only Stripe's test mode
is used), a real payout to a host's bank, and how real customers react to typing their card again.

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

## For the founder

Choices of the builder that you may want to change: the amounts ($2, $5, $10, smallest $2); the
usual fee on tips, shown to the customer; one box and not two; the box goes away after 3 stars or
fewer; the customer types their card again.

Things only you can do before tips go live:

- **Stripe's word.** The model you describe to Stripe for approval should now include tips.
- **The lawyer.** The points are in `docs/for-the-lawyer.md`. The main one: in some places the law
  says a tip must reach the worker in full. Hosts are not Connect's employees, but a lawyer should
  say whether Connect may keep its fee from something called a "tip", or whether the fee on tips
  must be zero or the word changed.
