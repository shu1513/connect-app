# Phone apps, part 16b: money a host owes back, and "I think this is wrong"

**Status:** a plan only. Written 26 November 2026 by the builder of plan 46 (the agreements), on
the founder's word of that day, from the code on `main` after pull request 106. Part of plan 45.
**Not yet checked by Astra:** like every part of plan 45 it is read against the code once more,
and shown to Astra, just before it is built. The phone-apps build is paused before part 09b on
the founder's word; this plan does not change that, and nothing is built from it yet.
Read again on 27 November 2026 by the builder of the phone apps, against the code on `main`
after pull request 123 (the list is at the end).

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

- **Four causes** (two when this was written; the other two came with plan 50 on 27
  November). A refund Connect gave after the host collected a call's payment (plan 46); a
  tip or a contribution that Connect refunded after she collected it (plan 50, part 1); a
  member's call whose time Connect gave back after she collected it (plan 50, part 2); and
  a lost bank dispute (plan 47). `debtForPage` says in words what each is about: "the
  payment for your call with [name] on [day]", "a tip for the call on ...", "a contribution
  to ...".
- **Not every debt is taken by the app.** One from a *refund*, for a payment made before the
  host held a published Host Agreement (today that is every payment, since the agreements
  are drafts), is written down in the state "waiting": she is told, and a person at Connect
  settles it with her; the app never takes it. One from a *lost bank dispute*, whatever
  agreement she held, is in the state "told" and takes the way described below. So is one
  from a refund, but only when the app can show that she had accepted the published Host
  Agreement in time for that payment; where that cannot be shown, or the charge cannot be
  matched, the debt stays "waiting". **A debt can be
  objected to while it is "told", and only then:** the 14 days are the earliest moment of
  taking, not the end of her right to object. And money can also be owed the other way:
  when more was taken than turned out to be owed, the rest is hers and is given back.
- **The notice.** The host is told by email and on the website's Messages page. Nothing is
  taken before 14 days after that email was reported as delivered (`NOTICE_MS`).
- **The objection.** While a take-back only has its notice (`canObject`: status "told"), the
  host can object once, with 10 to 2,000 characters (`objectToDebt`). Its day is then removed,
  the founders are told, and nothing is taken until a person at Connect answers. After the
  answer it is taken no earlier than 3 days after the answer's email arrived, or it is called
  off.
