# Phone apps, part 13c: cancelling a new membership within 14 days

**Status:** a plan only. Written 26 November 2026 by the builder of plan 46 (the agreements), on
the founder's word of that day, from the code on `main` after pull request 106. Part of plan 45.
**Not yet checked by Astra:** like every part of plan 45 it is read against the code once more,
and shown to Astra, just before it is built. The phone-apps build is paused before part 09b on
the founder's word; this plan does not change that, and nothing is built from it yet.
Read again on 27 November 2026 by the builder of the phone apps, against the code on `main`
after pull request 123 (the list is at the end).

## For the founder: what this is

On the website a new member can take a membership back within 14 days with one button (plan
46, part 3c). The apps have no membership screens yet (that is part 13), so they have no such
button either. This part puts the button on the membership's screen that part 13 builds. Same
rule, same sentences, same outcome, because the same piece of the server does it.

## What the founder said

- 26 November 2026, about the right itself: every member has the 14 days, wherever they live,
  and presses the button themselves ("everyone, do what you think is the best").
- 26 November 2026, about this gap in the apps: "let the mobile session know about it and
  build the plan for it".

## What is there today (read in the code)

All of it is in `src/lib/membership/fourteen-days.ts` (plan 46, part 3c; the full account is in
`plans/46-part-3-money-owed.md`, "Part 3c, as built").

- **Who has the button.** `ownFourteenDays(membership, now)` answers with the last day, or with
  nothing. It is open for the first membership of these two people (not a resumed one, not a
  second one), in its first month, once the bank has authorised that month (held or taken),
  with no problem on the payment and no bank question, through the whole of the 14th day
  after the day of joining. Days are counted in UTC. Since 26 November 2026 it also stays
  open after the last day while a request made in time is on record and not finished; the
  answer then carries the day that request counts from (`asked`). If a rule stops such a
  request for now, the answer has no last day (no button) but carries `asked` and the
  sentence for what stops it (`blockedBy`): the screen shows that sentence.
- **What pressing does.** `cancelWithin14Days({ membershipId, by: { as: "member", memberId },
  shownMonthId })`: a first look, which writes the request down if it passes every rule; then
  the calls booked from the membership that are still to come are cancelled; only then the
  membership ends, at once and for good.
  What was only held is let go; what was taken goes back to the card, except time that was
  used and a call that was charged under the booking's terms. The member gets one email that
  lists what stays paid for.
- **Refusals** come as a `MembershipError` with a sentence written for the member
  (`WHY_FOR_MEMBER`, `DAYS_OVER_FOR_MEMBER`, `MOVED_ON`). None of them names a button.
- **"Not finished yet"** is not a refusal: `NotFinishedYet` (`CALLS_NOT_CANCELLED`,
  `BEING_TAKEN`). The request is on record and the helper finishes it. The button usually
  stays; it goes if a bank or a problem with the payment stops the request meanwhile, and
  the request then waits for a person at Connect. Two presses at the same moment can both
  come back as done, with the request finished once. Its
  sentence says "you can also press again in a minute", which is true in the app too.
- **Pressed twice:** the second press finds the membership ended and is refused. Nothing is
  paid back twice.
- **The website's page** (`src/app/memberships/[id]/page.tsx`) draws the button under "Cancel
  membership", with a paragraph that explains it. That paragraph is written inside the page.
  The form carries the month it was drawn for (`cancelWithin14DaysAction` in `actions.ts`).
- **The sentence a person ticks before joining** (`agreementSentences` in
  `src/lib/membership/wording.ts`, wording version "2026-11-26") promises the button "on your
  membership's page".
- **The founder's form** for a request that came in writing is on the admin page. Website only.
- **A paused membership has no button** (`fourteenDayCase` answers "paused"). Since plan 53
  that includes a membership paused with one of the two accounts inside its first 14 days:
  the pause cancels the coming calls and pays the unused time back to the card, which is
  what the button would have done. (That tidying-up can still be running when the screen
  is read, and a month a bank is disputing stays frozen; the screen says what the server
  says of the money, never "paid back" before it is.) One that is resumed afterwards counts as
  resumed, and has no button either.

## Decisions (the builder's; any can be changed)

1. **No app that lets a person join without this button.** The sentence ticked before joining
   promises it "on your membership's page", and in the app that page is the app's screen. So
   this part is built together with part 13, or straight after it, and the apps' switch for
   memberships stays "off" until it is merged. The simplest way is to fold it into part 13
   when part 13 is read against the code.
2. **The button is there in every position of the apps' switch,** "off" included. It is a way
   of cancelling, and part 13, decision 2, says a member can always cancel. (Someone who
   joined on the website must find it in the app too.)
3. **The server decides whether the button is shown.** The answer for the membership's screen
   says: open or not, the last day, the month it is for, and the sentences. The app counts no
   days and knows no rule.
4. **One set of words.** The explaining paragraph moves out of the website's page into one
   shared function, and the page calls it. The app shows the same sentences. The website's
   checks must pass unchanged (`membership-journey-check` reads that page).
5. **One address for pressing,** named to fit part 13's addresses. It calls
   `cancelWithin14Days` for the signed-in person, with the month the app was shown. It needs
   no once-only key: a second press is refused by the function itself.
