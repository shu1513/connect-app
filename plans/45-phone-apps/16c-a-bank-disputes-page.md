# Phone apps, part 16c: a bank dispute's own screen

**Status:** a plan only. Written 27 November 2026 by the builder alone, from the code on `main`
after pull request 124. Part of plan 45. The founder decided on 27 November that a bank
dispute gets its own page in the apps ("yes on both"). It is built after parts 16 and 16b,
whose earnings screen it hangs on. Like every part it is read against the code once more on
the day it is built.

## For the founder: what this is

When a customer's bank takes a payment back and opens a dispute, the host is sometimes asked
what Connect should do: fight it, or give the money back. She has a short time for that, at
most 24 hours. Today she can only answer on the website. This part gives her the same page in
the app: what the dispute is about, where it stands, the two buttons while she may choose, and
what happened afterwards.

Example: Hana had a call with Tom on 3 December. On 20 December Tom's bank opens a dispute
over that payment. Hana's phone says "Connect has written to you." (part 12). She opens the
app, sees on her home screen that a bank dispute waits for her answer until 14:20 tomorrow,
reads what it is about, and presses "Fight it".

## What is there today (read in the code)

All of plan 47, built and merged. The page is `src/app/disputes/[id]/page.tsx` (483 lines),
its buttons are in `actions.ts` beside it, and the rules are in `src/lib/disputes/`.

- **Who has a page.** The host whose money the dispute is about, and the founder
  (`disputeForViewer` in `pages.ts`). The customer has none: he is told in his messages and
  reads about the payment on the page of what he paid for. Someone else's dispute and one
  that does not exist are both "not found".
- **What a dispute is about** (`ownerOf`, `aboutOwner` in `record.ts`): a call's card payment
  (also time added during the call), a membership's month, or a contribution's payment. A
  tip is a contribution here. `about.what("host", ...)` gives the words: "the payment for
  your call with Tom on 3 December", "a payment for Tom's membership with you (month 2)", and
  for a contribution or a tip words that name the project or the tip.
- **What the host's page shows.** A heading ("A bank's question about a payment" or "A bank
  dispute"); one sentence with the customer's name and what it is about; the amount; the
  bank's reason in plain words (`reasonWords` in `status.ts`); when it was opened; where it
  stands (`standingOf` gives five answers: waiting, with the bank, won, lost, closed; the
  page also tells an appeal apart, `isAppeal`, and a kind the bank takes no answer to,
  `noAnswer`). Then what it means for her money, by state, and, while the dispute is open,
  "Please do not contact the customer about it." All of these sentences are written inside
  the page.
- **The choice** (`canChoose` in `rules.ts`, `chooseAnswer` in `choose.ts`). She may choose
  only while all of this holds: it is a dispute and not a bank's mere question; the bank is
  waiting for an answer; it is one Connect asks her about (a dispute about the card network's
  own rules is left alone under a set amount, or always, as the founder has set it; and one
  the bank takes no answer to has nothing to choose); nothing was chosen or sent yet; and
  the stored moment `askUntil` has not come (at that exact moment the choice is over). When
  that moment is set, it is at most 24 hours after she is asked and, where the bank gave a
  deadline, never later than 3 days before it; sometimes there is no time to ask at all. The page shows that moment,
  says "If you do not choose by then, Connect fights it. Your first choice stands: it cannot
  be changed afterwards.", and has two buttons with a paragraph each: "Fight it" and "Give
  the money back". The press holds the dispute's row and reads the clock after it has it, so
  a press and the helper's "time is up" can never both decide. A refusal is a sentence for
  her (`ChoiceError`).
- **Afterwards** the page says what she chose, or that no choice was made in time, and what
  became of the answer to the bank (`AnswerLine`: sent, told the bank it does not contest,
  being sent, not ours, not known).
- **Money Connect takes back** after a loss is listed at the bottom of the page with the
  same objection box as on a debt's own page. In the apps that is part 16b's screen.
