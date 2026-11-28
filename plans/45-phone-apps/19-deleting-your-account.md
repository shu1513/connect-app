# Phone apps, part 19: deleting your own account (the request, the lock, and coming calls)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. It
carries out plan 39, decision 10. Astra checked it twice ("not ready" both times); after the
second check it is three parts (this one; 19b, settling money; 19c, the wiping) and every
point is worked in (the lists are at the end). The founder: "of course." Brought up to date
on 27 November 2026, after the website changed (that list is at the end too). **Like parts
19b and 19c it goes to Astra again before it is built:** much of what a deleting person can
have did not exist when it was written.

## For the founder: what this is

A person deletes their own account, for good, on the website and in the app. Apple and Google
both require it of any app in which an account can be made; Google also wants a page on the
website for it. Today only you can close an account, and closing is a lock that can be undone
and keeps almost everything.

It is built in three parts, and **the "Delete my account" button is shown to nobody until all
three are merged** (it sits behind a switch of yours that is born off). This part is the
first: taking the request, locking the account, and deciding what happens to coming calls.

## What is there today (read in the code)

- `closeAccount` in `src/lib/profiles/closing.ts`: first it marks the account closed and
  saves that; signs it out everywhere; suspends the host profile; ends memberships and
  contributions; deletes the photo (a photo the founder locked is kept). **Then,** in a
  second go that is allowed to fail and only counts what it could not do, it ends waiting
  requests and cancels coming calls **as the founder would, always free**, and takes the
  person out of a call in progress. Run a second time it refuses ("already closed"), so what
  failed is not tried again by itself. It refuses an admin's account. `reopenAccount` only
  lifts the mark.
  *As it is on 27 November:* the founder's closing now takes a reason and tells the person
  by email in the same step (plan 46, decision 11), and one of the reasons is "at the
  person's own request": that is how an account is closed for someone who asks today. The
  helper also looks about once a minute for requests and calls that a closure or a pause
  left behind and ends them (`finishPausesAndClosures`), so those are tried again by
  themselves now. A closed account's memberships and monthly contributions still end at
  once and for good (a *paused* account's are only paused, plans 53 and 54).
- **What a person can have that did not exist when this was written:** conversations with
  hosts or customers (plan 49); messages "From Connect"; money a host owes back, with a
  notice, a deadline and perhaps her objection (plans 46, 47, 50); a bank dispute, open or
  lost, as customer or as host; a request to cancel a membership within 14 days that is on
  record and not finished (plan 46, part 3c); a membership paused with an account; a
  warning about ratings, or a pause the app made (plans 52 and 53); a stop on new payments
  after a lost bank dispute (plan 47); tips given or received; recorded acceptances of the
  legal documents.
- Many places already refuse a closed account: signing in (`src/lib/auth.ts`), the gate of
  every page (`src/lib/session.ts`), asking for and accepting a call
  (`src/lib/booking/bookings.ts`).
- Ended memberships are cleaned up by the helper, which also cancels a member's coming calls
  **as the founder, free** (`src/lib/membership/ending.ts`). What a cancellation costs depends
  on the moment it happens (`src/lib/payments/cancel.ts`): free now can be a late charge some
  minutes later, and a call that has started cannot be cancelled at all.

## Decisions (the builder's)

1. **A request to delete is always taken, at once, and dated.** Never "come back later": not
   when money is still waiting, and not during a call.
2. **The lock is the one that exists.** A deleting account is marked closed, so every gate
   that already refuses a closed account refuses it, with no new gate to forget; and it
   carries a second mark, "deleted by its owner", with the date, that never comes off. The
   founder's "reopen" refuses an account with that mark. If the person is in a call at that
   moment, that one call is allowed to finish, and nothing else.
2a. **Every piece of code that tidies up after a closure is taught the difference** *(added
   27 November, after Astra's check)*. Today's closing signs the person out everywhere,
   cancels every coming call for free, puts the person out of a call in progress, and ends
   memberships on both sides; and the helper repeats that about once a minute for anything
   left over (`closeAccount`, `endRequestsAndCallsOf`, `finishPausesAndClosures` in
   `src/lib/profiles/closing.ts`, and the membership clean-up). If a deleting account were
   only "marked closed", that code would undo what decisions 2 and 5 promise within a
   minute: it would end the one call that may finish, and cancel for free a call whose late
   charge was agreed. So for an account that carries the mark "deleted by its owner", each
   of those pieces carries out what was written down per call (decision 5) and nothing
   else, leaves the one call in progress alone, and leaves that person the way to end or
   report that call. One place decides it, and all of them ask it. Tried also with the
   helper stopped and started again between the confirmation and the cancelling.
3. **Before confirming, the person is shown what will happen now and cannot be undone,** with
   their own numbers: which coming calls are cancelled and what each costs or gives back;
   which memberships end; what a host is still owed and how it will reach her (part 19b);
   what is wiped and what is kept and for how long (part 19c); and how long it takes.
   *Added 27 November, and narrowed after Astra's check:* the screen also covers money she
   owes back, an open bank dispute, her conversations (they close, and the other person
   sees "a deleted account") and a membership still inside its 14 days (decision 6a). **How
   much of that is shown depends on where she is.** On the website the screen shows all of
   it, with her own numbers. In the app it shows her own numbers only for calls (and for
   memberships while they are on for the apps), **and this is the whole list:** the coming
   calls and what each costs or gives back, the memberships that end, and what is ready and
   what is waiting of her earnings from calls as it stands at that moment. No debt and no
   dispute is among them, about a call or about anything else: those are in the general
   sentences here and with their details on the website and by email. What will really be sent, refused or
   still be on its way afterwards is not known yet and is on no screen; it comes by email
   (part 19b, decision 4); for everything else it shows sentences that
   every person sees alike, whatever they have: that deleting cancels no debt and stops no
   bank dispute, that some past payments can still be disputed by a customer's bank, and
   that the full list for her account is in the email she is sent and on the website's
   page. Nothing on the phone may appear only because of a contribution or a tip.
4. **Confirming:** with the password (and the two-step code if there is one). An account
   without a password (made with Google) is sent a link that works once and for a short
   time; opening it only shows the same final screen, and the deletion needs a deliberate
   press there. Opening the link by itself deletes nothing.
5. **At the moment of confirming, the costs are worked out again.** If any has changed since
   the screen was shown (a free cancellation has become a late one), nothing is done and the
   new numbers are shown, to be confirmed again. **What was agreed is then written down for
   each coming call, as of that moment:** free, or a late charge of so much, or membership
   time used or given back. Whoever carries the cancellation out, the helper minutes later
   included, carries out what was written down, not what the clock says by then.
6. **By whose rules:** a customer's call as if they had pressed Cancel; a member's call as a
   member's own cancellation; a host's calls free for her customers. The helper's clean-up of
   memberships reads what was written down instead of cancelling "as the founder, free".
6a. **A membership still inside its 14 days** *(added 27 November; rewritten after Astra's two
   checks; the builder's)*. Cancelling within 14 days is the **member's** right and nobody
   else's.
   - **First, whatever is already on record.** A request made in time stays a request made
     in time, whenever the account is deleted: a member who pressed on day 14, was stopped
     by a bank, and deletes on day 15 has no button any more but still has that request,
     with its month, its moment and who made it. The deletion starts from such a request
     and treats that month's coming calls the 14-day way. Only then does it look whether a
     new one can be made.
   - **The member deletes their account, and the 14-day way is open** (`ownFourteenDays`
     says so). Their request is written down at the moment of confirming, through the same
     first step the button uses, on the last day too. The helper finishes it as it finishes
     any such request. **The calls booked from that membership are cancelled the 14-day
     way**, by Connect and without a late charge, and the screen before confirming shows
     them so; they are not put through the member's own cancelling of decision 6, which
     could charge one that is close. What is paid back is paid back once. The ordinary
     ending does not touch that membership before the request is finished.
   - **The member deletes their account in time, but a rule stops the 14-day way just now**
     (their bank is looking at the month, or its payment has a problem), whether or not a
     request is already on record. The button's own step would refuse and write nothing,
     and the ordinary ending would then clear the month. So the deletion itself writes
     down, together and with its moment: which month it is about, that the member asked
     within the 14 days, and what happens to that month's coming calls. **Those calls are
     cancelled the 14-day way here too,** by Connect and without a late charge, and shown so
     before confirming: a member with a payment problem and a call in two hours is not
     charged for that call as a late cancellation of his own. Money a bank has frozen stays
     frozen for the settling. The month is left as it stands until a person at Connect has
     settled the case, and the rest of the deletion goes on.
   - **The same holds when a bank dispute has already ended the membership** and its current
     month is no longer marked on it: the case is found from the month's own records, not
     only from a membership that still shows a button. Whether that month was the first
     month of a first joining is judged as it was for that month (a dispute over an old
     month can end a later, different membership of the same two people, which has no such
     right).
   - **The host deletes her account.** Nothing is asked in a member's name. A request a
     member of hers has on record is kept and finished first; her other memberships end as
     decision 6 says.
   Each membership that waits like this is "a named open case" for part 19c.
6b. **A paused account can delete itself** *(added 27 November; the builder's)*. Both stores
   ask that every account can be deleted. What Connect keeps about the pause is part 19c's
   table; deleting does not lift a pause, and the mark "deleted by its owner" sits beside it.
   The pause's own mark stays on the emptied row; its reason, which is free text, does not
   (part 19c, decision 1).
6c. **Conversations close at the lock** *(added 27 November)*: nothing more can be written
   to or by a deleting account, through the same rule that already stops a closed one.
6d. **A bank dispute that waits for her choice** *(added 27 November; put exactly after
   Astra's second check)*. A host is sometimes asked how a bank dispute should be answered.
   Whether she is asked, and until when, is what the server has stored for that dispute
   (`askUntil`, `canChoose`): at most 24 hours from the moment she is asked, less when the
   bank's own deadline is near, sometimes not at all; and that moment can come days after
   the dispute first appeared, when a bank's question turns into a dispute. If she is asked
   and does not choose, Connect sends its proof. Once her account is locked she cannot sign
   in to choose. So the website's confirmation screen shows each dispute that waits for her,
   with that stored deadline and what happens without a choice, and lets her choose there.
   **It is looked up again at the moment she confirms:** if a dispute has begun to wait for
   her since the screen was drawn, nothing is locked and the screen is shown again. **That
   second look is the website's.** In the app the screen before deleting says to every
   host, in the same words, that anything Connect has asked her to answer by a deadline
   must be answered on the website first, and she ticks that she has read it. The press
   then goes through or fails for reasons that have nothing to do with disputes: the same
   fields, the same screens and the same result whether a dispute has begun to wait
   meanwhile or not, and whatever it is about. A host who deletes from the phone in that
   moment gets the default (Connect sends its proof). Deleting never changes the default.
7. **There is no "keep my account" afterwards.** Calls cancelled, memberships ended and a
   photo deleted cannot be brought back. The screen says "this cannot be undone" once,
   clearly, before the confirmation, and means it.
8. **The work is written down step by step and finished by the helper.** If anything stops
   halfway, the helper carries on from the last finished step until everything is done, and
   never does a step twice.
9. **Where it is:** "Delete my account" at the bottom of the account page, on the website and
   in the app. The website's page has a plain address of its own that says what it is, so it
   can be the page Google wants linked from the store listing; it asks the person to sign
   in, and works without the app. An admin's account is not deleted this way. The founder's
   own "close" stays as it is.

## How it is tried

- A new check script, `scripts/delete-account-check.ts`: a customer with nothing; with a call
  inside the late-cancel time and outside it; a cancellation that turned from free to charged
  between the screen and the press (shown again), and between the press and the helper (the
  written outcome holds); a member with a booked call while the membership clean-up runs at
  the same moment, both ways round; a host with coming calls; during a call (that call
  finishes, nothing else can start); a stop in the middle of each step; an admin (refused);
  a wrong password; an account without a password, the link opened twice and after its time;
  a member on day 5 of a new membership (cancelled the 14-day way, with its pay-back), and
  one with a 14-day request already on record; a member whose membership is paused with an
  account; a paused account (it can delete, and stays paused in the record); a host who owes
  money back and one with an open bank dispute (both shown, with their details, on the
  website's screen before confirming; in the app, the general sentences and no entry);
  a person with a conversation (closed, and nothing can be sent either way); the helper's
  once-a-minute tidying-up run against a deleting account before, during and after its
  cancellations (the call in progress goes on, a call with an agreed late charge is charged
  it, nothing is cancelled twice); a host who deletes while a member of hers has a 14-day
  request on record (it is finished the 14-day way, and none is made for any other member);
  a member whose 14-day request is stopped by a bank (the deletion goes on, the request
  waits); a member inside the 14 days, with nothing on record, whose month a bank is
  looking at (the deletion writes the dated case, and the month is not cleared); a member
  inside the 14 days with a call in two hours (cancelled the 14-day way, no late charge),
  once with the way open and once with a payment problem on the same month; a member whose
  membership a bank dispute already ended inside the 14 days; a dispute that begins to wait
  for a host between the screen and the press (on the website: shown again, nothing locked;
  in the app: the press and its answer are the same, field for field, as with no dispute,
  for a dispute about a call and for one about a contribution); a stop in the middle of
  each step of decision 8, carried on by the helper without doing any step twice; a host with a dispute waiting for her choice (the website's screen shows the
  deadline and takes the choice); and, in the app, a host whose only money, debt or dispute
  comes from a contribution or a tip: her screen is word for word that of a host with
  nothing;
  the founder's "reopen" refused; every gate that refuses a closed account also refuses this
  one (signing in, asking, accepting, joining another call).
- Every existing check script unchanged and green, since the founder's closing is not changed.
- On the website in a browser and on the Android test phone, with pictures (with the switch
  on in the test database only): the screen before confirming, with real numbers.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

May a late cancellation be charged when the cancelling happens because the customer deletes
their account (already there from plan 39)?

## Keeping the 4.9%

No purchase. Both stores require this; without it the app would be refused whatever its
payment rules.

## Astra's first check (20 November 2026): "not ready", worked in

1. *Refusing to delete while money is waiting cannot work.* The request is always taken.
2. *A step that fails is never tried again today, and the helper cancels a member's calls for
   free.* Decisions 6 and 8.
3. *"Keep my account" could not keep anything.* Removed.
4. *Google's page must be recognisable and work without the app.* Decision 9.

## Astra's second check, the same day: "not ready", worked in

1. *A mark of its own would have left the existing gates treating the person as open.*
   Decision 2: the existing lock, plus a mark that never comes off.
2. *The helper, running minutes later, could turn a free cancellation into a late charge.*
   Decision 5: checked again at the press, and written down per call.
3. *An emailed link must not delete by being opened.* Decision 4.
4. *Still too big for one pull request.* Settling money is now part 19b, and nobody sees the
   button until all three parts are in.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *The founder's closing now tells the person why, and the helper finishes what a closure
   left behind.* "What is there today".
2. *A deleting person can have many things that did not exist on 20 November* (the list in
   "What is there today"). Decision 3 shows them before confirming; decisions 6a, 6b and 6c
   say what happens to a membership inside its 14 days, to a paused account and to
   conversations. Money owed back and disputes are part 19b's; what is wiped is part 19c's.
3. *Nothing here is settled by a second check yet.* This part, 19b and 19c go to Astra
   together before any of them is built, and are read against the code of that day.

## Astra's check of this update (27 November 2026): "not ready", worked in

1. *The screen before confirming could show something only because of a contribution or a
   tip.* Decision 3: in the app, own numbers for calls only, and general sentences for the
   rest.
2. *Today's closing and its helper would undo the agreed outcomes and end the call in
   progress.* Decision 2a.
3. *The 14-day rule could act in the wrong person's name, or lose a request made in time.*
   Decision 6a, rewritten.
4. *A host locked out could no longer make a choice a bank dispute was waiting for.*
   Decision 6d.

## Astra's second check (27 November 2026): "not ready", worked in

1. *A member who is inside the 14 days but stopped by a bank, with nothing on record, fell
   through.* Decision 6a: the deletion writes the dated case itself.
2. *Coming calls of such a membership would have gone through the member's own cancelling,
   which can charge.* Decision 6a: the 14-day way.
3. *The time for a bank dispute's choice is the stored one, and can begin later.* Decision 6d,
   with a second look at the press.

## Astra's third check (27 November 2026): "not ready", worked in

1. *Decisions 7, 8 and 9 had been cut out by mistake in the second round's edit.* Restored,
   word for word.
2. *A stopped 14-day case protected the month but left its calls to the ordinary rule,* and
   missed a membership a bank dispute had already ended. Decision 6a.
3. *The second look at a dispute would have shown, on a phone, that something had changed.*
   Decision 6d: that look is the website's; the app's press is the same for everyone.
4. *The app's own figures at confirming are what stands then, not what is sent later.*
   Decision 3.
5. *A paused account that deletes itself:* the mark stays, the typed reason goes. Decision 6b.