6. **The app asks once more.** A sheet with the server's sentences: it ends the membership at
   once and for good, coming calls are cancelled, and what stays paid for (time that was
   used, and a call that was charged under the booking's terms, such as one cancelled late
   or missed), with the rest going back to the card. The sentences are the server's, whole;
   the app shortens none of them. **Before the press the sheet says the rule, as the
   website's paragraph does** (a call that has already begun is worked out as usual); it
   cannot say how many such calls there are or what they come to, because that is only
   worked out during the cancelling. **After the press** the outcome that was recorded
   reaches the member where decision 8 says: the email. Where the month was only held and never taken, nothing is
   "paid back": the hold is let go, and the sentence says that, as the website's does. Two buttons: "Cancel within 14 days" and "Keep my membership".
7. **After pressing, the app reads the membership again, whatever came back.** A refusal is
   shown as the sentence the server sent. If the answer was lost on the way and the membership
   has ended, the app shows that it ended, not an error. If a call could not be cancelled just
   now, the sentence says so, and that the request is on record. Whether the button is still
   there is, as always, what the server says on that next read (see "A gap found while
   planning").
8. **Afterwards** the membership's screen shows it as ended, with its reason. The list of what
   stays paid for is in the email; the app does not work it out again. The cancelled calls
   show as cancelled in the calls list (part 08).
9. **No notification of its own** (part 12): the person pressed it themselves. The host
   learns of it by the email that the ending of a membership with a member in it sends her. Her list of members
   holds no ended memberships, on the website or in the app (part 13b).
10. **The founder's form stays on the website.**

## Keeping the 4.9%

Giving money back is not buying. Nothing here adds a way to pay. Two points to watch when it is
built:

- Every sentence this function can send (the paragraph, the refusals) is read once for words
  that only fit the website. Today none names a button, and "on your membership's page" is
  true in the app once this part is built.
- The paragraph says that to come back "you would need a new invitation" from the host. In the
  middle position of the apps' switch nothing in the app may say where to join. That one
  sentence is looked at for that position, and the server leaves it out there if needed.

## How it is tried

- The website's checks unchanged and green: `member-calls-check --only=11`,
  `membership-journey-check`, the automatic tests.
- The part's check script for the app's addresses: the screen's answer carries the button only
  when the case is open (day 15, a resumed membership, a second one, a first month that ended,
  a bank question, a payment with a problem, the card step, a membership paused with an
  account on day 3, and the same one resumed later: each without it); a stranger's
  press changes nothing and looks like "not found"; a press that names another month changes
  nothing; her own press ends it, with the coming calls cancelled first; pressed twice. Then
  all of it once more in each position of the apps' switch.
- On the Android test phone, with Stripe's test cards and pictures: the button and the sheet;
  a month that was only held; a month that was taken, with one used call; day 15 (no button);
  a refusal's sentence; the phone offline during the press, then the screen read again.
- The case of "A gap found while planning": a press on the last day that fails part-way
  through cancelling the calls, then a press after the last day. The screen must still show
  the button after the last day, with the day the request counts from, and the second press
  must end the membership. (The website's check plays it in `member-calls-check`, journey 11.)

## A gap found while planning (fixed on the website, 26 November 2026)

CodeRabbit found it in this plan's review. A press on the last day could fail part-way: some
coming calls were cancelled, one could not be, and the membership was not ended. The member was
asked to press again. If the next press came after the last day (UTC), it was refused as too
late, and the button was gone. The member had pressed in time, and was left with cancelled
calls and a membership that ran on.

**Fixed** in the piece of the server the app will use too (`fourteen-days.ts`; the account is at
the end of `plans/46-part-3-money-owed.md`, "A gap closed afterwards"):

- The first press that passes every rule is written down on the membership, with its moment,
  before any call is cancelled.
- A later press counts from that moment, also after the last day. Every other rule is asked
  again at the later press.
- The helper finishes such a request by itself, so the member need not press again at all.
- `ownFourteenDays` keeps answering "open" while such a request is not finished, with the day
  it counts from, so the button stays on the screen. The exception: while a bank's
  question or a problem with the payment stops the request, there is no button; the screen
  says that the request is on record and what stops it, and it waits for a person at
  Connect.
- The founder's Memberships page lists what is not finished and what stops it.

**For this part, when it is built:** nothing more to settle. The app shows the button whenever
the server says it is open, and shows the server's sentence about the request on record where
the website shows it. The app counts no days.

## Not in this part

- The founder's form, and a cancellation by hand after the first month ended.
- The same rare moment for other endings (a call that starts between an ending and its
  clean-up), which plan 46 names and leaves.

## Open point

The website says "until the end of 9 December (UTC)". On a phone that is hard to read. The
server could send the moment instead, and the screen could show it in the phone's own time. A
proposal for the build, for the website and the app alike; not decided.

## Read again (27 November 2026)

By the builder of the phone apps, against `src/lib/membership/fourteen-days.ts` as it is on
`main` after pull request 123. The plan matches the code: `ownFourteenDays` answers with the
last day, a request on record, and the sentence for what stops it. What was added:

1. *A membership paused with an account* (plans 53 and 55) has no button, and why that is
   right. "What is there today" and the check script.
2. Part 13 now says the same as decision 1 here, from its side (part 13, decision 7).

Still to do before it is built: Astra's check, and one more read against the code of that
day.

## Astra's checks of this update (27 November 2026), worked in

1. *What stays paid for is more than "used time".* Decision 6: the server's sentences, whole,
   with the case of a month that was only held.
2. *The host does not read the ending in her list.* Decision 9.
3. *A pause does not mean the money is already back.* "What is there today".
