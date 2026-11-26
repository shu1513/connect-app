# Phone apps, part 16b: money a host owes back, and "I think this is wrong"

**Status:** a plan only. Written 26 November 2026 by the builder of plan 46 (the agreements), on
the founder's word of that day, from the code on `main` after pull request 106. Part of plan 45.
**Not yet checked by Astra:** like every part of plan 45 it is read against the code once more,
and shown to Astra, just before it is built. The phone-apps build is paused before part 09b on
the founder's word; this plan does not change that, and nothing is built from it yet.

## For the founder: what this is

Sometimes a host has already collected her share of a payment, and afterwards Connect gives the
customer a refund, or a bank dispute over that payment is lost. The host then owes her share
back. The website tells her, waits 14 days, and gives her a button, "I think this is wrong",
that stops everything until a person at Connect has answered her (plans 46 part 3a, and 47).

The apps show none of this yet. This part adds it: a list on the host's earnings screen, one
screen for each amount owed back, and the same button.

## What the founder said

- 26 November 2026, about this gap in the apps: "let the mobile session know about it and
  build the plan for it".

## What is there today (read in the code)

All of it is in `src/lib/disputes/takeback.ts` and `takeback-rules.ts`. The code calls an
amount owed back a "take-back".

- **Two causes.** A refund Connect gave after the host collected (today for a call's payment),
  and a lost bank dispute.
- **The notice.** The host is told by email and on the website's Messages page. Nothing is
  taken before 14 days after that email was reported as delivered (`NOTICE_MS`).
- **The objection.** While a take-back only has its notice (`canObject`: status "told"), the
  host can object once, with 10 to 2,000 characters (`objectToDebt`). Its day is then removed,
  the founders are told, and nothing is taken until a person at Connect answers. After the
  answer it is taken no earlier than 3 days after the answer's email arrived, or it is called
  off.
- **Where a host sees it on the website.**
  - The earnings box on `/host` lists them (`debtsOfHost`: everything still open, and the
    latest ten that ended).
  - One from a refund has its own page, `/debts/[id]` (`debtForPage(id, "host", user)`): what
    was refunded, to whom and why, her share before and after, what she owes, where it
    stands, her objection and our answer. The sentence for each state is written inside the
    page.
  - One from a lost dispute is shown on the dispute's page, `/disputes/[id]`, with the same
    button (`objectToDebt` with the dispute's number).
- **The states a host can see:** told, with or without a day; the email not confirmed as
  delivered; objected; answered; a person at Connect is checking something; being taken;
  Stripe could not take it yet; taken; settled outside the app; called off; "this refund did
  not go through after all"; and money taken on top that is hers and comes back.
- **The founder's buttons** (hold, answer, call off, send again, settle, account for a
  reversal made by hand) are on the website's admin side.
- **The apps.** Part 16 (earnings) was planned before any of this existed. The apps have no
  Messages screen and no dispute page.

## Decisions (the builder's; any can be changed)

1. **It belongs to the earnings screen.** It is built together with part 16, or straight
   after it. The earnings screen lists what is owed back as the website's box does: the
   amount, where it stands, and the day it would be taken.
2. **One screen, "Money owed back", for one amount, whatever its cause.** For a refund:
   everything the website's page shows the host. For a lost dispute: the take-back's own
   facts (what it is about, the amount, where it stands, her objection, our answer). The rest
   of a dispute's page is not in the apps; see "Not in this part".
3. **One shared function for the host's view.** Choosing the sentence for each state moves out
   of the two website pages into one function, and both pages call it. The app shows the same
   sentences. The scripts that read those pages today must pass unchanged.
4. **The app's answer is built field by field** (part 16's rule), never the whole record. Left
   out: the founder's notes, Stripe's own words about a refusal, any number of Stripe's, and
   the founder's view. A founder who is also the host sees the host's view in the app.
5. **Two addresses:** read one take-back, and object to it. Somebody else's and one that does
   not exist look the same.
6. **The objection.** The box is shown only when the server says an objection is possible.
   The server judges the text (10 to 2,000 characters). If sending fails, what she typed stays
   on the screen. After any answer, or none, the app reads the take-back again; "we already
   have your objection" after a lost answer is shown as where it stands, not as an error.
7. **No "are you sure".** An objection takes nothing and stops the taking, and it cannot be
   sent with an empty box.
8. **Days and times** are shown in the phone's own time, as part 08 does.
9. **A take-back about something the apps do not show.** Before building, the code is read for
   what a take-back can be about (a lost dispute can be over any payment). The rule is part
   16's: a contribution or a tip is called "other earnings", with no name and no project, and
   a membership month the same while memberships are off for the apps. The amount, where it
   stands, and the objection box are still there. The email holds the details.
10. **Notifications (a proposal for part 12's list):** two more events, the notice of a
    take-back and our answer to an objection. On a locked screen they say only "Connect has
    written to you about your earnings". A notification is never the notice itself: the 14
    days count from the email's arrival, as today.
11. **The founder's side stays on the website.**

## Keeping the 4.9%

Nothing is bought here, and nothing is paid in the app: the amount is taken from the host's
Stripe balance by Connect, as on the website. Decision 9 is the point to watch: nothing about
a project may appear.

## How it is tried

- The website's checks unchanged and green: `payments-check --payouts`, the bank-disputes
  check, the automatic tests.
- The part's check script for the app's addresses: the list and the screen in each state named
  above; somebody else's take-back; an objection that is too short, too long, sent twice,
  sent after the answer, sent after the money was taken; one from a lost dispute; that no
  field of the founder's is in any answer; one about a contribution (no name anywhere).
- On the Android test phone, with pictures: the list; the screen before and after an
  objection; our answer; taken; the phone offline while the objection is sent, with the text
  still there.

## Not in this part

- **A bank dispute's own page in the apps.** A host has 24 hours to choose "Fight it" or "Give
  the money back" (plan 47), and that choice is on the website only. It is more urgent than
  anything here, and bigger. Proposed as a part of its own (16c); the founder decides.
- **The Messages screen** in the apps (plan 49 says "phone apps later").
- **Someone who is no longer a host** has no earnings screen in the app. They have the email
  and the website.
- A host paying back what she owes through the app (not on the website either).
