# Connect: record of recommendations and what was built

This is the running record for each module: what was recommended, what the founder decided, what was
actually built, what the reviewers found, how it was checked, and what is still open. It is updated
when a module is merged. The full plan for each module is in `plans/`.

**How each module is made** (the founder's flow):
1. A plan is written with recommendations for each decision. Astra (a second AI reviewer) checks the recommendations. For modules 1 to 4 the founder approved the decisions; from module 5 on, the founder has asked the builder to make the final decisions and record them here.
2. The code is built on its own branch.
3. Astra reviews the code. Only findings that are worth it are fixed; nothing is over-built.
4. CodeRabbit (an automatic reviewer on GitHub) reviews the pull request. Worthwhile findings are fixed.
5. When all automatic checks are green, it is merged.

**Status at a glance**

| Module | Status |
| --- | --- |
| 1. Video call and time tracking | Built and merged. Real two-device tests still needed. |
| 2. Payments | Built and merged (Stripe test area only). |
| 3. Accounts and profiles | Built and merged. |
| 4. Calendar and booking | Built and merged. |
| 5. Safety | Built and merged. Needs a restricted Stripe key to read ages (founder must be logged in to Stripe). |
| 6. Notifications | Built and merged. Real sending needs the Resend account (founder). |
| 7. "Available now" calls | Built (in review). Extending a call deferred to module 7b. |
| 8. Ratings, notes, contacts, search; messaging | Not started. |
| Final pass: joining everything together | Not started. |

---

## Before the modules: the big choices

| Question | Recommended | Decided | Why |
| --- | --- | --- | --- |
| Video service | LiveKit Cloud | LiveKit Cloud | Good quality in the US, Europe, South America and Australia; fair price; we can move to our own servers later. Astra's separate research reached the same answer. Daily is to be compared with the same checklist later. |
| Build the calendar ourselves or buy one | Build it | Build it | It is tied to our own payment and time rules. |
| Language and framework | TypeScript with Next.js | Same | One language for the whole app; investigated against Express and confirmed. |
| Database | Postgres | Same | Reliable for money and bookings. |
| Login tool | Better Auth | Same | Does sign-up, Google, email confirmation and two-step login without us writing security code. |
| Payments | Stripe Connect | Same | Lets us charge after the call and pay hosts later. |
| Automatic reviewers | CodeRabbit and Greptile | CodeRabbit only | Greptile is billed for this project, so it is only used if the founder asks. |
| Where the code lives | Public GitHub project, "all rights reserved" licence | Same | Public gives free automatic reviews; the licence keeps ownership. |

---

## Module 1: Video call and time tracking

**Plan:** `plans/01-video-call.md`

**What was recommended and decided**
- Build the video call with trustworthy time tracking first, because everything else depends on it. Agreed.
- Every call gets three numbers (host time, customer time, time together), so any pricing rule can be applied later. Agreed.
- The room opens 5 minutes before the start and closes 1 minute after the end; only time inside the booked window counts. Agreed.
- One person, one connection per call (a second tab takes over). No recording. Agreed.
- If the record of a call is incomplete or contradicts itself, never guess: mark it "needs review". Agreed.

**What was built**
- A private one-to-one video call that only the two people on the call can enter, and only while the room is open.
- A log of every "joined" and "left" message from LiveKit, checked for authenticity, and a counting rule that turns it into the three numbers.
- An always-on helper that closes each room at its end time and makes sure nobody can get back in.
- A results page for each call.

**What Astra found in the code (all fixed)**
- Closing a room hid errors; time was invented for people still connected; the watch window was counted from the scheduled rather than the actual close; the raw message was not stored exactly; the test tool only worked for long calls.

**How it was checked**
- Automatic tests for the counting rule and the entry rules. A real call joined through LiveKit, real messages received, the room closed automatically and re-entry refused.

**Still open (needs the founder and a second device)**
- Two people on camera at once, phones, a full 60-minute call, and the comparison with Daily.

---

## Module 2: Payments

**Plan:** `plans/02-payments.md`

**What was recommended, and what the founder decided**

| Topic | Recommended | Decided |
| --- | --- | --- |
| Our fee | First proposal: 20% | **Changed by the founder:** minimal, just covering costs: 4.9% + 30 cents per paid call, + 1.5% for a card from outside the US, + 25 cents per payout. Taken from the host's share. |
| Stripe's $2 a month per paid host | Pass it to hosts | **Changed by the founder:** the company absorbs it, so hosts are not put off. |
| What the customer pays for | The time the host was connected inside the booked time; no free waiting minutes | Agreed. Shown clearly before paying; the receipt separates time together from waiting. |
| Cancelling | One rule set by us | **Changed by the founder:** the host sets the rule (free until the start [default], or 1, 12 or 24 hours before). Late cancelling follows Airbnb: full booked price, host may refund. A host can always cancel for free. |
| When hosts are paid | Weekly, for calls that ended at least 7 days earlier | Agreed. |
| Calls that "need review" | Never charged automatically; the founder decides before a deadline, otherwise the hold is released | Agreed. |
| Refunds | The founder decides | **Changed by the founder:** the host decides refunds directly until their share has been sent; after that the founder does it by hand. Our fee is returned in the same proportion. |
| If money is lost through our mistake | Company pays the host by hand | Agreed. |
| Currency and countries | US dollars; hosts in the US only; customers anywhere | Agreed. |
| Minimum price | $5 per 15 minutes; 0 means a free call | Agreed. |
| Stripe account | Use a test account now | Agreed. The live account will belong to the future company; Stripe's written approval is needed only then. |

Astra reviewed these eight decisions and the recommendations before they were approved.

**What was built**
- A hold on the customer's card before the call, one charge afterwards for the time that counted, and the host's share sent on a weekly payday.
- "Never twice": every money action is written down first under one label, only one can run per payment, and anything with an unknown outcome is checked with Stripe before anything else happens.
- A full money record (every cent: charge, fee, host share, refunds, payouts).
- Screens: confirm and pay, hosting settings (payout account, cancelling rule), receipts and host refunds, and an admin page for reviews.
- The app refuses to run with a live Stripe key.

**What the reviewers found**
- Astra, first review: 20 issues, 19 fixed (for example a late-arriving charge being lost, a double refund on a double click, the 25-cent payout fee taken twice). Not taken: setting each host's bank payout timing (left at Stripe's default).
- Astra, second review of the fixes: 5 more rare cases, all fixed.
- CodeRabbit: 16 comments, 13 fixed (most important: a lost bank dispute no longer unblocks the host's payout). Not taken: checking Stripe keys at start-up, a retry counter for saved Stripe messages, isolating each helper stage.

**How it was checked**
- 96 checks over 23 real journeys in Stripe's test area, including crashes at four different moments, two helpers at once, declined and foreign cards, and a real dispute that is then lost.

**Still open**
- Real cards, real bank payouts and real hold lifetimes can only be tried on the company's own Stripe account.

---

## Module 3: Accounts and profiles

**Plan:** `plans/03-accounts.md`

**What was recommended, and what the founder decided** ("use your recommendations")

| # | Topic | Decided |
| --- | --- | --- |
| 1 | Who can host | Anyone can fill in a profile; it goes public only after the founder approves it. (My first recommendation was "public at once"; Astra's review changed it.) |
| 2 | Fake social media names | The host puts a code in their bio and the founder confirms it. Only confirmed names are shown. |
| 3 | Email confirmation | Required before a password account can log in. |
| 4 | Sending email | No real email service yet; emails go to an admin-only test page. A real service is chosen at launch. |
| 5 | Google sign-in | Yes. Set up on the founder's personal Google account (laurenrapture@gmail.com), with no billing attached. |
| 6 | Age and terms | Two required boxes: "I am 18 or older" and "I accept the terms". |
| 7 | Handles | 3 to 30 plain letters, numbers and underscores; look-alikes blocked; changes done by the founder on request. |
| 8 | What a profile shows | Name, handle, "about" text, price, cancelling rule, confirmed social names. Never the email. Customers have no public profile. |
| 9 | Photos | Not yet (needs a storage service). A circle with the person's initial. |
| 10 | Closing accounts | The founder suspends or closes from the admin page; people ask by email for now. |

Left out on purpose: changing your own email address, and a self-service "close my account" button.

**What was built**
- Sign-up, login (password or Google), email confirmation, forgotten password, a last sign-up step with the two boxes and the time zone.
- Leaked passwords are refused; repeated attempts are slowed down; the app never says whether an email has an account.
- Host profiles with approval, hiding, suspension; the public page; social-account proof; admin tools to approve, suspend, close and reopen.
- One "gate" that every page and action goes through.
- One difference from the plan: the two boxes are on a short page right after confirming the email, so Google sign-ups go through the same step.

**What the reviewers found**
- Astra: 8 issues, all fixed (for example a host renaming themselves at the moment of approval, and a closed account staying in a live call).
- CodeRabbit: 9 comments, all fixed (for example flooding an address's email allowance to block the owner's password reset).

**How it was checked**
- About 100 real-journey checks; Google sign-in tried for real with the founder's account.

**Still open**
- A real email service; real terms and privacy pages; opening Google sign-in beyond the one test address.

---

## Module 4: Calendar and booking

**Plan:** `plans/04-calendar.md`

**What was recommended, and what was decided.** The founder made two changes, asked for the recommendations to be checked with Astra once more, and left the final decisions to the builder.

| # | Topic | Decided |
| --- | --- | --- |
| 1 | Ask first or book at once | Ask first; the host accepts or declines. "Accept automatically" is left for later (Astra's advice). |
| 2 | Time to answer | 24 hours, or less when the call is near. Unanswered requests end by themselves. |
| 3 | The card | Entered when the request is sent; nothing held then. The money is held automatically 2 days before the call. If the card fails, the customer must fix it before the host's free-cancelling period ends and at the latest 12 hours before the call, or the booking is cancelled for free. |
| 4 | Call lengths | The host offers any of 15, 30, 45, 60 minutes. |
| 5 | Notice and how far ahead | Notice of 1, 2 or 3 days; bookable 2, 4 or 8 weeks ahead. No same-day paid bookings in this module. |
| 6 | Break between calls | **Founder's change:** as short as 1 minute (choices: 1, 5, 10, 15, 30). Times are laid out one after another, and the time right after an existing call is offered too. |
| 7 | Several people, one time | **Founder's change:** several customers can ask for the same time and the host chooses. Limits: 3 waiting requests per host and 5 in total per customer, 3 upcoming free calls, 7 days before asking again after a decline, and caps to protect popular hosts. |
| 8 | Moving a booked call | Not yet; cancel and book again. |
| 9 | What the host sees | The customer's name and a short note. Never the email. |
| 10 | Emails | Only the essential ones; reminders come with notifications. |
| 11 | Suspending or closing | Ends requests and cancels future calls for free. Hiding a profile keeps existing bookings. |

Builder's own decisions after Astra's second check: a paid time can be asked for only while 8 hours remain before the payment cut-off; the host must answer at least 6 hours before that cut-off; joining one call takes a person out of any other call.

**What was built**
- Host calendar: weekly hours, time off, lengths, notice, break. Correct on clock-change days.
- The public page shows open times in the visitor's own time zone; request summary; card step; the host's requests page.
- "Never two calls at once": the database itself refuses overlapping calls for one person.
- The saved card, the automatic hold, the "card did not work" path, the cut-off, and removal of the saved card.
- Emails for each step, written in the same step as the event.

**What the reviewers found**
- Astra: 12 issues, 11 fixed (for example a price changed while the customer was reading the summary; paying after the cut-off). Not taken: filling in records for calls that existed before this module (nothing is live yet).
- CodeRabbit: 13 comments, all fixed (for example booking emails losing their text in the live app).

**How it was checked**
- 93 checks over 12 real journeys against Stripe's test area; 30 automatic tests for open times and deadlines; a full booking walked through in a browser.

**Still open**
- Cards whose bank asks for approval later; how long real holds last; real email delivery.

---

## Module 5: Safety

**Plan:** `plans/05-safety.md`

**What was recommended, and what the founder decided** ("go with your recommendations")

| # | Topic | Decided |
| --- | --- | --- |
| 1 | Rules for calls | Conversation only. Not allowed: nudity or sexual services, anyone under 18, pretending to be someone else, threats, scams, recording, paying outside Connect. Stripe does not allow sexual services. |
| 2 | Host identity check | Stripe Identity (ID plus matching selfie), $1.50 per completed check, paid by the company. Chosen over Veriff ($0.80 per check but $49 a month minimum) and Persona ($250 a month). |
| 3 | Customer age check | Option A: an identity check before a customer's first free call. Astra recommended checking every customer before their first call; the founder chose the builder's recommendation. |
| 4 | Recording | Calls are not recorded. |
| 5 | Blocking | Anyone can block anyone; it ends their requests and cancels their future calls with each other for free. |
| 6 | "End call and report" | Ends the call for both; later time is not counted; the charge goes to the founder's review list. |
| 7 | The founder's tools | Close a report, warn, pause an account, suspend a host, close an account. Every action recorded. |
| 8 | Urgent reports | Top of the list and an email at once. Nothing hidden automatically. (My first recommendation was to hide the host at once; Astra's review changed it.) |
| 9 | Admin account | Password plus a 6-digit code from an authenticator app. No Google login for admins. |
| 10 | Stop switch | "No new requests" and "nobody can join a call". |

**What was built**
- Admin accounts log in with a password plus an authenticator code; Google login is refused for admins; only logins made after the second step was set up count; every admin page and action checks this; every admin action is written to a record.
- The rules page, written once in code and shown at sign-up and on call pages; everyone is asked to accept again when the rules change.
- Pausing an account (can log in and look, cannot book, host or join), with the reason and an appeal address.
- Blocking in both directions, enforced wherever contact could start or continue; it ends requests between the two and cancels their future calls for free.
- "End call and report" inside the call: ends it for both, nobody can rejoin, the charge goes to the founder's review list.
- Reports from a host's page, a request or a call, with a reference number; urgent ones email the founder at once; a Reports page with warn, pause, suspend and close; reporters are told when a report is closed.
- Stripe Identity for hosts (ID plus matching selfie, three tries), required before approval; also required before a customer's first free call. The name on the ID is shown to the founder only.
- Two emergency switches: "no new requests" and "nobody can join a call".

**What the reviewers found**
- Astra: 22 findings, 21 fixed. The most important: a second Google login path (a token sent by the browser) would have skipped the admin's second step; the clock did not stop at "End call and report" if the video service was slow; a block could leave future calls uncancelled when Stripe was down; backup codes failed because the form removed their hyphen. Not taken: handling Stripe's later deletion of a verified check (a retention-policy item for the lawyer).
- CodeRabbit: 12 comments, 10 overlapping with Astra's; the rest fixed (for example the identity refresh running on its own rhythm so slow answers from Stripe never hold up the money jobs).

**How it was checked**
- 55 checks over 7 real journeys (`scripts/safety-check.ts`), including the real stop through the app, the door refusing re-entry and the clock stopping; plus all earlier journeys and the 166 automatic tests.

**Still open**
- A restricted Stripe key is needed to read "18 or older" from a passed check (the founder must be logged in to Stripe to create it); until then nobody passes the check.
- Real IDs and faces can only be tried with Stripe's test documents.

---

## Module 6: Notifications

**Plan:** `plans/06-notifications.md`

**What was recommended, and what was decided** (from module 5 on the builder decides after Astra's check; the founder asked for everything to be documented)

| # | Topic | Decided |
| --- | --- | --- |
| 1 | How emails are sent | Resend (free for 3,000 a month, then about $20). The app keeps writing to its outbox; the helper sends what is in it and records the result. Astra's additions taken: delivery tracked per try, retried with limits, never resent blindly after Resend's 24-hour memory; bounces and complaints handled; bad addresses never written to again. |
| 2 | Reminders before a call | 24 hours before, 1 hour before, and "your room is open" when the room opens (5 minutes before), to both people, once each, with a link to the call. |
| 3 | Reminders about requests | A host whose request runs out in about 2 hours gets one reminder. |
| 4 | Text messages | Not now: needs a registered company and carrier approval; costs per message. |
| 5 | Phone or browser notifications | Not now: needs an installed app or a permission flow that works badly on iPhones. |
| 6 | Choices for people | One switch, "reminder emails" (on by default), on the account page; emails about things that happened are always sent. Every reminder has an unsubscribe link that works without logging in, plus the one-click header mail programs use. |
| 7 | Login links in emails | No "one-tap sign-in": a link that logs you in would let anyone who sees the email into the account. Links go to the call page; a logged-out person logs in and is sent on. |
| 8 | The "It's time" email | Who, when, how long, the link, and for paid calls what counts for money (Astra's wording: the room is open; waiting counts only inside the booked time). |

**What was built**
- Sending through Resend when both the key and the sending address are set (nothing is sent without them, so development stays silent): one email claimed at a time, with a lease, so two helpers never send the same email and a helper that dies mid-send is recovered; the email's own ID is the idempotency key; a try more than a day old whose answer was lost is never repeated; retries with growing waits and a limit; sends are paced and "slow down" from Resend is waited out, not counted as a try; expired emails closed and login-link text purged; a daily allowance per address.
- Bounce and complaint messages from Resend (signed): a permanent bounce marks an address as one we never write to again; a complaint (marked as spam) switches that person's reminders off and stops every email to the address except the login links they ask for themselves.
- Reminders written by the helper inside their windows only (a helper that was down does not send a pile of stale ones); each expires at its moment; none for cancelled calls, test calls, paused or closed people, or people who opted out, and a reminder already queued is dropped if any of that changes before it is sent.
- Email delivery and the reminder writers each run in their own loop in the helper, so a slow sending service never delays closing rooms or the money jobs, and a money job that fails for a while never makes a reminder miss its window.
- The reminder switch on the account page; the unsubscribe page (a button, so link scanners change nothing) and the one-click endpoint.
- The admin outbox page shows delivery status and lets the founder send a test email.

**What the reviewers found**
- Astra: 15 findings, 13 taken. The most important: rows left mid-send by a crashed helper were stuck for ever; the "do not resend after a day" protection could be lost; email sending could block the helper for minutes; reminders already queued ignored a later opt-out or cancellation; the one-click header pointed at the wrong address. Not taken: a few-millisecond timing difference on the password-reset form (Better Auth's own lookup dominates, and sign-up enumeration is already closed); serialising the daily allowance across several helpers (one helper runs; the cap is a soft guard).
- CodeRabbit: 6 comments on the first pass, all overlapping with Astra's (5 fixed, the reset-timing one left as above); 4 on the second pass, all fixed: emails queued before delivery existed are closed by a migration so switching delivery on never sends a backlog; the unsubscribe token is unique in the database; only a permanent bounce stops us writing to an address (a full mailbox is temporary); each claim's lease runs from the real clock and a helper that lost its lease writes nothing.
- CodeRabbit, later passes: 16 comments, 15 taken. The most important: sending needs `EMAIL_FROM` as well as the key (with the key alone every send was refused for an unknown sender, and login links were lost after the retries); a complaint no longer blocks the password-reset and confirmation emails the person asks for themselves (it does switch their reminders off); "slow down" from Resend is waited out instead of using up a try, and sends are paced; the reminder writers run in their own loop so a failing money job cannot make them miss a window; a row that used up its tries without ever recording an outcome is closed instead of being retried for ever; each pass reads which reminders already exist instead of attempting every insert again; errors are logged by name and code only (a failed query quotes the address and the login link); a strange character in Resend's signature header no longer crashes the webhook; email text is hidden on the admin page as soon as sending is on, not only in the live app; the check script pins its links to this computer and touches only its own rows. Not taken: the password-reset timing difference (as above, left on purpose).

**How it was checked**
- 33 checks over 4 journeys (`scripts/notifications-check.ts`) with a pretend sending service, including crash recovery, opt-out after queueing, the one-click header's own address, a complaining address still getting its password reset, "slow down" not counting as a try, and a worn-out row being closed; plus all earlier journeys and the 169 automatic tests.

**Still open**
- Real delivery and inbox placement need the Resend account and the company's web address (founder).

---

## Module 7: "Available now" calls

**Plan:** `plans/07-available-now.md`

**What was recommended, what Astra said, and what was decided** (the builder decides after Astra's check)

| # | Topic | Decided |
| --- | --- | --- |
| 1 | Switching "available now" on | 30, 60 or 120 minutes from a new "Available now" page under Hosting. Closing, reloading or leaving the page switches it off at once (the page says so as it goes). As the fallback for a page that could not say so (a crash, a lost connection), the page sends a sign of life every 5 seconds and availability lapses 15 seconds after the last one; a lapse is final until the host switches it on again. When a host goes, requests still waiting for them end at once. **(Founder's change, 12 November: at once, not within 45 seconds.)** The public page shows only the lengths whose call, starting as late as it might, is over before the availability ends and, with the break, before the host's next commitment in either role. Off when a call is accepted; never back on by itself. (Astra: the draft's "off 10 minutes before a call" was wrong, and presence was missing.) |
| 2 | How a call now starts | The customer saves a card and sends the request; the host has 2 minutes **(founder's change; was 3)**, and can accept, decline, or decline and block **(founder's change)**. Accepting reserves both people and creates the call and its payment in one step, with the start 60 seconds later and a payment deadline 2 minutes later; the saved card is tried at once through the "never twice" money path; if the bank wants approval, the call page shows the usual card form on the same hold; nobody enters the room until the money is held; not held by the deadline means cancelled for free. (Astra: a saved card is not funds; reserve first, then ask the bank, with a bounded deadline and recovery. Adopted on the existing parts.) |
| 3 | What is charged | `calls.billing`: "host" for booked calls (the host's time), "together" for instant calls (time both were in), fixed at creation and read by settlement, the later-records check, the pay form, the receipt and the reminder wording. |
| 4 | Cancelling | Free until the start (an instant call carries a 0-minute free-cancel rule, so the late-cancel charge can never apply); after the start no cancelling, except by Connect for a call whose money was never held. |
| 5 | Extending a call | **Deferred to module 7b.** Astra showed that separate rooms mean a visible reconnection and lost minutes, and one room needs segment-level payments, attendance and closing plus new card consent. To be designed after module 8. |
| 6 | Limits | One instant request outstanding per customer; 5 waiting per host; 15 minutes before asking the same host again after a decline **(founder's change; was 24 hours)** (a booked-call decline keeps its 7-day rule; an instant decline does not trigger it); every try counts toward the 10-a-day limit; three refused cards in a row pause instant requests for an hour. |
| 7 | Notifications | Polling is the channel: the host's page every 3 seconds, the customer's every 2 (with jitter, one request in flight, refresh on focus, stop when settled). One email to the host per instant request that expires with the 2-minute clock; one to the customer when accepted (with the call's link); the usual ones for a refused card or a cancellation; none for extensions (deferred). The hourly "new requests" digest ignores instant requests. |

**What was built**
- Availability on the host's calendar (until when, last sign of life); the "Available now" page with the switch, the countdown, the sign of life, the live list of requests with Accept and Decline, and a jump to the call on accepting.
- The public page's "Available now" block with the lengths that fit; a "Call now" summary page with the card consent; the customer's waiting page that follows the request and moves to the call when accepted.
- Instant requests as bookings with `source = "now"`: their own deadlines, the customer taken from the moment of asking, the real time set on acceptance, the hold tried from the page at once (the helper is the fallback), the 2-minute payment deadline, cancellation for free by Connect when the money is not held even though the start has passed (nobody could enter).
- The billing rule on calls, applied in settlement and the later-records check (the frozen totals keep all three numbers).
- Instant-call wording in emails, the pay form, the receipt and the results page.

**What the reviewers found**
- Astra (code review): 8 findings, all taken. The most important: a hold that lands after the 2-minute deadline (a crashed helper replaying the card try later) could leave its money action open for ever, so the call was never cancelled and the hold never let go (a bug that also affected booked calls); the call page did not follow the hold, so a customer could be left on a card form after the money was already held, and a host on "waiting for the customer to pay"; a customer who took 20 minutes over the card got a reservation ending before it started; the fallback card try stopped at the start time instead of the payment deadline; the live answer endpoint could accept a booked request and use up its one card try; lengths were offered that would run past the host's availability; a sign of life after a lapse revived availability by itself; two journey checks passed without proving their claim.
- A second build of this module was made on 12 November by a session that did not know this one existed (nothing on `main` recorded it). The founder compared the two and chose this one, with the changes marked above. Carried over from the other build: the fix for a bug present since module 1, found when the founder saw their camera light flashing: the camera check before joining restarted the camera several times a second, because the page redraws every second for the clock and handed the video library fresh settings each time (measured: 28 camera requests in 8 seconds before, none after). The other build's "more time during a call" was not carried over; extending a call stays deferred.
- Astra (second code review, 12 November, after the founder's changes): 5 findings, all taken; no money-safety problem found, and the camera fix and the replay onto `main` confirmed sound. "Decline and block" could decline and then fail to block, with a message saying nothing had changed and no way to try again (now the block can be tried again, and the message says what happened). The browser's own "are you sure" box freezes the page, signs of life included, so a host who hesitated 15 seconds was switched off (the question is now asked on the page itself). A late sign of life could wipe out availability the host had just switched back on (every change to availability is now made under the host's calendar lock, renewing or clearing in one step). A slow answer from the server could overwrite a fresh switch-on, and a lost connection left the green "available" banner showing (answers older than the last switch are ignored; the page uses the sign of life's answer and warns when the server has not confirmed for 15 seconds). The "three refused cards in a row" pause counted failures even with successful calls in between (it now looks at the last three accepted calls, whatever became of them). Astra also pointed out, and the page now says, that a tab hidden behind others for a few minutes counts as gone, because browsers slow hidden pages down.
- In a browser: the host switches on; leaving the page by a link, and by a hard page change, each switch availability off at once; a real request appears on the host's page by itself with its 2-minute countdown; "Decline and block" declines it and records the block.
- CodeRabbit: 11 comments, 8 taken. The most important: a customer whose card form failed to load, or who left it, was told "you already have a request" for half an hour (asking again now replaces a request that never got past the card step). A "gone" message from a page being reloaded could arrive after the host had switched on again and end the new availability (the message now names the availability period it ends). A sign of life that waited behind a newer one could move the clock back. The card-problem email for an instant call could arrive after its own deadline (it now expires with it). The host's "waiting for the customer to pay" screen stopped following the payment after 5 minutes (it now follows it until the call's end). The customer's waiting page could act on an answer that arrived after they had left it. A journey check passed for the wrong reason, and three entries in the plan still gave the old timings. Not taken: counting card-step drafts that never reached a host against the booked-request allowance (no host is affected); refusing an acceptance that would run past an availability the host shortened meanwhile (not reachable from the screens, and the host's own choice); ending requests left over when a host switches off and straight back on (the host is back and can answer them, which is the better outcome).

**How it was checked**
- 72 checks over 5 journeys (`scripts/now-check.ts`) against the local database and the Stripe sandbox, including the money held at once on acceptance, a refused card cancelled free at the deadline, the 15-minute rule, decline and block, a host who leaves while someone is waiting, and the lengths that fit; 6 automatic tests for the rules; all earlier journeys (payments, accounts, booking, safety, notifications) and the 175 automatic tests still pass. The host page and the public page were walked through in the browser.

**What the automatic checks cannot test**
- Two real people on two devices: the host accepting on their phone, the customer's page moving to the call, and the call starting a minute later; the bank's approval step on a real card.
- A charge worked out from time together on a real call (the rule is applied in code and the price formula is unit-tested; a live call with real attendance messages is needed to see it end to end).

---

## Things that need the founder or outside help before launch

- **Stripe:** a live account owned by the company, and Stripe's written approval for this kind of business and for the identity check.
- **A lawyer:** terms of service, privacy policy, the rules page, the wording customers agree to when saving a card, duties around reports involving children, how long records are kept, and which countries must not be served.
- **Email:** a real sending service and the app's own web address.
- **Real-device tests** of the video call (two people, phones, a 60-minute call).
- **Google sign-in:** move from "testing" to "live", ideally on the company's own Google account.
- **Hosting:** where the app runs, where photos are stored, and making the founder's own account the admin there.
