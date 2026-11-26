# Phone apps, part 13c: cancelling a new membership within 14 days

**Status:** a plan only. Written 26 November 2026 by the builder of plan 46 (the agreements), on
the founder's word of that day, from the code on `main` after pull request 106. Part of plan 45.
**Not yet checked by Astra:** like every part of plan 45 it is read against the code once more,
and shown to Astra, just before it is built. The phone-apps build is paused before part 09b on
the founder's word; this plan does not change that, and nothing is built from it yet.

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
  after the day of joining. Days are counted in UTC.
- **What pressing does.** `cancelWithin14Days({ membershipId, by: { as: "member", memberId },
  shownMonthId })`: a first look that writes nothing; then the calls booked from the membership
  that are still to come are cancelled; only then the membership ends, at once and for good.
  What was only held is let go; what was taken goes back to the card, except time that was
  used and a call that was charged under the booking's terms. The member gets one email that
  lists what stays paid for.
- **Refusals** come as a `MembershipError` with a sentence written for the member
  (`WHY_FOR_MEMBER`, `DAYS_OVER_FOR_MEMBER`, `MOVED_ON`, `CALLS_NOT_CANCELLED`). None of them
  names a button.
- **Pressed twice:** the second press finds the membership ended and is refused. Nothing is
  paid back twice.
- **The website's page** (`src/app/memberships/[id]/page.tsx`) draws the button under "Cancel
  membership", with a paragraph that explains it. That paragraph is written inside the page.
  The form carries the month it was drawn for (`cancelWithin14DaysAction` in `actions.ts`).
- **The sentence a person ticks before joining** (`agreementSentences` in
  `src/lib/membership/wording.ts`, wording version "2026-11-26") promises the button "on your
  membership's page".
- **The founder's form** for a request that came in writing is on the admin page. Website only.

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
   once and for good, coming calls are cancelled, used time stays paid for, the rest goes
   back to the card. Two buttons: "Cancel within 14 days" and "Keep my membership".
7. **After pressing, the app reads the membership again, whatever came back.** A refusal is
   shown as the sentence the server sent. If the answer was lost on the way and the membership
   has ended, the app shows that it ended, not an error. If a call could not be cancelled just
   now, the sentence says so and the button is still there.
8. **Afterwards** the membership's screen shows it as ended, with its reason. The list of what
   stays paid for is in the email; the app does not work it out again. The cancelled calls
   show as cancelled in the calls list (part 08).
9. **No notification of its own** (part 12): the person pressed it themselves. The host
   learns of it as of any ending (part 13b shows the reason as it comes).
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
  a bank question, a payment with a problem, the card step: each without it); a stranger's
  press changes nothing and looks like "not found"; a press that names another month changes
  nothing; her own press ends it, with the coming calls cancelled first; pressed twice. Then
  all of it once more in each position of the apps' switch.
- On the Android test phone, with Stripe's test cards and pictures: the button and the sheet;
  a month that was only held; a month that was taken, with one used call; day 15 (no button);
  a refusal's sentence; the phone offline during the press, then the screen read again.

## Not in this part

- The founder's form, and a cancellation by hand after the first month ended.
- The same rare moment for other endings (a call that starts between an ending and its
  clean-up), which plan 46 names and leaves.

## Open point

The website says "until the end of 9 December (UTC)". On a phone that is hard to read. The
server could send the moment instead, and the screen could show it in the phone's own time. A
proposal for the build, for the website and the app alike; not decided.