- **How a host gets to the page today:** from the message "From Connect" on her Messages page
  and its email (the menu shows "Messages (1)"); from her earnings box, where a share that a
  dispute holds back links to it (`disputePagesOf`), and where a take-back's row has "Read
  about this dispute". (A take-back from a dispute has no page of its own for a host: its
  address leads to the dispute's page.)
- **Only for the founder**, on the same page: what was sent to the bank, the bank's deadline,
  Stripe's number, the last error, "Allow paying again", and every button about a take-back
  except the host's own objection.
- **The apps today:** no screen for any of this. Part 12 (decision 2a, confirmed by the
  founder) makes the phone say "Connect has written to you." when a dispute over a call
  waits for the host's choice. Part 16b shows a take-back from a lost dispute, without the
  rest of the dispute.

## Decisions (the builder's; any can be changed)

1. **The host's view, and nothing of the founder's.** The app's answer is built field by
   field from what the page shows a host. Never in it: what was sent to the bank, the bank's
   deadline, the last error, the line about Stripe, and the founder's buttons. **The app
   never asks as a founder:** `disputeForViewer` lets a founder open any dispute, so the
   app's addresses always call it with "not a founder". A founder gets what any host gets:
   her own disputes, in the host's view.
2. **Which disputes: by what they are about** (the rule for the apps). A dispute over a call's
   payment is in the app. One over a membership's month is in the app while memberships are
   on for the apps, and left out while they are off. One over a contribution or a tip is
   never in the app: not on any list, not on the home screen, and asked for by its number it
   looks exactly like one that does not exist. Her way to those stays the email and the
   website. **The server decides this first, on every address:** before any detail is
   returned, before a choice is written, and before a refusal of `chooseAnswer` is passed
   on (so that "already chosen" or "the time is over" cannot be learnt about a dispute the
   app does not show).
3. **One shared function for the host's view.** The sentences that are written inside the
   website's page today (where it stands, what it means, what was chosen, what became of the
   answer, the two buttons' paragraphs) move into one function, and the page calls it. The
   app shows the same sentences. The scripts that read that page today must pass unchanged.
4. **Three addresses, on the functions that exist:** read one dispute (`disputeForViewer`,
   then decision 2); choose (decision 2 first, then `chooseAnswer` with its refusals as they
   come); and a short
   list of her disputes for the earnings screen (decision 6).
5. **Choosing asks once more.** The website's buttons act at once. On a phone a touch by
   mistake is easier, and this choice cannot be changed. So each button opens a sheet with
   the same paragraph and two buttons: "Fight it" (or "Give the money back") and "Not now".
   After a press the app reads the dispute again, whatever came back: an answer that was
   lost on the way shows as what was saved, not as an error.
6. **How she finds it in the app.** Three ways, all from the server:
   - **Her home screen says when one waits for her:** one line, "A bank dispute waits for
     your answer until [the moment].", that opens the screen. It is there only while
     `canChoose` says she may choose, for a dispute that is in the app by decision 2. The
     website has its Messages page for this; the apps show no messages "From Connect", so
     this line stands in for it.
   - **Her earnings screen** (part 16) links a share that a dispute holds back to this
     screen, as the website's box does, and gets a short list "Bank disputes": those that
     are not over, and the latest five that are. One line each: what it is about, the
     amount, where it stands. **A link is sent only for a dispute that is hers and that the
     app shows** (decision 2). The website's own lookup also finds the dispute behind a
     contribution's share; the app's answer has no link there, as "Other earnings" leads
     nowhere (part 16).
   - **The notification** of part 12, when touched, opens this screen for a dispute that
     waits for her choice, after asking the server again whether it is still hers and still
     waiting.
   And a take-back's screen (part 16b) leads here with "Read about this dispute", and this
   screen leads to each take-back of hers that part 16b lets her open, one by one (a
   dispute can stand behind several amounts; the app never passes on "the dispute's"
   take-backs as a group). The take-backs are not shown a second time on this screen.
7. **A paused host can still answer,** as on the website, where the choice needs a
   signed-in, open account and not an unpaused one: a pause must not cost her the answer to
   a bank. In the app that is the door's gate for a signed-in member. **Two different
   answers, as everywhere at the door:** a phone that is not signed in gets "not signed in"
   for every number; a signed-in person gets "not found", always the same one, for a number
   that does not exist, for someone else's dispute and for one the app does not show.