- **Where a host sees it on the website.**
  - The earnings box on `/host` lists them (`debtsOfHost`: everything still open, and the
    latest ten that were taken or settled). **One that was called off is not in that list.**
    Its host is told on the Messages page and by email, and its own page still opens from
    the link there.
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
   amount, where it stands, and the day it would be taken. **The app's list also shows the
   latest ones that were called off** ("Called off. Nothing is owed for it."). The apps have
   no Messages screen, so without that a take-back a host had seen would simply vanish, and
   she could not open it again to read how it ended. (CodeRabbit found this in the plan's
   review. The website's own list stays as it is.)
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
4a. **What the team typed is not sent to the apps.** Where the website shows words a person
   at Connect typed freely (they can be about anything, a tip or a diary post included), the
   app shows a fixed sentence in their place, "The reason is in the email we sent you, and
   on the website.", and keeps everything else: the figures, the decision, the deadlines,
   the right to object. On this screen that is the team's reason for
   the refund and its answer to her objection. Her own objection is hers and is shown.
5. **Two addresses:** read one take-back, and object to it. Somebody else's and one that does
   not exist look the same.
6. **The objection.** The box is shown only when the server says an objection is possible.
   The server judges the text (10 to 2,000 characters). If sending fails, what she typed stays
   on the screen. After any answer, or none, the app reads the take-back again; "we already
   have your objection" after a lost answer is shown as where it stands, not as an error.
7. **No "are you sure".** An objection takes nothing and stops the taking, and it cannot be
   sent with an empty box.
8. **Days and times** are shown in the phone's own time, as part 08 does.
9. **A take-back about a contribution or a tip is not in the apps at all** *(rewritten after
   Astra's check of 27 November; the first version called it "other earnings")*. Such
   take-backs exist since plan 50. Even without a name, an entry with its state, its day and
   an objection box is *about* one contribution or one tip, and "Other earnings" (part 16,
   decision 5) is a nameless total, never an entry. So:
   - **The server sorts by what the money was for before anything else:** before asking
     whether a host has any take-back, before picking the latest ten, before answering one,
     before taking an objection. One about a contribution or a tip gives the app nothing:
     not in the list, not in a count, and asked for by its number it looks exactly like one
     that does not exist.
   - **Her way to it stays whole elsewhere:** the email, the website's page, and the
     objection button there while the debt is "told" (one that is "waiting" goes through
     support, as on the website).
   - **A member's call** given back by Connect is in the apps while memberships are on for
     them, named as a call; while they are off it is left out in the same way.
   - **What counts is what the refunded or disputed payment was for,** nothing else. Money
     owed back for a call is shown as it truly is, also when that call's share was once
     collected together with a contribution.
   - **One bank dispute can stand behind several amounts.** The app's addresses work with
     one take-back of the signed-in host, never with "the dispute's" debts as a group.
   - In the list, one that is over (taken, settled, called off) is told apart from money
     that is owed now, in words and in order: what is owed comes first.
   - **Money that is still owed to her** (more was taken than was owed, or a dispute was
     decided for her after all) stays in the list until she has really received it, however
     old the take-back it belongs to: the "latest ten" is a limit for what is over, never
     for what is open in either direction.
10. **Notifications (a proposal for part 12's list):** two more events, the notice of a
    take-back and our answer to an objection. On a locked screen they say only "Connect has
    written to you about your earnings". A notification is never the notice itself: the 14
    days count from the email's arrival, as today.
    *Taken up on 27 November* as part 12's decision 2a: the notice of money owed back for a
    call, and our answer to an objection, are two of the few causes that make the
    notification "Connect has written to you." (it says nothing about earnings). One about
    a contribution or a tip makes none. Once this part is built, touching one opens this
    part's screen for that take-back.
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
  field of the founder's is in any answer; one about a contribution and one about a tip
  (nothing in the list, nothing in any count, "not found" by its number, an objection
  refused as "not found", for a host who has no other take-back and for one who has); one
  about a member's call, with memberships on and off for the apps; one in the state
  "waiting" (its sentence, no day, no objection box); a lost dispute behind two amounts (the
  app reaches only the signed-in host's own); money owed to the host after too much was
  taken.
- On the Android test phone, with pictures: the list; the screen before and after an
  objection; our answer; taken; the phone offline while the objection is sent, with the text
  still there.

## Not in this part

- **A bank dispute's own page in the apps.** A host has a short time (at most 24 hours, less
  when the bank's deadline is near) to choose "Fight it" or "Give the money back" (plan 47),
  and that choice is on the website only. It is more urgent than
  anything here, and bigger. Proposed as a part of its own (16c). **The founder decided on
  27 November 2026: yes.** Its plan is written before it is built.
- **The Messages screen** in the apps (plan 49 says "phone apps later").
- **Someone who is no longer a host** has no earnings screen in the app. They have the email
  and the website.
- A host paying back what she owes through the app (not on the website either).

## Read again (27 November 2026)

By the builder of the phone apps, against `src/lib/disputes/takeback.ts`,
`takeback-words.ts`, `src/app/debts/[id]/page.tsx` and the earnings box as they are on `main`
after pull request 123. What was added:

1. *Two more causes* (plan 50, parts 1 and 2). After Astra's check: those about a
   contribution or a tip are not in the apps at all. "What is there today", decision 9, the
   check script.
2. *The state "waiting",* and that only "told" can be objected to; a debt from a lost
   dispute does not wait. "What is there today" and the check script.
3. *Decision 10's proposal* is now part 12's decision 2a.
4. Part 16 now says from its side that the two are built together, and what the earnings
   screen says if part 16 is merged first (part 16, decision 6).

Still to do before it is built: Astra's check, and one more read against the code of that
day. The sentences of each state are still written inside the website's pages, so decision
3 (one shared function) stands as written.