8. **Moments are shown in the phone's own time,** as part 08 does. The moment until which she
   may choose comes from the server (`askUntil`); the app counts nothing and never decides
   by its own clock whether the buttons are there. The sentence that says what the dispute
   is about holds the call's day, written for the time zone saved on her account; the app
   is sent the call's moment beside the words and writes that day in the phone's zone, so
   the two cannot name different days.
9. **No switch of its own.** Answering a bank is not a feature to be turned off. It follows
   the membership switch only in what decision 2 says.

## How it is tried

- The website's checks unchanged and green: `disputes-check`, `dispute-answers-check`,
  `dispute-takeback-check`, and the automatic tests.
- A new check script for the app's addresses, `scripts/app-disputes-check.ts`:
  - a host reads her own dispute over a call in each state (a bank's question; waiting for
    her choice; waiting but left alone; one the bank takes no answer to; with the bank; an
    appeal; won; lost; closed), with the sentences the website's page has;
  - no field of the founder's is in any answer;
  - the customer of the dispute and another host get "not found", the same as for a number
    that does not exist; a phone that is not signed in gets "not signed in"; a founder who
    is not this dispute's host gets "not found" too;
  - a dispute over a contribution and one over a tip: "not found" by its number, in no list,
    no line on the home screen, no link from the earnings screen, and choosing refused as
    "not found" whatever its state (open, already chosen, time over);
  - a dispute over a membership's month with memberships on for the apps (there) and off
    (as if it did not exist);
  - choosing "fight" and "give back"; choosing twice; a choice that is neither; choosing
    after the moment has passed, and for a dispute nobody is asked about (each refused with
    its sentence, nothing changed);
  - the home screen's line appears only while she may choose, and goes when she has chosen
    or the time is over;
  - the earnings screen's list: open ones first, at most five that are over;
  - a paused host reads and chooses.
- On the Android test phone, with Stripe's test mode and pictures: a dispute made with
  Stripe's test card for disputes, from the line on the home screen to the screen, the sheet,
  the choice, and the screen afterwards; a lost dispute with its way to the take-back; the
  screen in the dark look and with large text.

## What cannot be tried here

A real bank, and how long it takes to decide. An iPhone, until the iPhone build exists (part
20).

## Keeping the 4.9%

Nothing is sold and nothing is paid here. Decision 2 is the point to watch: a dispute over a
contribution or a tip must not reach a phone in any form, and the check script reads every
answer for that.

## Not in this part

- The founder's side of a dispute.
- The customer's side: he has no page on the website either.
- Messages "From Connect" as a screen of their own in the apps. The home screen's line and the
  notification stand in for the one message that has a deadline.
- Money taken back after a lost dispute: part 16b.

## For the day it is built

From Astra's check; none of it changes a decision above.

- Try a dispute over a membership's month in all three positions of the apps' switch, and a
  change of the switch between the notification arriving and its being touched.
- Try the exact moment `askUntil`, and a choice that was saved while its answer never reached
  the phone.
- Read the shared wording of "Give the money back" against part 16b: the 14 days before
  anything is taken run from the confirmed arrival of the notice's email.

## Astra's check (27 November 2026): "ready with changes", worked in

1. *The app must never ask as a founder, and must sort disputes out before it passes on a
   refusal.* Decisions 1 and 2.
2. *A link is itself about what it leads to.* Decision 6: no link for a dispute the app does
   not show, and take-backs one by one.
3. *An objection the founder typed in for the host is stored where her own would be.* Part
   16b, decision 4a, corrected in the same change.
4. *Part 12 named only one screen a notification can open.* Its decision 2a now names this
   one too.
5. *"Not signed in" and "not found" are two answers.* Decision 7 and the check script.
6. Smaller: how the page tells states apart, the exact moment the choice ends, where "Read
   about this dispute" is, and the call's day in the phone's own time. "What is there
   today"; decision 8.
