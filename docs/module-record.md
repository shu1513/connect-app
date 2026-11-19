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
| 7. "Available now" calls | Built and merged. Two-device test done by the founder on 13 November. |
| 7b. Adding time during a call | Built and merged. The founder's two-device test on 14 November ended before time could be added; still to try. |
| 8. Ratings, search, contacts, host notes | Built and merged. |
| 9. Verified customers only | Built and merged. The real ID check in a browser needs the restricted Stripe key (founder). |
| 8b. Messaging | Researched, then left out of the first version (founder, 14 November). The research is kept in `docs/research/messaging/`. |
| Final pass: joining everything together | Built and merged. |
| 10. Connection check before a call | Built and merged. A weak connection, a real iPhone, hotel Wi-Fi and mobile data still need the founder's friend tests. |
| 11. Refund requests, taking the money later, and a record of call quality | Built and merged. A real two-person call on a bad connection and a real card's hold from start to finish still need a friend test; the outside health watcher comes with the hosting. |
| 12. Hosts collect their earnings when they want | Built and merged. Stripe's test area only; a real payout to a bank has not happened yet. |

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
| When hosts are paid | Weekly, for calls that ended at least 7 days earlier | Agreed. **Changed by the founder on 15 November 2026 (module 12):** no weekly payday. A host collects with a button, from 2 days after a call, once every 24 hours, so that hosts get their money sooner and choose the moment themselves. |
| Calls that "need review" | Never charged automatically; the founder decides before a deadline, otherwise the hold is released | Agreed. |
| When the customer's money is taken | A few minutes after the call | **Changed by the founder on 15 November 2026 (module 11, `plans/13-connection-refunds.md`):** about 24 hours after the call, so that a customer can first ask for a refund and a lower charge costs no card fee. With a request, when the host answers, and at the latest about 24 hours after the request. Never later than 12 hours before the card's hold ends (for ordinary charges; calls under review keep their rule of a full day). A charge for cancelling late is still taken at once. **Since later the same day:** the customer's 24 hours count from the call's start, and the money of a call nobody asked about is taken 3 minutes after they end. See "A later change" below. |
| Who can ask for a refund | Only the host or the founder could start one | **Changed by the founder on 15 November 2026:** the customer can ask, within 24 hours of the call, giving a reason. The host still decides. **Since later the same day:** the 24 hours count from the call's start, not its end. |
| Refunds | The founder decides | **Changed by the founder:** the host decides refunds directly until their share has been sent; after that the founder does it by hand. Our fee is returned in the same proportion. |
| If money is lost through our mistake | Company pays the host by hand | Agreed. |
| Currency and countries | US dollars; hosts in the US only; customers anywhere | Agreed. |
| Minimum price | $5 per 15 minutes; 0 means a free call | Agreed. |
| Stripe account | Use a test account now | Agreed. The live account will belong to the future company; Stripe's written approval is needed only then. |

Astra reviewed these eight decisions and the recommendations before they were approved.

**What was built**
- A hold on the customer's card before the call, one charge afterwards for the time that counted, and the host's share sent on a weekly payday (replaced in module 12 by the host's own "Collect earnings" button).
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

**A later change: calls as short as 5 minutes (the founder's decision, 15 November 2026).** The shortest call that could be booked was 15 minutes. A host can now also offer 5-minute and 10-minute calls, beside 15, 30, 45 and 60. It is the host's choice, on the calendar page; no host offers them unless they tick them. Nothing else changed: the price of a call follows its length (a 5-minute call costs a third of the 15-minute price), and open times, breaks, instant calls and adding time work for the short lengths as for any other.
- Said to the founder first, and now to hosts on the calendar page: our fee includes 30 cents for each paid call whatever its length. On the shortest call at the lowest price ($5 per 15 minutes) the customer pays $1.67, our fee is 38 cents, and the host gets $1.29. At $20 per 15 minutes a 5-minute call is $6.67.
- Left as it was: a host's page shows the shortest length the host offers first.
- **Astra's review:** ship. It read everything else in the app that might quietly assume a call is at least 15 minutes (booking, open times, instant calls, the call screen, adding time, the money, ratings, reminders, refund requests, the pages) and found nothing that breaks. It confirmed the numbers: on a 5-minute call at the lowest price Connect is left with about 3 cents after Stripe's own card fee, which is not a loss. Four small points, all taken: the calendar page now also says that the 30 cents is taken again each time paid time is added during a call (5 minutes plus 5 added minutes cost the host more in fees than 10 minutes booked at once); one check in the booking script could have passed for the wrong reason and now uses a time that really is good for a 10-minute call; and two tests were added (hours that end in the middle of a last call; a short instant call when the host has 8 minutes left).
- Checked: tests for the lengths, the price and the open times of a 5-minute call; the booking script, with a new journey (a host ticks 5 minutes, the open times come one call and one break apart, a 5-minute request is accepted as a 5-minute call, a length the host does not tick is refused), 100 checks; and by hand in a browser: the calendar page with the two new lengths, and the host's page offering "5 minutes, $6.67".

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
| 5 | Extending a call | **Deferred to module 7b (built since; see below).** Astra showed that separate rooms mean a visible reconnection and lost minutes, and one room needs segment-level payments, attendance and closing plus new card consent. To be designed after module 8. |
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

## Module 7b: Adding time during a call

**Plan:** `plans/09-more-time.md`

**The founder's brief (13 November 2026):** a call ends at its booked end, not a minute later. In the last minute both people see a countdown. The customer can ask for more time (5, 10 or 15 minutes, or a number they type), at the same price, and the host accepts or declines right there. The customer can never ask for more than fits before the host's next appointment.

**What was recommended, what Astra said, and what was decided**

| # | Topic | Decided |
| --- | --- | --- |
| 1 | When a call ends | At its booked end. The minute of grace is gone (one number, 60 seconds to 0); the join check, "End call and report" and the moment the record becomes final all move with it. Closing rooms now runs in its own loop in the helper, and the helper locks the call and looks at its end again before closing, so a call that was just made longer is never closed. |
| 2 | When the customer can ask | **Founder's decision: when 1 minute 30 seconds are left** (the draft said 5 minutes). Asking stops 15 seconds before the end; the host can accept until 5 seconds before it. Both people see a large countdown in the last 60 seconds. |
| 3 | How the extra time is paid for | **Founder's decision: each extension gets its own hold**, so the bank never shows more than what the customer agreed to. (The first draft replaced the call's hold with a bigger one, which shows two near-full amounts for a few days.) Each extension is a payment of its own, of exactly the same kind as the call's payment: its own hold, charge, refund button and payout, through the money code that already exists. |
| 4 | The smallest extension and the fee | **Founder's decisions: 5 minutes at least, and the usual fee (4.9% plus 30 cents) on each extension.** At most 60 minutes per request; a call can be made longer again later. |
| 5 | The order of steps | Money first, then the host. The price of the extra minutes is held on the card that already holds the money for the call before the host is asked; accepting is then one step in our own database. A declined or unanswered request has its hold let go. One request can be open per call (the database guarantees it), and at most 5 per call. |
| 6 | What fits | The new end plus the break fixed on the booking must come before the host's next thing, and the new end before the customer's next thing. The database itself checks it again when the host accepts. Weekly hours and time off do not limit it: the host is there and says yes themselves. Other people's waiting requests for those minutes end, as when a host accepts any call. |
| 7 | Which time each payment pays for | Each payment covers its own stretch of the call (two new fields). After the call each is charged for the time that counted inside its own stretch, by the call's usual rule, and never more than its own hold. |
| 8 | The saved card | Kept until the call is over (it was removed as soon as the first hold landed), under a new wording the customer agrees to. Bookings made under the earlier wording keep the earlier treatment. |

**What Astra found in the plan** (two rounds; all taken)
- Round 1 (the replace-the-hold draft): 8 findings. What survived the change of design: the host's 5-second limit and the screen asking the server once more before ending; re-checking paused and closed accounts, blocks and the founder's stop switch; closing rooms in its own loop; the card kept only under the new wording; the break fixed on the booking; the card of the call's own hold.
- Round 2 (a payment per extension; verdict "build with changes"): 8 findings. The three that mattered most: (1) the job that cancels calls whose money was not held in time could have mistaken an extension's unpaid payment for the call's own and cancelled a call under way, because the booking jobs build their questions from one shared piece and then replace its conditions, so a filter added there would silently vanish (the filter now sits in the join, and the "never paid" cancellation only works for a call's own payment); (2) a declined request whose hold was slow to let go could have been charged for minutes a later, accepted request also covered (only an accepted request can ever be charged, checked at the moment of charging); (3) the existing hold code refuses a hold after the booking's pay-by time, which is always before the call starts, so every extension would have been refused (each payment now has its own limit). The others: a refund names its payment and the server checks it belongs to that call; the join check compares the call's own hold with its own stretch; a request is ready for the host as soon as its hold is on record, by whichever way; a 10-second limit on the bank's answer; the booking's new total is the old total plus the extension's price.

**Every place that looks up a call's payment** (Astra's list; the rule is "say which you mean")
- The call's own payment only: who may see a call (`payments/access.ts`), the booking jobs (`booking/jobs.ts`: unpaid bookings, placing holds, the cut-off, removing saved cards), cancelling (`payments/cancel.ts`), suspending a host, closing or pausing an account, blocking, reminders, the home page's status line, the pay form and the join check.
- Every payment of the call: "End call and report" (all go to review), finishing cancelled calls (an extension's payment is only ever let go), charging finished calls and the later-records check (each by its own stretch), payday, the results page, the admin lists, refunds (by payment).
- Not affected: the money actions themselves, Stripe's messages and crash recovery (they work on one payment by its own number).

**What was built**
- The timing rules as plain logic (`src/lib/extend/rules.ts`); asking, answering and the helper's clean-up (`src/lib/extend/extend.ts`); two new addresses the call screen uses, and the existing "live" address now also gives the call's end and the open request.
- The call screen: the countdown; the customer's choices with prices and a box for another number; "Checking your card…" and "Waiting for…"; the host's Accept and Decline box; the new end taken over without anyone reconnecting; one last question to the server before the call ends on screen.
- `call_extensions` (the lasting record of who asked for what, and what became of it); on payments: the extension it belongs to and the stretch it covers; "one payment per call" became "one own payment per call, and one per extension", enforced by the database.
- The results page shows the call's own payment and each extension as its own block, each with its own refund form for the host; the admin lists mark extension payments.

**Known limits of this first version**
- A paid call can only be made longer if its money is held on the card saved with the booking. If the customer typed a different card on the call page, or the booking was made under the earlier card wording, the customer is told that time cannot be added.
- If the customer's bank wants its own approval step for the extra hold, the request fails and the call ends as booked. (Rare for US cards, common for European ones. To be decided before launch.)
- The host cannot offer more time; the customer asks.

**What the reviewers found in the code**
- Astra (code review; verdict "ship with changes"): 4 findings, all taken. It found no way to be charged twice, to be charged for a request that was not accepted, or for an extension's payment to be mistaken for a call's own, and no remaining lookup of a call's payment that does not say which it means; the migration is safe for existing payments. The four: (1) if the screen's last question to the server went unanswered, the call ended on screen even though the host might just have added time (the call now only ends on screen once the server has answered; a server that cannot be reached is asked again for about half a minute); (2) the "is joining switched off" check inside the asking and accepting steps used a second database connection while holding the first, so with many such steps at once all connections could be busy waiting for each other (it now uses the step's own connection); (3) when the bank's answer to the extra hold was lost but Stripe's own message had put the hold on record, the host still could not accept until the helper's check a minute later, by which time the call was over (a hold that is on record as held no longer blocks; anything else under way on it still does); (4) accepting read the clock before taking its last lock, so a yes given in time could, after a wait, land after the call's end (every lock is now taken before the clock is read).
- In a browser (Chrome, with the two test accounts on a free call): the customer's buttons appeared in the last minute and a half, "+10 min" showed "Asked for 10 more minutes. Waiting for Hana Host.", and when the host accepted the clock jumped from under a minute to over ten with "10 minutes added." and nobody disconnected; on the host's side the box "Cory Customer asks for 5 more minutes. Accept / Decline" appeared and Accept added the time; a call left to run showed the red countdown and then "This call has ended." exactly at its end. This found one real mistake: the screen set its clock from the join check assuming the answer took no time to prepare, so after a slow join the screen ran about 12 seconds ahead of the server and offered the buttons before the server would take them. The screen now reads the server's clock from every answer near the end of the call, and the server only sends the customer's choices while its own clock says asking is open.

- CodeRabbit (pull request 14): 4 comments, all taken, one of them further than it asked.
  - The helper ran the clean-up of requests for more time only after the payment work, so if the payment work failed on a pass, unanswered requests stayed open and declined holds were not let go on that pass. The clean-up now runs whether or not the payment work went through (the booking work still waits for it, as before). Also, the "did the record change after the charge" step now skips one record it cannot check and goes on, as every other step already did; before, one such record would have stopped payday and the booking work behind it.
  - The card wording. CodeRabbit pointed out that a request already at the card step when this goes live would be shown the new sentence while its record still carried the earlier wording version. Looking into it showed something more important: the wording version had been raised, but **the box the customer actually ticks had not been changed** (only a sentence on the next page had). The two tick boxes (booking a call, and "call now") now say that the price of extra time asked for during the call is held on the same card and charged the same way, and that the card is removed once the call is over. The sentence on the card page is back to what it was, so it is true under either wording. Not done, on purpose: carrying the wording version inside the form (it would only matter for a form left open across the moment of an update, and the earlier wording already allowed the card to be kept until the booking was over).
  - The screen's last question to the server could take almost two minutes to give up if every try timed out, not the half minute intended. It is now limited to half a minute by the clock.
  - The journey script changed the test host's weekly hours and time zone and did not put them back. It does now (tried with a made-up calendar, which came back unchanged).

- One more read-through by the builder (14 November), with Astra asked about each edit before it was made. Three small fixes, all on screens, none in the money code: (1) answers from the server could arrive out of order on the call screen, so an older answer could put a request back on screen after it was accepted, where it would stay (answers are now applied in the order they were asked for); (2) the list of calls on the home page showed only the call's own payment, so a call with added time showed "Charged $20.00" when $25.67 had been paid (it now adds up every payment of the call; Astra's addition: also when the call's own payment ended uncharged and only the added time was charged); (3) the call page's "up to $20.00" did not grow when time was added (it now shows the booking's total). Left as they are, with Astra agreeing: the helper repeating a hold whose answer was lost after its request has ended (the hold is refused and let go seconds later; a proper fix would mean changing how unfinished money actions are closed); the call staying locked while its room is closed (that is what keeps a just-extended call from being closed); asking before the start, which only a test call shorter than 90 seconds can reach. Astra found nothing further.

**How it was checked**
- 107 checks over 10 journeys (`scripts/extend-check.ts`) against the local database and the Stripe sandbox: a free call made longer twice; declined, unanswered and too-late requests; two requests at once; the sixth request; what fits before the host's next call (with the break) and the customer's; more time and another booking for the same minutes at the same moment; a waiting request of someone else in the way; a paused customer, a block, the founder's stop switch, a stopped call; the room closing at the booked end and not closing a call that was just made longer; a paid call with two holds at Stripe on the same card, two charges that each match their own minutes, the usual fee on each, a refund of the extension only, who may refund which payment, and one transfer each on payday; a declined request that cannot be charged while its hold is still there; a refused card; a hold that lands after its request ended; accepting at the moment a request runs out; a card that was not saved; a booking under the earlier card wording; "End call and report" with a request waiting and after one was accepted.
- **Every helper job run while an extension's money is still being held, while it waits for the host, and after it was accepted, with the call untouched each time.** To prove this check has teeth, the safeguard was taken out on purpose: the check then failed (the call under way was cancelled), and passed again with it back.
- 39 new automatic tests (the timing rules, what fits, the price, counting by stretch for a late host, a host who leaves during the added time and a call stopped during it, the most the founder may charge per payment); 236 automatic tests in all, lint, types and the build pass.
- The seven earlier journey scripts: booking 94, "call now" 73, ratings 73, notifications 33, safety 60 and accounts 99 all pass. Payments: 95 of 96. The one that fails ("the 25-cent payout charge was taken once") fails because of old test data on this computer, not because of this module: nine test charges from 6 November can no longer be paid out in Stripe's test area, one of them was the first to claim that week's payout charge, and it keeps it while it is stuck. (That is how it has always worked: a payment whose payout is refused keeps the week's payout charge until it goes through, so the host is never charged it twice.)

**What the automatic checks cannot test**
- Two real people on two devices: that nobody is disconnected when time is added, and how the last 90 seconds feel with sound and video. (The browser check used one browser at a time, with the other person's step made from outside it.)
- How a real bank shows the two holds, and a card whose bank wants its own approval step.
- A paid extension through the screens with a real saved card (the money path was run against Stripe's test area by the script; the screens were tried on a free call).

---

## Module 8: Ratings, search, contacts and host notes

**Plan:** `plans/08-ratings-search-contacts.md`

**What was recommended, what Astra said, and what was decided** (the builder decides after Astra's check)

| # | Topic | Decided |
| --- | --- | --- |
| 1 | Which calls can be rated | A call whose record is final and complete and shows at least 2 minutes together, that came from a real request or a "call now" (not the admin test page), was not cancelled, and was not ended with "End call and report". Open from when the record is final (a few minutes after the booked end) until 7 days after the booked end. One rating per person per call (a database rule); it cannot be changed. (Astra: the draft's "both joined" could be two people who never overlapped, and its early opening when the room emptied was unsafe, because a room can start again.) |
| 2 | What a rating is | 1 to 5 stars and nothing else. No written review. |
| 3 | Who sees what | Nobody ever sees the rating one particular person gave them, or whether the other has rated. Each person sees their own rating of the other, and averages. |
| 4 | When a rating counts | **When the 7 days to rate that call are over, never earlier**, taken in the order the calls ended. This departs from the founder's brief ("hidden until both have rated or a short window closes"): the first build also counted a rating as soon as both had rated, and the automatic security check on that commit pointed out that this lets the person being rated choose when a rating starts to count, and so put one customer's rating in a group with two they are sure of. Counting only at the end of the 7 days closes that and is simpler; the cost is that ratings show up a week after the call. **The founder can reverse this.** |
| 5 | What an average shows | Each person counts once, with their first rating of that person. Nothing ("New") until 3 people's ratings count. Then it moves only 3 people at a time (the first 3, the first 6, ...), and the number beside it is that same 3 or 6, so one person's rating can never be read off it. (Astra on the plan: "5.0 from 3" becoming "4.8 from 4" would have given the fourth away.) A group of 3 is fixed once formed: while an account in it is closed the whole group does not count, and it is never refilled. Host and customer averages are separate. **"Each person counts once" was added after Astra's review of the code and the founder can reverse it**; the cost is that a regular customer's later ratings are saved but do not move the average. |
| 6 | Where averages appear | The host's on their public page and in search. The customer's next to their name wherever a host answers them (the request page, the requests list, the live "Available now" panel). Each person's own two on their account page. |
| 7 | Search | One page, open to anyone like the host pages. Finds hosts by display name, handle or confirmed social media name; capitals, a leading @, spaces and underscores do not matter; special characters are plain text; 2 to 50 characters; 20 results, best match first, no total and no further pages. Never a host who is hidden, not approved, paused or closed, or blocked either way for someone logged in; these rules are inside the query, before ordering and the cut to 20. |
| 8 | Contacts | "People you have talked to", worked out from calls that are over, not cancelled, not test calls, and that both joined. One line per person, shown as you met them: someone who was your host by their host name, with a link to their page only if it is public right now; someone who was only your customer by their own name, with no link even if they are a host too. Never an email, a blocked person or a closed account. Nothing new is stored. |
| 9 | Host notes | One private note per customer, up to 1,000 characters of plain text, on the contacts page and on that customer's request. One-way: only about someone who really sent this host a request. Only that host can read it; while either has blocked the other, or the customer's account is closed, it is kept but can be neither read nor changed. |
| 10 | Reminding people to rate | No email. The results page asks, and the home page lists calls waiting for a rating. |

**Astra's check of the plan** (13 November 2026): 11 findings; verdict "build with changes". Taken: the stricter rule for which calls can be rated; no admin test calls; averages that move in steps of 3 and need 3 different people; closed accounts' ratings not counting (as the simple form of Astra's "admin switch"); the giver, receiver and role always from the server; search matching, exclusions and ordering inside the query; contacts and notes checked in the shared server code, one-way, with no hidden page revealed; one grouped query for averages and an index for it. Not taken: storing eligibility separately, and holding ratings back when a call's record changes after the fact (machinery for very rare cases).

**What was built**
- The plain rules, tested on their own (`src/lib/ratings/rules.ts`, `src/lib/profiles/search-rules.ts`).
- Two tables: ratings (one per person per call, stars 1 to 5, both as database rules) and host notes.
- Giving a rating, each person's own rating, the averages for many people in one query, and the calls waiting for a rating (`src/lib/ratings/ratings.ts`); search (`src/lib/profiles/search.ts`); contacts and notes (`src/lib/people/contacts.ts`).
- Screens: the rating question on a call's results page; "Waiting for your rating", a search box and a contacts link on the home page; the search page; the contacts page with a note box per customer; the average on the host's page; the customer's average and the host's note on a request, the customer's average in the requests list and the live panel; "Your ratings" on the account page.
- Also fixed, from the founder's live test: the countdowns on the host's "Available now" page and the customer's waiting page were worked out once on the server and again in the browser a moment later, which made the development tools complain; they now appear once the page is running in the browser.

**What the reviewers found**
- The automatic security check on the first commit: the person being rated could choose when a rating starts to count. Fixed (decision 4).
- Astra's review of the code (13 November 2026): 7 findings, nothing run against the database. Taken:
  - An average could be made only of one regular customer's ratings (three from the same person, then two others), and a later group of 3 could be one person's too. Now each person counts once.
  - Closing an account pulled the next person's rating into a group already shown, which gave that rating away. Now a group is fixed and is left out whole.
  - The 7 days were counted as 168 hours in one place and as 7 calendar days by the database in another, an hour apart when the clocks change. Now one rule (168 hours) in both.
  - In search, 20 hosts whose display name is exactly what was typed could push out the host whose handle is exactly that. The database now ranks in the same four steps as the plain rule.
  - A host who had the address of a request that was given up at the card step (never sent) could open it and see the customer's name and average. Such a request is now "not found" for the host, and admin test calls do not show the customer's average.
- Not taken: matching a display name typed in unusual Unicode forms (rare; the right fix is tidying names when they are saved, in the profiles module); taking a lock so a note cannot be saved in the same instant as a block (the note is private to the host and nothing is shown to anyone).
- A known limit, kept: when exactly 3 people's ratings make an average of 5.0 or 1.0, the person rated knows all three gave that. Raising the group size (one number in `src/lib/ratings/rules.ts`) narrows it.
- CodeRabbit (13 November 2026): 6 comments. Taken:
  - Three lines in the plan still described the first draft (a rating counting once both had rated; closed accounts' ratings still counting). Corrected.
  - On the contacts page a host whose page was hidden was shown by their account name, which the customer had never seen (everywhere else a customer sees the host name). Fixed, and taken one step further than suggested: a person is shown as they were met. Someone who was only your customer is shown by their own name with no link to a host page, even if they are a public host too; before, their host could learn that from the contacts page.
  - The home page's "Waiting for your rating" looked only at the 10 newest calls, so ten recent calls that cannot be rated (no-shows, for example) could hide an older one that can. It now looks through the last 7 days until it has found enough.
  - Building the averages copied the growing list for every rating read. Now it adds to the list.
  - The journey script's check for "only had a test call" did not really cover that case. It now does, with its own customer.
- CodeRabbit, not taken: keeping what the host typed when saving a note fails. The form itself stops a note that is too long, and the other reasons a save is refused (a block, a closed account) are ones where the note could not be kept anyway; it would mean rebuilding the form for a case that is almost never reached.

**How it was checked**
- 73 checks over 5 journeys (`scripts/ratings-check.ts`); 22 new automatic tests (197 in total).
- In a browser, with two spare test accounts: the home page prompt, rating a call, the host's average on their page and in search, contacts, and a host saving a private note.
- All earlier journey scripts, run on this branch after the founder's live two-device test was over (13 November): accounts 99 checks, safety 55, notifications 33, booking 93, "call now" 72, payments 71. All pass.

**Still open**
- Whether a week's wait before a rating counts feels right (decision 4), and whether each person counting once is right (decision 5).
- Search has no rate limit yet (the app has no general one).

**Noted from the founder's live test of "call now" (13 November), for a later change**
- After a call is accepted, both people stay "taken" for its whole booked length (and the host for the break after it) even when both have hung up. A host who ends a call early cannot take another, and "Call now" disappears from their page with no explanation. Ending a call early should free both people, and the page should say "in a call, check back soon".
- A host has to find the "Available now" page through Hosting; it needs a link on the home page.
- A customer may send one host 3 requests a day; fine for real use, quickly reached when testing.

---

## Module 9: Verified customers only

**Plan:** `plans/10-verified-customers.md`

**The founder's brief (14 November 2026):** "a person can verify himself with his ID. hosts can choose to only accept calls from customers who have verified his identity."

**What was already there.** The ID check itself (module 5): a photo of an ID and a matching selfie on Stripe's pages, needed by hosts and before a free call. What was missing was small: a switch for hosts, a way for a paying customer to reach the check and come back, and a mark hosts can see.

**What was recommended and what was decided**

| # | Topic | Decided |
| --- | --- | --- |
| 1 | Who pays for a customer's check ($1.50 per completed check at Stripe) | **Founder's decision, as recommended: the company pays**, as it already does for hosts and free calls. One account normally costs $1.50, at most about $4.50 with its 3 tries. |
| 2 | The switch for a new host | **Founder's decision, as recommended: off.** A host turns it on in one click. |
| 3 | Where the rule lives | In the one check every request already passes before it is sent (`checkMayAsk`): "a free call, or a host with the switch on, needs a passed ID check". That covers a booked call, a call now, and the end of the card step. |
| 4 | Requests already on their way when a host turns it on | A request already waiting stays; the host sees who has the mark and can decline. A request still at the card step ends there with the reason, and its card is removed by the helper. Nothing is declined automatically, and nothing is checked again when the host accepts or when time is added to a call. |
| 5 | What a host sees | "ID confirmed" next to a customer who has passed, on the requests page, the "available now" panel and the page of a single request, **whether their own switch is on or off**. Nothing is shown for anyone else. Never the ID, the photos or the name on it; only a yes or no reaches the browser. |
| 6 | Telling people what a host sees | People who passed the check before this module did so before the mark existed. The sentence "Hosts you ask for a call can see that your ID is confirmed. They never see your ID or the name on it." is on the identity page (for everyone), the account page, and both booking forms for a customer who has passed. |
| 7 | Coming back after the check | The link to the check carries the page the customer was on; it survives the trip to Stripe and back and becomes a "Continue where you were" button. Only a path on this site is accepted, at every step, and one longer than 500 characters is dropped. |

**What Astra found in the plan** (verdict "build with changes"; 10 findings, all taken)
- The two that changed behaviour: (1) saving the switch must take the same calendar lock a request takes before it reads the host's settings, or a request could read "off" and still arrive after the host saved "on"; (2) the two booking pages did not check for a block before showing the "confirm your ID" screen, so a blocked customer could have been invited to do a check that could not help them.
- A repair to older code found on the way: the request check looked up the customer's ID result and the founder's stop switch on a second database connection while holding the first. Both now read through the same step.
- The rest: tell people who passed earlier what a host now sees; keep the "where to go next" address checked and short; never treat having a host profile as having passed; add the yes or no to what the "available now" panel is sent; describe the cost as a normal figure, not a guaranteed ceiling; no separate rule function; nothing needed in emails, search, contacts or the home page.

**What was built**
- One new field on a host's settings (`verified_only`, off by default) and the switch on the hosting settings page, "Who can ask you for a call".
- The rule in `checkMayAsk`, and `verifiedAmong` (one question to the database for a whole list of customers) for the mark.
- For the customer: a line on the host's public page; the "One thing first" screen on both booking pages, with its own words for this case; the trip to the check and back; "Your ID" on the account page.
- For the host: the mark on the three screens where requests are answered.

**Known limits of this first version**
- Customers cannot pay for their own check, there is no "confirmed" filter in search, and a check never expires.
- There is no daily limit on how many checks the whole site can start, and the 3-tries limit is not exact if two checks are started in the same instant. This module adds no new way in (the page was already open to anyone signed in), only more ordinary use. Worth doing before launch.
- The admin's test-call page makes a booked call without a request, so it does not pass this rule. Only an admin can use it; it goes in the final clean-up.

**What the reviewers found in the code**
- Astra (code review; verdict "ship with changes"): nothing found in the app's own code. It confirmed that all three ways a request is sent take the same calendar locks as the switch, read the host's settings again inside that step and check before sending; that saving the switch leaves the host's other settings alone; that the way back from the check cannot be pointed at another site and its message cannot be forged; that only a yes or no about the ID reaches a host; that the mark and the rule mean the same thing; and that the database change is safe for existing hosts.
- Its three findings were all in the journey script, and all were taken: (1) the script replaced the test host's weekly hours and did not put them back (it now restores the hours, the calendar and the "available now" state; tried with a made-up calendar, which came back unchanged); (2) switching the test host's availability off would have ended any real instant request waiting for them (the script now refuses to start while that host has requests waiting); (3) the check that the host's live page is sent "a yes or no and nothing else" would still have passed if other ID fields had been added (it now compares the exact list of fields, and the name on the test ID is different from the shown name).

- CodeRabbit (pull request 15): 1 comment, taken. A customer who came back from the check logged out (the login ran out, or the check was finished on a phone where they are not logged in) was sent to the login page and from there to the home page: the result was not read at that moment and the way back to the booking was lost. (The result itself was never lost; the helper and the identity page both read it later.) This had been written down as a known limit; it turned out to be a few lines to fix. The page gate now takes an optional "come back here" address, used by the identity page and the page Stripe sends people back to, so logging in returns the customer to the same step with the booking's address still attached. Every other page calls the gate as before.

**How it was checked**
- 30 checks over 7 journeys (`scripts/verified-check.ts`) against the local database and the Stripe sandbox: the switch on and off, also for a host with no settings saved yet; with it on, a customer without a passed check refused for a booked call and for a call now, with the reason; a check passed by someone under 18 and one Stripe is still looking at do not count; a blocked customer still hears only "no longer open"; a confirmed customer gets through and carries the mark on the host's list and live page; with it off, a paying customer needs no ID, as before; the switch turned on with one request waiting (it stays and can be accepted) and one at the card step (it ends with the reason, and the helper removes the card at Stripe); a free host unchanged; a customer who passes later can ask.
- To prove the script has teeth, the new half of the rule was taken out on purpose: 8 checks failed, and all passed again with it back.
- 6 new automatic tests for the "where to go next" address; 242 automatic tests in all, lint, types and the build pass.
- The eight earlier journey scripts all pass: booking 94, "call now" 73, adding time 107, ratings 73, notifications 33, safety 60, accounts 99, payments 71.
- In a browser, with the test accounts: the host ticked the switch and saw "Saved. From now on, only people who have confirmed their ID can ask you for a call."; the public page showed the line, with "Confirm yours" for a signed-in customer who has not passed; that customer was stopped on the booking page with the right words; the link led to the identity page carrying the booking's address; after a made-up "passed" record, coming back from the check showed "Continue where you were", which opened the booking form with the sentence about what the host sees; an address pointing at another site was dropped; and the host saw "ID confirmed" on the requests page and on the single request.

**What the automatic checks cannot test**
- The real check at Stripe with a photo ID and a selfie, and the real trip there and back. It needs the restricted Stripe key that has been missing since module 5.

---

## Module 8b: Messaging (researched, not built)

The founder had asked for two separate studies before anything was built: one by the builder and one by Astra, neither seeing the other's work. Both were done on 14 November 2026 and set side by side in `docs/research/messaging/compared.md` (the builder's full report is `our-research.md` in the same folder, with its notes).

**What both studies said**
- Build it ourselves in the app's own database; do not rent a chat service (roughly $280 to $500 a month at 10,000 users, and it would repeat the accounts, blocking, reporting and admin screen the app already has).
- Text only, tied to a booked call, nobody can write to a stranger, and hosts cannot write to customers out of the blue.
- The conversation opens once the host has accepted, stays open until 7 days after the call, and opens again with the next booking.
- A report button on messages, blocking both ways, and the founder reads a conversation only through a report.
- Size: about 8 to 15 days of building, plus ongoing work for the founder (reading reports, the reporting paperwork, more for the lawyer).

**What the founder decided (14 November 2026)**

| Question | Recommended | Decided |
| --- | --- | --- |
| A note with a request | Keep the note that already travels with a request, separate from messaging | Agreed. Nothing to build; it has been there since module 4. |
| Must a customer pass the ID check to message | No, the same rule as for the call (Astra recommended yes) | No. |
| Open for good, like Airbnb, or closed 7 days after the call | 7 days. An Airbnb host sells a room; a host here sells their time, and a line that never closes gives that away and piles up on the host | Not decided; overtaken by the next row. |
| Build messaging for the first version at all | **No.** The note, the reminders and the one-tap link cover the main need; what is left ("I'm running late", a short follow-up) is nice to have; similar paid-call products mostly do without chat; and the cost is ongoing, not only the build | **Agreed: left out for launch.** To be looked at again if real hosts ask for it. |

**If it is built later:** start from `docs/research/messaging/compared.md`. The plan would use the points above, plus Astra's limits on sending, an emergency switch that stops all sending, new written rules that mention messages, and deleting messages 12 months after they were sent (a lawyer to confirm).

---

## Final pass: joining everything together

Plan: `plans/11-final-pass.md`. Every module had been built and checked on its own; this pass looked at the app as one thing, the way a new customer and a new host meet it. It adds no new product feature. Before planning, every page, link, piece of wording and email was surveyed.

**What was found, and what was done**

| Found | Done |
| --- | --- |
| No way around the app: each page drew its own "back" link (eight different labels), and five screens had no link out at all. | One top bar on every page: Your calls, Find a host, Hosting, Your account (and Admin for the founder), the person's name and Log out; for a visitor: Find a host, Log in, Create an account. A small footer with Rules, Terms and Privacy. The live call page keeps only its one small link, so nobody leaves a call by accident; the sign-up steps show only the name "Connect". |
| A visitor saw a login form and nothing that explains Connect. | A small front page: what Connect is in three steps, the search box, Create an account and Log in. Logged-in people still get "Your calls" at the same address. |
| Signing up lost your place: a visitor who picked a time and created an account ended up on an empty home page. | The page travels through "Create an account", the confirmation email, "send it again", Google, and the welcome step. The same was done for the links in emails the app already sends (a request, a call, results, "requests waiting"): someone who has to log in first comes back to that page. |
| A new host was not told the steps, and got no email when the founder decided about their profile. | A "Getting started" list at the top of Hosting: profile, ID check, approval, payouts (only for a host who charges), calendar; each marked done or not, with its link. An email when a profile is approved, declined or suspended. |
| A test-only page ("Create a test call") was still there. | Removed. The helper behind it stays for the check scripts. |
| The results page showed developer data to the two people on a call. | The raw record from the video service, the "room closed" line and the detailed reasons a record needs review are for the founder only. The totals and the list of connected periods stay, because they explain the charge. A customer also gets "Book another call with ..." (not across a block, and not when the host's page is hidden or closed), and the host's payday is written as a normal date. |
| The same thing had different names. | "Call", "request", "customer", "host", "Hosting", "log in" everywhere people read. The card wording a customer agrees to was left alone on purpose: it is on the lawyer's list. |
| Every browser tab said "Connect". | Each page has its own title. |

**Decisions (the builder's, as from module 5 on)**

| Question | Decided | Why |
| --- | --- | --- |
| Where the top bar is drawn | With each page, not in the one frame around all pages | A shared frame would have to be told to redraw at every place the answer can change (log in, log out, finishing sign-up, a new name). Drawn with the page it is always right. Astra preferred the shared frame; both work. |
| Time zone | The label now says what it does ("used for the times in your emails"); screens keep using the device's time zone | Changing how every time is shown is a risk for no gain. |
| A hidden or paused host | The approval email does not say "public" when the host has hidden their page; Hosting shows a notice when the account is paused | Found by Astra: the page could look fully set up while nobody could book. |
| Left for later, on purpose | How the app looks (it stays plain); a receipt by email (Stripe sends its own once switched on in the live account); a page listing all of a host's earnings; an email reminding people to rate | Each is either a setting, a matter of taste, or a new feature, not a join. |

**Astra's check of the plan** (15 November 2026): approve with changes, 13 points; each is listed with what was done at the end of the plan. Taken: a stricter "come back here" rule; every branch of sign-up; the front page chosen by "nobody is logged in"; the decision and its email saved together, emailed only when the answer changes; emailed links keeping their place; the detailed review reasons for the founder only; the title and time-zone wording. Not taken: the bar in the shared frame (above). One point was checked and found not to be so: hosts are already emailed when a booked request arrives.

**Astra's review of the code**: ship with changes, 9 points, all taken.
- The journey script could change things it had not made (must): its paid part is now skipped while the test host has requests waiting, and the top of the script says plainly what else it touches.
- The "come back here" rule could be slipped past with a cleverly written address such as `/x/../api/...` (must; an automatic security check on the commit found the same thing first). It now judges the address a browser would really open, with tests.
- "Book another call" ignored blocks and closed accounts. Fixed, and checked by the script.
- A founder who was in a call themselves lost the raw record. Fixed.
- A paused host could look fully set up with no explanation. Hosting now says so.
- The page walk accepted any redirect. It now compares exactly and follows each link to where it ends; three more pages were added.
- The approval email said "public" even for a hidden page. Fixed.
- Two small ones: each decision email has its own name, and a missing profile is reported as missing.

**How it was checked**
- A new script, `scripts/journey-check.ts`, 58 checks. One story across every module: a host signs up, sets up and is approved (and gets the email); a visitor finds them, picks a time, creates an account and lands back on that time; asks with a note; the host accepts; the call happens; both rate; each is in the other's contacts; then a paid call with the sandbox host from the saved card to the hold, the charge and the host's payday. Then every page as a visitor, a customer, a host and the founder: it answers as it should, has the right top bar and its own tab title, and every link on it leads somewhere. The top of the script says what is real and what is pretended (the ID check, who was connected, the passing of days).
- To prove the script has teeth, two things were broken on purpose (the "book again" rule, and the top bar on one page): 4 checks failed, and all passed again with them back.
- 248 automatic tests (6 new for the "come back here" rule, 4 for the host emails), lint, types and the build pass.
- The nine earlier journey scripts all pass: accounts 100, safety 60, notifications 33, booking 94, "call now" 73, adding time 107, ratings 73, verified customers 30, payments 71.
- By hand in a browser, as a visitor with a throwaway account: the front page, a host's page, picking a time, "Create an account", the confirmation link, the welcome step, and landing back on the chosen time with the full top bar. Also looked at on a phone-width screen.

**CodeRabbit's review (pull request 16):** 12 comments. Each was checked against the code or the source before anything was changed; all 12 held up and all were taken, each as a small change.
- In the app (3):
  - The new sentence on the host's "Requests for calls" page said that requests for a call right now are not listed there. They are, and they can be answered there. The sentence now says so, and that they need an answer within 2 minutes and show up live on "Available now".
  - The suspension email said waiting requests "have ended" while that work is done a moment later and can fail. It now says they are being ended.
  - The journey script stopped with an error if the test host had no free time more than 4 days ahead, before it reached the walk over every page. It now skips only the paid part, with a note (tried by pretending there was no such time: 48 checks ran and passed).
- In the messaging research notes (9), which are what a later build would start from:
  - The reason given against end-to-end encryption was wrong ("reports could not be reviewed"). A reporter's own device can hand messages over. The real reasons: we could see only what a reporter hands over, could not save a whole conversation as evidence ourselves, and the build would be far larger. Corrected in the comparison page and the safety note. (The builder's main report did not make the claim.)
  - Three points on how messages would be ordered and counted: do not use time-based ids as the "what is new" marker; take the conversation's lock before a message gets its number, not after; and a person's own message must not show them an "unread" dot.
  - The one-year keeping of evidence for a report to the national hotline (NCMEC) runs from the day our report is submitted, not from the user's report.
  - Two sentences claimed too much: booking-only messaging narrows abuse, it does not remove it, and it does nothing about abuse inside a booking.
  - One price summary included a service whose price at 10,000 users could not be found.

**A second look (15 November 2026), asked for by the founder:** the builder read the whole change again and tried the "come back here" rule on a set of real and hostile addresses; nothing new was found. Astra reviewed the branch a second time: eight of its nine earlier points confirmed fixed, and two points left.
- Taken: when a call's record needs review, the two people were told that Connect looks at it "before anything is charged". That is not always true: a call can be charged and its record turn out wrong afterwards. The sentence now only says a person at Connect looks at it; the receipt above it says what happened to the money.
- Not taken: Astra asked again that the journey script charge only its own call, by adding a "this call only" option to the charging step. The script runs that step with the real clock, so it does exactly what the always-on helper does every minute anyway, and only on this computer's test database. Adding a test-only option to the money code is not worth that. The script's header says what the step does.

**What the checks cannot cover:** a real two-person video call, the real ID check at Stripe and real email delivery, as before. The words on the front page are a first draft for the founder to change.

---

## Module 10: Connection check before a call

Plan: `plans/12-connection-check.md`, checked three times by Astra and once by CodeRabbit before any code was written (pull request 17). The founder's idea: hosts do their own customer service, so a call that goes badly because of someone's internet should not become a complaint against the host. A short check before the call tells each person whether their own connection has a problem, while there is still time to do something about it.

**What the founder decided (15 November 2026)**

| Question | Decided |
| --- | --- |
| A weak or failed test | Warn only. Joining is never blocked. |
| A sign during the call when someone's connection is weak | No: it distracts the person on the call. The small bars icon of the video toolkit is hidden too. |
| Keep the result, or show it afterwards | No. Nothing is kept, and nobody sees anyone else's answer. |

**What was built**
- **The test**, about 12 seconds, in the background, on the person's own device. It connects to the video service the way a real call does, but to a private test room; sends a made-up moving picture (not the camera) for about 8 seconds; reads the reports the video service sends back (how long a round trip takes, how much was lost); and cleans up after itself. It can be stopped at any moment. It is written with the video toolkit the app already uses, not with that toolkit's ready-made test, which cannot be stopped and leaves a drawing loop running.
- **Four answers in plain words**, each with a tip: no problems found; weak (round trip over 0.4 seconds, or more than 3% lost); could not connect; not measured. A figure that is missing or makes no sense is never taken to be good. A failure on our side is "not measured", never a problem with someone's internet.
- **Where it shows.** On a call's page, above the countdown and the camera check, it starts by itself once. Pressing "Join" stops it at once: joining never waits for it. On a page of its own, "Test your connection", linked from Hosting and from "Available now". "Test again" always works.
- **A private test room, never a call's room.** The server makes up the room's name and the name the test connects under, both from the test's own number. The room takes one participant; the pass can send and not receive, and can only be used to connect in its first minute. Messages from the video service about a test room belong to no call and are not kept, so a test cannot reach a call's record or its charge.
- **Limits:** 10 tests per person per hour, and at least 20 seconds apart, counted under a lock of that person's own. For logged-in people, from our own pages, not for a paused account, and not while the founder's "stop joining" switch is on.
- **Tidying up.** The always-on helper ends every test 90 seconds after it started, in a loop of its own: it cancels the pass, deletes the room, and marks the test only when the video service confirms the room is gone. No pass is handed over when making the room took 20 seconds or more, so nobody can still connect after the tidying up. Rows are removed after a day, but only those whose room is confirmed closed.
- **During a call** the bars icon in the corner of a person's picture is hidden.
- **Nothing about an answer is stored or sent to the server.** One new table holds only who started a test and when, for the limit and the tidying up.

**Decisions (the builder's)**

| Question | Decided | Why |
| --- | --- | --- |
| When the test starts by itself on a call's page | Only when the call starts within 30 minutes; before that the person can start it with a click | The plan said "once, by itself". A check a day ahead says nothing about the connection at call time, and would use allowance for nothing. |
| How "Join" stops the test | The call screen announces that "Join" was pressed, and the test listens | The test sits outside the call screen, which redraws every second; this way neither has to know the other's insides, and joining waits for nothing. |
| What the browser remembers | Two notes in the browser tab only: when a test last finished (no test starts by itself within 15 minutes of it), and, per call, that the person pressed "Join". Never the answer | As planned. |
| The step that keeps a message from the video service | Moved into a function of its own, unchanged | So the check script can prove that a test room's messages are not kept. |

**Astra's review of the code** (15 November 2026): ship with changes. It confirmed that a test cannot touch a call's room, its attendance record, the "one call at a time" rule or a charge, and that moving the step that keeps the video service's messages into its own function changed nothing. Ten points:
- Taken (must): the check script pretended, for every person's tests, that their rooms were closed. On a shared database that would have left other people's test rooms unwatched. Everything the script pretends is now kept to its own made-up person.
- Taken (must): a test's starting moment was read before waiting for the person's lock, while the 20 seconds were counted from after it. A start that had to wait very long could have been handed a pass for a room the helper had already tidied up. The moment is now read once, with the lock held, and both counts start from it.
- Taken (must): a test that was about to start by itself could still start after "Join" was pressed. Pressing "Join" now cancels it.
- Taken: a call's page opened more than 30 minutes early and left open never started the test by itself. The page now waits for the moment.
- Taken: every failed attempt to connect was called "could not reach the video service", also when the video service itself refused or failed. Only a real failure to get through says so now; the rest is "not measured".
- Taken: a hundred tests that keep failing to close could have kept all later ones from being ended. They are now picked in no fixed order.
- Taken: tools that delete a made-up person removed that person's tests without ending their rooms. They now end the rooms first, and keep the record when a room cannot be confirmed closed.
- Taken: two checks claimed more than they tested (the room's one-participant limit is now read back from the video service; the tidying up is labelled as being of an empty room). Added: the room cannot be made at all; a start that had to wait for the lock.
- Taken: a test in a browser tab that is in the background ends as "not measured": the browser slows such a tab down, and what would be measured is that, not the connection.
- Noted, not changed: the video toolkit keeps one shared waiting time per project after a failed connection. A "Join" pressed right after a test that could not connect may inherit a few seconds of it. A call would not connect on that network at that moment anyway, and avoiding it would mean changing the toolkit.

**How it was checked**
- A new script, `scripts/connection-check.ts`: 27 checks against the local database and the real video service. The limits (10 an hour, 20 seconds apart, three starts at once); no pass when making the room took 20 seconds or more, or failed; a start that had to wait; a real test room with its pass (the server's own room and name, send only, one minute, one participant); messages about a test room are not kept for any call; the helper ends a test after 90 seconds, tries again when the room is not confirmed gone, and removes old rows only when closed; nothing pretended touches another person's tests.
- 300 automatic tests (12 for the rule that turns figures into an answer), lint, types and the build pass.
- The eleven other scripts pass: the whole journey 60, refund requests 104, payments 141, adding time 110, accounts 100, safety 60, notifications 33, booking 94, "call now" 73, ratings 73, verified customers 30.
- By hand in a browser against the real video service, as the test host: the test on its own page answered "No connection problems found" after about 12 seconds; on a call's page it started by itself above the countdown, the countdown and the change to the camera check did not restart it, pressing "Join" in the middle of a test removed it at once, and in the call the bars icon was hidden. A failure on our side (a local server holding old code) correctly showed "not measured".

**CodeRabbit's review (pull request 21):** four comments. Each was checked against the code first; all four held up and all were taken, each as a small change.
- A connection that dropped in the middle of a test could still be called "no problems found", because the good reports from before the drop were kept. A connection that is lost, or has to be made again, during the test is now "weak", whatever came back before. This is in the one shared rule, with tests. (CodeRabbit asked only that it never be "good". "Weak" was chosen over "not measured" because a connection that drops within a few seconds is exactly what the test is there to catch.)
- On a call's page the moment for starting the test by itself was worked out with the device's own clock. A device with a wrong clock would have started it late, or not before the call. The server now says how long to wait, from its own clock.
- If a person started the test themselves a few seconds before that moment, the automatic start would have stopped their test and started another, which the 20-second rule then refused: they would have seen "not measured". A test that is running is now left to finish.
- The check script used the seed customer as "somebody else" and removed all of that person's tests afterwards. It now makes a second made-up person for that, and removes only its own made-up people.

**A second look by the builder (15 November 2026), asked for by the founder:** the whole change was read again, line by line. The server side, the rule and the test itself were found sound. Two small things in the box on screen were changed, and nothing was added beyond them.
- When the moment for starting by itself came while the page was in a background tab (a call's link opened and left for later, which is common), the test ended at once as "not measured", and then did not start again by itself for 15 minutes. It now waits until the person looks at the page.
- If the page around the box had been drawn again while a test was running, the test would have been stopped and the box left saying "Testing…". Nothing draws that part of the page again today; the box now no longer depends on it.

**What the checks cannot cover, and the founder's friend tests must:** a weak connection (it cannot be made on this computer), a real iPhone, hotel Wi-Fi, mobile data on the move, and a network that blocks video calls. A test that is still connected when the helper ends it could not be tried either: that needs a browser held open on purpose. The two limits may need adjusting after the friend tests.

---

## Module 11: Refund requests, taking the money later, and a record of call quality

Plan: `plans/13-connection-refunds.md`, ninth version, checked by Astra six times and by CodeRabbit before any code was written (pull request 18). Built after module 12, because it relies on hosts collecting their own earnings.

**What the founder decided (15 November 2026)**

| Question | Decided |
| --- | --- |
| What a booked call charges | Stays as it is: the time the host is in the room. |
| How long a customer has to ask | 24 hours after the call ends. |
| The reason | The customer picks one: "The connection was bad" or "Something else". |
| Who answers | The host, within 24 hours, with a message if they like: charge in full, less, or nothing. Passing a "no" on to Connect is left out for now. |
| When the money is taken | About 24 hours after the call when nobody asked. With a request: at once when the host answers; with no answer, about 24 hours after the request. |
| The safety limit | Never later than 12 hours before the card's hold ends. |
| No answer in time | The money is taken in full, and the host cannot collect that call's money until they answer. Nothing is refunded or refused automatically. |
| A record of call quality | Collected for every call. Shown only for a request about the connection: to the customer before they confirm, then to the host. The founder can see it for any request. |
| Refunding automatically | Later, once real calls show what good and bad calls look like. |

**What was built**
- **When the money is taken.** Minutes after a call the amount is worked out and shown to both people as "To be charged", with the time. It is taken 24 hours and 10 minutes after the call when nobody asked; when the host answers a request; or 24 hours and 10 minutes after the request. (Changed later the same day: counted from the call's start, with 3 minutes in place of the 10; see "A later change" below.) Never later than 12 hours before the hold ends, and the app keeps trying until the hold ends. Before any money is taken the call's record is looked at again. A charge under the founder's review, a record that is not complete, and a charge for cancelling late keep exactly the rules they had.
- **One locked step per call.** With the call locked, the request and its answer are read, the record is looked at again, and the charge (or the release) of each payment is written down before Stripe is asked. An answer is saved under the same lock. So whichever was written down first is what happens: an answer is never replaced by "in full", and a charge that was already written down is carried out as written.
- **Asking.** On the call's page, for 24 hours: "Ask for a refund", one per call, with the reason. For "the connection was bad" the customer is first shown the call's connection record, and what is sent is what was seen: if the record changed in the meantime, nothing is sent and they are asked again.
- **The host's answer**, for each charge of the call (the call itself, and each time that was added): in full, less (at most an amount, 50 cents or more), or nothing, with an optional message of up to 300 characters. "In full" is what the record gives when the money is taken; "less" is the most the customer pays. Under 50 cents nothing is taken. The receipt says "charged $5.00 of $13.33, lowered by the host" (or "by Connect").
- **After the money was taken** the host answers with a "no" or with the refund form they already had. Every refund can now carry a message to the customer, shown beside the refund and in an email.
- **The hold on collecting.** A host cannot collect any charge of a call whose request is not answered, or whose answer is still being applied. It is checked in the same locked step that starts a collection. A request counts as answered once the host answered or said no, a refund started after the request has gone through, or the founder closed it.
- **The founder.** A list of requests still waiting, oldest first, on "Reports and safety", with the room name for the video service's dashboard. On the call's page the founder sees the connection record for any request, can answer in the host's place before the money is taken, refund, or close the request. The admin page lists money still on hold after a call with the time it is due, and shows for a lowered charge what the record gave and who lowered it.
- **The record of call quality.** One invisible piece in the call screen notes the video service's grade for each person's connection: on joining, at every change, and twice a minute in between; it sends them in small batches in the background. The server only accepts them from a logged-in person on that call, from our own pages, while the room is open, up to 4,000 per person and call. The notes are removed after 60 days. A short summary (when each person was connected and why each connection ended, in neutral words, and about how long at each grade as each browser reported it) is saved with every request and kept for a year.
- **Emails.** To the host when a request arrives, and one reminder halfway; to the customer for the answer, a late "no", a closed request, and every refund. Each is written in the same database step as what it reports.
- **An alarm that does not depend on the helper.** The helper notes the time whenever it finishes a round of payment work. The address `/api/health` answers only "healthy" or "not healthy": not healthy when that note is older than 10 minutes, when a money action has had no answer for more than 5 minutes after the usual check, or when a call's money is more than 5 minutes past the moment it should have been taken.

**Decisions (the builder's)**

| Question | Decided | Why |
| --- | --- | --- |
| The plan's on/off switch for the new timing | Not built | It was a way to build in steps. Everything lands in one pull request, so the switch would be dead code from the first day. |
| An answer that arrives in the last 10 minutes | Accepted as long as the automatic charge has not been written down yet; the lock decides | The 10 minutes exist so that a late answer still counts. Refusing it by the clock would throw that away. |
| An answer that loses the race with the automatic charge | The host is told the money has been taken and uses the refund form | Turning it into a refund automatically would be a second way to refund, for a case the 10 minutes all but remove. |
| "Took place" (who can ask) | A paid call that was not cancelled, has ended, and still has money on hold or taken | When nothing was charged there is nothing to ask back. |
| A request on a call whose hold was released after a review | Needs no answer, and is not on the founder's list | Nothing was charged. The page says so. |
| The customer's email about an answer | Sent when the answer is saved, and says what the host decided; the exact amount is on the call's page | The answer is the news. The email is written in the same step as the answer, so it cannot be lost if the money step is finished later by the helper. |
| When a record stops adding up at the moment the money is taken | It goes to the founder's review under today's deadline; past that deadline the hold is released | The plan's rule: a doubtful record is never charged automatically, and a refund request starts no new deadline. An automatic check flagged this; see the reviews below. |
| The terms and the privacy page | Not changed | Both are placeholders for the lawyer. What they must say is on the launch list. |

**Astra's review of the code** (15 November 2026): ship with changes. It found no way to take a charge twice, and judged the point the automatic check had flagged (a record that stops adding up after the review deadline has passed: the hold is released) acceptable as built, because restarting the review clock would go against the plan. Ten points:
- Taken (must): after a host had answered "at most $7", a charge that then came under the founder's review could be charged in full by the founder. A reviewed charge now stays within an answer that was already accepted, and after "charge nothing" the hold can only be let go.
- Taken (must): inside the locked step the call's record and the quality summary were read over a second database connection. Under load every connection could be held by a step waiting for another one. Both are now read through the step's own connection.
- Taken (must): when one charge of an answered call came under review, the other became collectable while the answer was not finished. An accepted answer now holds the call for as long as any of its money is on hold.
- Taken: the shared moment for a call's charges could move later after one of them had gone through. It is now decided by the earliest hold among all the call's charges, also those already taken.
- Taken: after a refund had answered a request, an old "no" or the founder's "close" could still be saved over it and send a second, contradicting email. A refund that went through now protects the outcome. The locks are also taken in the stated order in every step: the call, its payments, then the request.
- Taken: the health check did not see an accepted answer for which nothing was started when the call's room could not be confirmed closed. It now does.
- Taken: after a year the request's texts were removed, but copies stayed in the saved emails. Those go too; the record that each email was sent stays.
- Taken: a charge waiting to be taken showed what the record gives even after the host had answered "at most"; it now shows what the answer allows. A request on a call under review said the money "has been taken"; the page and the host's email now say it is still being decided.
- Taken: four checks claimed more than they tested and were renamed, and the missing cases were added (an answer followed by a review; two charges with different hold ends; a refund followed by a stale "no"; each order of the race between an answer and the automatic charge, on purpose).
- Taken: a reminder to the host that is still waiting to be sent is dropped once the request has been answered.

**How it was checked**
- A new script, `scripts/refunds-check.ts`: 104 checks against Stripe's test area. Who may ask and when (including the last seconds); the two reasons and "what is sent is what was seen"; the host's three answers on a call with one charge and on a call with added time, each taking exactly that amount once; an answer and the automatic moment at the same instant, in both orders; an answer saved before the record is final and carried out later by the helper; one charge through and one whose answer from Stripe never came back; no answer, then taken in full; a late "no", a late refund in full and in part, one on its way, one that failed, one started before the request, a stale "no" after a refund; the founder answering in the host's place, closing before and after the money was taken; a call under review with a request open, released when nobody decides; an accepted answer followed by a review; two charges with different hold ends; the hold on collecting and its release; the health answer; the notes about connection quality (who may send them, when, how many); the reminder; what is kept for a year.
- To prove the new script notices mistakes, two rules were switched off on purpose (the host's "at most" and the hold on collecting): 16 checks failed, and all passed again with the rules back.
- The payments script now checks that nothing is taken minutes after a call, still nothing a minute before the planned moment, and the charge at 24 hours and 10 minutes; a late cancellation is still charged at once. 141 checks.
- The added-time script checks that both charges of a call wait for the same moment (110 checks). The whole-journey script checks that the customer sees "To be charged" and "Ask for a refund" on the call's page, and is charged a day later (60 checks).
- The other scripts pass unchanged: accounts 100, safety 60, notifications 33, booking 94, "call now" 73, ratings 73, verified customers 30.
- 288 automatic tests (new ones for the timing rule with the plan's own table of hours, the quality summary, the notes, who may open the record, and "from our own pages"), lint, types and the build pass.
- By hand in a browser, with a made-up call in which the host's connection dropped for a minute: as the customer, "To be charged" with its time, the connection record shown before sending, the request sent; as the host, the request with the same record and the time by which an answer costs nothing, the answer "at most $6.00" with a message; the receipt then read "Charged $6.00 of $12.00, lowered by the host". The host's page before any request shows no record and no request.
- In a real call with the video service (one browser, camera and microphone refused by the test browser): the call screen sent its notes, first "unknown" on joining and then "excellent", stamped with the server's clock.
- The health address answered "not healthy" with no helper running, and refused nothing else it should not.

**CodeRabbit's review (pull request 20):** five comments. Each was checked against the code first; all five held up and all were taken, each as a small change. None was about money being taken wrongly.
- The founder's list of waiting requests said "the money has been taken" for a call whose charge is still on hold and under review. It now says the charge is still being decided. (Astra's review had corrected the same wording on the call's page and in the host's email; this list was missed.)
- When a person left a call, only the first 60 of the notes still waiting to be sent went out; after a stretch of bad connection there can be up to 300, and those are the ones that matter most. Everything waiting is now sent on leaving.
- The helper noted "payment work finished" also when it had done no payment work, because Stripe's key was missing. So the health address could say "healthy" while no money was being taken. The note is now only written when the work really ran. A deployment without Stripe's key therefore answers "not healthy", which is right for an app that takes payments.
- After a year, the texts of a request were removed first and their copies in emails second. If the second step failed, the copies would never have been found again. Both now happen in one step, or not at all.
- "Does this come from our own pages?" compared the page's address with a header that the sender of a request can write. A browser would not let another website do that, so the risk was small, but it is now compared with the app's own address from its settings. Tried against the running app with a forged header: refused.

**What the checks cannot cover, and a friend test must:** two people in one call with a truly bad connection, to see what the grades and the reasons look like; and a real Visa card's hold from the call to the charge a day later. Stripe's test area shows amounts and steps; it does not show the real fee or a real bank's behaviour. The outside watching service for `/api/health` has to be set up with the hosting.

---

## Module 12: Hosts collect their earnings when they want

Plan: `plans/14-paying-hosts-sooner.md`, checked by Astra and by CodeRabbit before any code was written (pull request 18).

**What the founder decided (15 November 2026)**

| Question | Decided |
| --- | --- |
| How long before a call's money can be collected | 2 days after the call, down from 7. **Changed by the founder on 15 November 2026, after modules 10 to 12 were merged:** 24 hours after the call ends when the customer did not ask for a refund. (The customer's 24 hours to ask count from the call's start, so they are always over before that.) With a refund request it stays 2 days, and never before the host has answered. See "A later change" below. |
| Who starts the payment | The host, with a button. No automatic weekly payday any more. |
| How often | Once every 24 hours, counted from the host's last collection. |
| Money nobody collects | **Decided by the founder on 15 November 2026: no automatic sending.** Money a host does not collect stays until they collect it. The founder sees it on the admin page and settles old amounts by hand, and can run a final collection for a closed account. |

**What was built**
- **The date.** A host's share is ready 2 days after the call ends, to the minute, and never before the charge is recorded. (Since 15 November 2026: 24 hours when the customer did not ask for a refund; see "A later change" below.) It is fixed when the charge is recorded and never moved. Charges made before this change keep the payday date they had and are collected with the button from that date on.
- **The button.** On Hosting, under "Getting paid": what is ready (with the amount that will be sent after the 25-cent charge), what is not ready yet and why for each call, and the result of the last collection as it really stands: sent, being checked, could not be sent. It also says when the host can collect again, and that Stripe pays the bank on its own schedule.
- **One collection is a record of its own.** A press is accepted in one locked step: the same press arriving twice gets the collection it already made, the 24 hours are checked, and every share that is ready is locked, checked once more and written down as "being sent" with its exact amount, all before Stripe is asked. So two presses at once make one collection, and a crash never leaves a press that half happened.
- **What holds a share back:** being inside its 2 days, a bank dispute, a refund on its way, a money action whose outcome is not known yet, and a message from Stripe about a dispute that has not been handled. The payout account is checked with Stripe at the moment of the press.
- **The 25-cent charge** is taken once per collection, from the largest share, never more than that share. If that share fails, the charge is waived. If nothing in a collection goes through, there is no charge. It is recorded per collection; the old per-payday records are kept as history and no longer used.
- **The always-on helper** no longer starts paying anyone. It still finishes every transfer a collection wrote down, whether Stripe's answer was lost or the request never left, without the host pressing again. One exception: if the helper only gets to a transfer more than 23 hours after it was written down (it normally does within about a minute, so this means the helper was not running for a day), it no longer repeats the request, because Stripe may have forgotten it and could send the money twice. It asks Stripe whether the transfer exists. If it does, it is recorded. If it does not, the helper does not send it late: that share is ready again, the host sees it as "could not be sent; it stays ready", and it goes out with the host's next collection.
- **Hosts who cannot press.** A paused host can still collect. For a closed account the founder runs a final collection from the admin page, under the same rules, and the record says who pressed.
- **The founder's view.** The admin page lists, per host, everything earned and not yet collected, read on its own.
- **Wording.** Beside each call's payment: "Not collected yet. Ready to collect from …" with the time. The Hosting page explains the new rule and the charge.

**Decisions (the builder's)**

| Question | Decided | Why |
| --- | --- | --- |
| A message about a dispute that is not handled yet | No collection for anyone until it is handled (the helper does that within minutes); the press is refused with a sentence that says so, and uses up nothing | This is what the weekly payday did. Working out which charge the message is about, before it is handled, would be new code for a wait of minutes. |
| A very large collection | One press keeps sending for about 20 seconds; the helper finishes the rest, and the host sees them as "being checked" | A page should not hang for minutes. Nothing is lost: every transfer is already written down. |
| A share so small the charge takes all of it | It counts as sent only once another share of the same collection has gone through; otherwise it stays ready | This is what "a collection in which nothing went through carries no charge" means for the one case where nothing is sent to Stripe at all. |
| The confirmation before collecting | The amounts are shown right above the button; pressing it is the confirmation | A second "are you sure" screen adds a step and nothing else: the result is shown straight after. |
| The founder's final collection | Only offered, and only accepted, for a closed account | An open account collects for itself. |

**Astra's review of the code** (15 November 2026): ship with changes. No way was found to send a share twice, to the wrong host or account, or alongside a refund. Six points:
- Taken (must): the 24 hours were counted from the moment the press arrived, not from the moment it was accepted, so the next collection could come a little early. The moment is now read inside the locked step.
- Taken (must): when something unexpected went wrong, the host was told "before anything was sent" and the founder "nothing was changed", which could be untrue (for example when the collection was saved and only the answer got lost). Both now say that the result could not be confirmed and where to look. "Nothing was sent" is kept for refusals that happen before anything is accepted.
- Taken: while a message about a dispute is waiting, the page offered the button and the press was then refused. The page now shows the reason instead of the button.
- Taken: two checks claimed more than they tested. The rule "only for a closed account" now lives in the money code, where the script tests it (refused for an open account). The added-time script now looks at the charge really taken, not the one planned. A check was added for the helper coming back more than 23 hours later.
- Not taken: a marker for one rare in-between state (the app stops after sending the only other share of a collection of two tiny shares, before recording the charge). The helper settles it within about a minute and nothing is wrong meanwhile.
- Noted: the plan says the terms change with this. The terms page is still a placeholder for the lawyer; it has no payday wording to change. It is on the launch list.

**How it was checked**
- The payments check script, with its paying-out part rewritten around collections: 139 checks against Stripe's test area, all passing. They cover: nothing is sent without a press, however long the helper waits; a press sends everything ready and nothing else; a share a second before its 2 days stays, and exactly at them goes; another host's money is untouched; one 25-cent charge per collection; a second press inside 24 hours refused, exactly at 24 hours accepted; two presses at once, and the same press twice; the first press arriving again days later; a dispute, a refund on its way and an unhandled Stripe message each holding money back; one collection in which Stripe refuses one share and the answer for another is lost; the charge waived when the share carrying it fails; a refund refused while its share is being sent; the app stopping right after accepting, finished by the helper; a collection in which nothing goes through; the helper coming back more than 23 hours later; two shares smaller than the charge; charges from before the change, including one already being sent; the founder's final collection (refused for an open account); and a real bank dispute at Stripe.
- To prove the script notices mistakes, two rules were switched off on purpose (the 24 hours, and waiting for a refund): 6 checks failed, and all passed again with the rules back.
- 252 automatic tests (new ones for the date, for what holds a share back and for the charge), lint, types and the build pass.
- The other nine scripts pass: the whole journey 59 (the host now collects in it), adding time 108 (one collection takes the call's own payment and the added time's), accounts 100, safety 60, notifications 33, booking 94, "call now" 73, ratings 73, verified customers 30.
- By hand in a browser, as the test host: money ready with the button, a long "not ready yet" list with the reason beside each, a collection with a mixed result (two shares sent, one refused on purpose, the charge waived), the same page inside the 24 hours, and the page while a Stripe message was waiting. As the founder: the list of uncollected money and the final collection for a closed account. Also at phone width.

**CodeRabbit's review (pull request 19):** one comment, on this record itself, and it was right. The record said the helper finishes every transfer without the host pressing again. That is not so for a transfer the helper only reaches more than 23 hours later: if Stripe never made it, the share is ready again and goes out with the host's next collection. The code already did this and the check script tests it; the sentence above and two notes in the code now say it.

**What the checks cannot cover:** Stripe's real timing for paying a host's bank, and whether Stripe's own rules allow the money to sit for long. A real payout to a real bank has not happened yet (Stripe's test area only).

---

## A later change: a host's share is ready 24 hours after the call when nobody asked for a refund

**The founder's decision (15 November 2026).** Asked whether a host can collect 24 hours after a call when the customer did not ask for a refund, the builder answered that it was 2 days, and recommended keeping 2 days until real calls show how often something goes wrong after a charge. The founder decided: 24 hours when the customer has not asked for a refund.

**What changed**
- A host's share is ready **24 hours after the call ends** when there is no refund request on the call, and never before the charge is recorded.
- The customer's 24 hours to ask for a refund are counted **from the call's start** (they can ask once the call has ended). A request sent in the last seconds is still accepted for 3 minutes more, and the money of a call nobody asked about is taken then: 24 hours and 3 minutes after the call's start. A call lasts at least 5 minutes, so asking is always over, and the money taken, before the host can collect. (This is the rule since the second decision below. The first version counted everything from the call's end.)
- With a refund request on the call nothing changes: 2 days after the call, never before the charge is recorded, and never before the host has answered.
- Whether there is a request is looked at when the charge is recorded, in the same step. If the customer asks only after a charge was recorded (possible for a charge the founder makes after a review, inside the customer's 24 hours), the date of that charge moves to the 2 days in the step that saves the request. The date never moves earlier.
- The Hosting page says so.

**What this gives up, said plainly.** Once a host has collected, the app cannot refund that charge and cannot take the money back from the host. With 2 days there was a day between the charge and the earliest collection in which a host could still refund through the app, and in which a bank dispute or a changed record could still be noticed. For a call nobody asked about, that day is gone: a host can collect soon after the customer is charged. The customer's own time to ask is a little shorter than it was: 24 hours from the start of the call, so 23 hours after a one-hour call. A bank dispute that arrives later is a loss Connect carries, as before.

**Astra's review of the first version (everything counted from the call's end):** ship with changes, one point that had to be fixed. The first version made the share ready at exactly 24 hours, while a customer's request is accepted until 24 hours and 10 minutes. For a charge recorded early (one the founder makes after a review), a host could have collected in those 10 minutes and a request could still have arrived afterwards, with nothing left to refund through the app. An automatic check on the commit found the same thing. Fixed with the smallest change: the share is ready at 24 hours and 10 minutes, the same moment asking ends. Ordinary calls are not affected, because their money is only taken at that moment anyway. Also taken: a check with the real clock (a call that really ended more than a day ago), since the other checks use a pretended clock for the taking and the real one for the recording; and plainer wording on the Hosting page. Astra confirmed that every way a charge is recorded goes through the same step, that the extra look at the request cannot deadlock, and that a request which is not answered still holds the money.

**CodeRabbit's review (pull request 23):** four comments, all right, all taken.
- Three were about words: two summaries in this record and the note on plan 14 said "24 hours" where the rule is 24 hours and 10 minutes; and the Hosting page said money with a refund request "can take up to 2 days", where 2 days is the earliest, and only once the host has answered.
- One was about the rule itself. A charge the founder makes after a review, before the customer has asked, got the date of a call nobody asked about. If the customer then asked, the date stayed, so after the host's answer the money could be collected well before the 2 days that apply to a call with a request. The record had named this as an accepted edge; it is now closed instead, with a few lines: the step that saves a request moves the date of any charge of that call that was already recorded to the 2 days.

**The second decision the same day (15 November 2026): the customer's 24 hours count from the call's start.** The founder asked for a rule that is easier to say: a host can collect 24 hours after the call, and the customer's 24 hours are counted from the call's start, so that the call's own length keeps the two apart. The builder pointed out two things. First, the customer's time was counted from the call's end until then, so this is a change for customers too. Second, the 10 minutes in which a last-second request is still accepted would reach past the collecting moment on a 5-minute call, so they had to become shorter: 5 minutes would leave nothing spare, and 3 was recommended. The founder chose 3 minutes. The same 3 minutes now also follow the host's deadline to answer a request.
- What it costs: a customer has a little less time to ask (23 hours after a one-hour call), and the money is taken a little earlier.
- What got simpler: the call's length, and time added to it, no longer play any part in when the money is taken or in how long the host has to answer.
- **Astra's review of this version:** ship with changes. It found no way to collect while a request could still be accepted on any call that can be booked, also with the shortest call of 5 minutes, with added time and with instant calls, and it checked the exact boundary moments and the locks. Nothing relied on the money being taken later. One point taken: the helper the check scripts use to make a call could make a paid call shorter than the 3 minutes, which would turn the order round; it now refuses a paid call shorter than 5 minutes. A test also keeps watch that the 3 minutes stay shorter than the shortest call a host can offer. Its other points: this record and the two plans still described the earlier times (they now say what applies), and the whole-journey script took the money at a later moment than the new one (it now uses the new one).

**CodeRabbit's second review (pull request 23, after the second decision):** two comments, both right, both taken.
- The Hosting page said the money is ready 24 hours after the call ends. That is the usual case, but not when the customer's payment goes through later (a charge under the founder's review, or a card that needed another try). It now says "once the customer's payment has gone through".
- A gap in timing, raised twice. The step that saves a refund request locked only the call. A charge that was being recorded in the very same instant (in practice one the founder makes after a review) could look for a request just before it was saved, and keep the 1-day date although a request exists. Nothing could be lost by it: such a share is still held until the host has answered. But the rule "2 days with a request" would not have held exactly. Closed with two lines: saving a request now also locks the call's payments, in the same order every other step uses (the call, then its payments), so the charge either sees the request or is finished before the request moves its date.

**How it was checked:** the rule's own tests (asking ends 24 hours after the call's start; the money is taken 3 minutes later; a share is ready 24 hours after the call's end, never while the customer could still ask, also after the shortest call a host can offer; 2 days with a request; never before the charge). The payments script (142 checks, with a call that really ended 25 hours ago: its share is ready at the moment the money is taken). The refund script (112 checks: a request 24 hours and 2 minutes after the start is accepted and one a minute later is refused; a charge the founder makes early cannot be collected a minute before the 24 hours after the end, a last-second request holds it and moves its date to the 2 days, and after the host's answer it is ready exactly then; a charge and a request at the same moment both go through, and the share waits the 2 days). The added-time script (110: the moment does not move when time is added), the booking script (95, with the refused short paid call) and the whole-journey script (60). 302 automatic tests, lint, types and build; and the Hosting page read in a browser.

---

## A later change: a customer picks the length of the call (plan 15)

**The founder's decisions (15 November 2026).** A customer should be able to choose how many minutes they want, and 60 minutes should not be the most that can be booked. Each host sets their own shortest and longest call; a customer picks any length between the two, in steps of 5 minutes. The builder first proposed a top of 4 hours chosen by Connect; the founder's answer was that the host decides, anywhere from 5 minutes to 6 hours, and that a host who sets nothing gets 2 hours. The plan is `plans/15-custom-call-lengths.md`.

**What changed**
- **For a host:** on the calendar page the tick boxes are gone. There are two lists, "Shortest call" and "Longest call", each from 5 minutes to 6 hours in steps of 5 minutes. A shortest call that is longer than the longest is refused with a plain message. A new calendar starts with 30 minutes to 2 hours.
- **For a customer:** on a host's page the row of buttons became a list, "Length", with the price next to each length ("25 minutes, $33.33"), and a "Show times" button. The length shown before any choice is the one closest to 30 minutes that the host offers. "Call now" has the same kind of list, with only the lengths that still fit. Both work without any script in the browser.
- **The ceiling of 6 hours** keeps the longest possible call what it was (60 minutes booked plus added time). Adding time during a call stays, and the rule is now written down that a call is never longer than 6 hours in all.
- **Instant calls** keep the limit they had: 1 hour 55 minutes, because a host can switch "available now" on for at most 2 hours.
- **Nothing changed in the database.** A host's stored list simply holds every step between their shortest and longest call. Lists ticked before this change are kept as they are until the host next saves the calendar page.
- **A small repair that longer calls made matter:** the email "the room for your call is open now" used to be dropped only at the call's end if it could not be sent in time. For a long call it could have arrived hours late. It is now dropped 5 minutes after the call's start.

**Said plainly.** The whole price is held on the customer's card before the call. The largest possible hold is now $24,000 (6 hours at the highest price a host can set, $1,000 per 15 minutes). The app and Stripe carry that amount; whether a bank allows it is another matter, and a bank dispute over such a call would be a large loss for Connect. After a 6-hour call a customer normally has 18 hours left to ask for a refund (the 24 hours count from the call's start).

**Astra's checks of the plan:** twice, both "ready with changes", every point worked in (they are listed at the end of the plan). The second check was made after the founder's answer on the longest call, and confirmed that a 6-hour call booked up front is safe: the hold on the card has 18 hours to spare in the worst case, open times work across midnight and when the clocks change, and $24,000 fits the database and Stripe.

**Astra's review of the code:** ship with changes. It found no fault in the app itself: the new rules hold for odd input (missing fields, fractions, huge numbers), added time cannot take a call past 6 hours also when a request is accepted late, the two lists work with how the pages read the chosen length, and nothing else in the app still assumes the old list or a 60-minute top. Three small points, all taken: one check in the booking script could have passed for the wrong reason (it now asks for the exact refusal); the 25-minute and 90-minute calls are now also booked with a paid host, with their prices checked and the long one accepted; and an unused number was removed.

**How it was checked:** 319 automatic tests (the lengths that can be offered, the list between a shortest and a longest call, the length shown first, a length in words, the 6-hour limit on added time, open times for a 6-hour call across midnight and on a night the clocks change, the earliest and an early-ending card hold with a 6-hour call, the largest price, and when a reminder is dropped). The booking script (116 checks: a host with 10 minutes to 2 hours; 25-minute and 90-minute calls asked for and accepted, free and paid, at the right price; lengths outside the range or not a step of 5 refused for that reason; a new calendar's default; an existing calendar kept; a 6-hour call at the highest price asked for and accepted, total exactly $24,000). The instant-call script (74: a host with every length offers up to 1 hour 55 minutes and no more), the added-time script (114: a call of 5 hours 50 minutes can get 10 more minutes and then nothing), and the payments script (145: $24,000 held and charged in Stripe's test mode). The other eight scripts unchanged and passing, lint, types and build. By hand in a browser: the calendar page (a wrong order refused, a range saved), a host's page with the list at 25 minutes and at 1 hour 30 minutes, and both pages at phone size. Not seen in a browser: the "Call now" list, which shows only while a host is available.

---

## A later change: a host needs one confirmed social media account (plan 16, part 1)

**The founder's question (15 November 2026).** How do we make sure an influencer is who they say they are? Could a host connect their Instagram, so that one Instagram account belongs to one host and customers find the host by that name? The plan is `plans/16-proven-social-accounts.md`.

**What was there already** (modules 3 and 8): a host can add a name on Instagram, TikTok, YouTube or X and prove it with a code in that account's bio, which the founder confirms; a name can be confirmed for one host only; only confirmed names are shown; search finds a host by a confirmed name. What was missing: proving an account was optional.

**The founder's decisions.** A host must prove at least one account, on any of the four networks, before they can be approved. The ID check for hosts stays (the founder first chose to drop it and reversed the same day: it is the only proof that a host is 18 or older). Instagram is a proof, not the way to sign in.

**What changed**
- **Approval** asks for one confirmed social media account as well as the passed ID check. The founder's page shows each waiting host's confirmed accounts as links, to compare with the name and the handle, and says so when there is none.
- **An approved host cannot remove their last confirmed account**, or give it a different name (which would start the proof again). They are told why. A host who is not approved can change their accounts freely, because approval looks again.
- **For a host,** "Getting started" has a new step 3, "Prove one social media account", and the note under "We approve your page" says which of the two (ID, account) is still missing.
- **A gap closed on the way:** a profile could be approved after its account had been closed, and would have been public the moment the account was opened again. Approving a closed account is refused.
- **Small:** pressing "Remove" used to say "removed" whatever happened. It now shows a refusal, and otherwise says the account is no longer on the profile (true also for a second press).
- Nothing changed in the database. Hosts approved before this change (test accounts only) stay approved.

**Part 2 of the plan, "Connect your Instagram", is not built.** It was planned against Meta's "log in with Instagram". When the founder's Meta developer account and app were made, Meta's own page said: "API setup with Instagram login is not available for newer apps". The replacement ("Unified login") needs the app to sit in a Meta business portfolio, sends the host through a business-style sign-in, and its ready-made set-up asks the host for far more than a name (their ads, messages and posts). The founder then asked that confirming happen by itself, with nothing to confirm by hand. That is the next piece of work and gets its own plan; what was learned is in the plan under "What changed while building". Until then an account is confirmed as before: the founder looks at the bio and presses "confirm".

**Done at Meta the same day, with the founder's go-ahead:** a Meta developer account; an app named "Connect" (Instagram use case); the app connected to the founder's existing business portfolio (after a security check the founder passed); the founder's own Instagram account added to the app as a tester and the invitation accepted. No keys were created or stored.

**Astra's check of the plan:** ready with changes, 12 points, all worked in (they are listed at the end of the plan). The most important: tie the return from Instagram to the person who started; take the profile's lock before reading the accounts; protect the last account only for approved hosts.

**Astra's review of the code:** ship with changes. It confirmed that approval, removal, renaming and profile editing wait for each other, that nothing else in the app approves a profile or changes social accounts, and that a closure always wins over an approval. Its points:
1. *Taken.* An approval and the adding of an account on another network could block each other for good (a deadlock): the approval held the person's row in a way that made the new account wait. The person's row is now locked more gently, and first, in every step.
2. *Taken, with the same change.* For a person with no profile yet nothing was locked, so a profile made and approved in that instant could have lost its only account. The person's row is locked also then.
3. *Taken.* The accounts script's clean-up could still stop half way (a profile one test person decided on points at that person). Profiles are removed for everyone first.
4. *Taken.* The "at the same moment" checks accepted any failure as a pass. Each now names the one outcome it may have and the reason for the refusal. A check was added for the deadlock in point 1.
5. *Not taken.* A host approved before this change sees the new step as still to do, under a sentence saying people can ask once every step is done. Only test accounts are in that state, and no real host can get into it.
6. *Taken.* The message after "Remove" (above).

**How it was checked:** 319 automatic tests, lint, types, build. The accounts script (116 checks; new: no approval without a confirmed account, without the ID check, or with an account still waiting; approval with both; the last account of an approved host cannot be removed or renamed, and the reason is said; an unconfirmed one can always go; two removals at the same moment; an approval and a removal at the same moment; adding accounts while the founder approves; a host who is not approved can remove theirs and then cannot be approved; a closed account's profile cannot be approved). The whole-journey script (63: the new step and its notes on the Hosting page, the founder refused without a proven account, the code shown, approval after the founder's "confirm"). The safety script (60: a missing ID check still refuses, now with an account already confirmed). The other nine scripts unchanged and passing: notifications 33, booking 116, "call now" 74, adding time 114, ratings 73, verified customers 30, refund requests 112, connection 27, payments 145. By hand in a browser: the Hosting page (the new step, adding an account, the refusal when removing the last one, phone size) and the founder's page (a waiting host with two confirmed accounts as links, one with none, and the refusal when approving that one).

---

## A later change: Connect confirms a host's account by itself (plan 17)

**The founder's instruction (15 November 2026).** Confirming an account must happen by itself; the founder does not want to confirm anything by hand. The plan is `plans/17-automatic-confirming.md`.

**What was found out first, with the founder's own Meta and Google accounts**
- Meta's "log in with Instagram" is "not available for newer apps" (Meta's own words). Its replacement serves only people with a role on our app until Meta has reviewed the app and verified a business.
- Meta's official way to read a professional account's public details by name ("Business Discovery") works today, before any review. With a key for our own account, Meta returned the bio of an account that is not ours. It needs two read-only permissions.
- YouTube's official service returns a channel's description for its handle, with a free key.
- TikTok and X offer no free official way to read a bio.

**The founder's decisions.** Instagram and YouTube are confirmed by Connect itself. TikTok and X stay confirmed by hand for now; TikTok's own sign-in is the next plan.

**What changed**
- **For a host:** next to an Instagram or YouTube account the button now says "Check now". Connect reads the bio (on YouTube, the channel's description) through Meta or Google and, when the code is there, confirms at once: "Account confirmed. You can remove the code." Otherwise the host is told what happened: the code was not found; the account could not be read (on Instagram it must be a Creator or Business account); the check is not available right now; or to wait before checking again.
- **For the founder:** new Instagram and YouTube requests no longer come to the list of accounts to check. If Meta or Google does not accept our key, the admin page says so in one line ("did not accept our key or our permission in 3 checks in the last 24 hours"), because nothing else would show it.
- **A wrong answer cannot confirm anyone.** Only a bio that really showed this host's code a moment ago confirms, and only if the entry is still the same one: same person, name and code, not confirmed, code not run out. Any failure confirms nothing.
- **Limits.** One check every 30 seconds per person and network, 10 an hour per person, 100 an hour for all of Instagram together (half of what Meta is assumed to allow). They survive removing an entry and adding it again.
- **The database:** one small new table, `bio_checks`: who, which network, when, and how the check ended. Never the bio's text.
- **Settings:** `INSTAGRAM_CHECK_TOKEN` and `INSTAGRAM_CHECK_ACCOUNT_ID` for Instagram, `YOUTUBE_API_KEY` for YouTube. A network whose settings are missing is confirmed by hand as before, so the app runs without them.
- **Small:** "That does not look like a Instagram name" now says "an Instagram name".

**Said plainly.** Only Creator and Business accounts can be read on Instagram; a personal account cannot be confirmed this way. Meta allows this today for an app that has not been through its review, and could stop. Then hosts are told the check is not available, the founder sees the line on the admin page, and the choice is Meta's review or confirming by hand again.

**Set up outside the app, with the founder's go-ahead:** at Meta, the app "Connect" with two read-only permissions and a key that does not expire; at Google, a project "Connect app" with YouTube's service switched on and a key that may use that service only. The founder created both keys and saved them; the builder never handled them.

**Astra's checks of the plan:** twice, both "ready with changes", all points worked in (listed at the end of the plan). The most important: limits that one person cannot get around; exact guards on the confirming step; a refused key must be visible to the founder; and, from the second check, one simplification (our own account's number is a setting, so a check is always one request).

**Astra's review of the code:** ship with changes. It found no way to confirm an entry wrongly through any of the races it walked (adding, removing, the founder confirming or rejecting, approval), the limits sound, and the readers right for the real answers. Its five points, all taken:
1. The keys travelled in the address of the request, and this version of Next.js can write an address to its log when a request fails in a certain way. The keys now travel in a header, and a request never follows a redirect. Both services were tried for real that way.
2. Three more of Google's answers that mean "our key is the problem" are now counted for the founder's warning.
3. The script's "while a check is under way" cases could have waited for ever if a check ended early. They now fail at once, and always let the held-back answer go.
4. One message told a host "nothing was confirmed" in a case where the founder had just confirmed the account. It now says the check made no change.
5. Three sentences that promised more than is true in every state (the page's introduction, the founder's list, and "bio" where YouTube has a channel description).

**How it was checked:** 335 automatic tests (16 new: the code in a bio; Meta's and Google's answers as they really came back, and every group of their error numbers and reasons). The accounts script (141 checks, 25 new, with pretended answers: not found then found; every failure; the three limits and the ways around them; six presses at once; five things happening while a check is under way; two hosts and one account; an entry already waiting; settings missing). The other eleven scripts unchanged and passing: the whole journey 63, safety 60, notifications 33, booking 116, "call now" 74, adding time 114, ratings 73, verified customers 30, refund requests 112, connection 27, payments 145. Lint, types, build.

**For real, against Meta and Google,** in the local app with the founder's own Instagram account, before and again after Astra's fixes: "Check now" with no code in the bio gave "not found"; with the code in the bio it confirmed at once; searching for the Instagram name then found the host. A YouTube handle that does not exist gave "could not read". The founder's bio was put back as it was each time. Not tried for real: a YouTube channel with the code in its description (the founder has no channel to try with; the reading of Google's answer is covered by the tests and by a real request for a known channel), and a personal Instagram account.

---

## A later change: a host proves a TikTok account by signing in at TikTok (plan 18)

**Why.** After plan 17, Instagram and YouTube are confirmed by Connect itself; TikTok still came to the founder's list, because TikTok has no free official way to read a bio by name. TikTok does offer its own sign-in ("Login Kit"). The founder asked for it on 16 November 2026. The plan is `plans/18-tiktok-sign-in.md`.

**What changed**
- **For a host:** a button, "Connect your TikTok". The host logs in at TikTok and agrees to share their name; TikTok sends them back and the account is confirmed at once: "TikTok @name is confirmed." No code in a bio. A renamed account is updated by pressing the button again.
- **While the sign-in is switched on, a new TikTok account can only be proven this way.** TikTok is not in the list for adding an account with a code, and the server refuses both typing a TikTok name and "I've done it" for a TikTok entry, so a form from an old page cannot put a new request on the founder's list. A request that was already waiting stays until it is dealt with.
- **For the founder:** nothing to do for a new TikTok account. If TikTok does not accept our own keys or the permissions we ask for, the admin page's warning line says so for TikTok, as for Meta and Google.
- **What Connect asks TikTok for:** the account's number (for our app) and its name. The key TikTok gives is used once, handed back to be cancelled, and never stored. Our secret travels in the body of a request and the key in a header, never in an address.
- **The database:** one new column on `social_accounts`, `provider_account_id`, and a guard that one account number is confirmed for one host only.
- **Settings:** `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. The sign-in is on only when both are there and the site's address is a plain `https` address. Off, nothing changes for TikTok: it is confirmed by hand as before.
- **Small:** in development the framework prints the address of every request; the address TikTok returns a host to holds a one-time code, so it is left out of that.

**Tried for real in TikTok's test mode (16 November 2026),** with the founder's TikTok developer account, an app named "Connect" in "sandbox" state, and the founder's own TikTok account as its one test user. In Chrome, on the app's secure test address:
- "Cancel" on TikTok's page: TikTok sends the host back, and the app says "You did not connect TikTok. Nothing was changed."
- TikTok's page lets the host switch the second permission off. Tried: the app says "TikTok did not share your account's name with us. Nothing was changed. Please try again and leave both switches on at TikTok."
- **The first full try failed, and showed a real fault.** TikTok answered "The request parameters are malformed." The cause: TikTok takes a form only when it is labelled exactly `application/x-www-form-urlencoded`. The usual way of sending a form adds `;charset=UTF-8` to that label, and TikTok refuses it. No pretended answer could have shown this. The forms are now sent as text under the plain label, and a test holds that in place.
- After the fix: "TikTok @name is confirmed." The entry holds TikTok's number, is confirmed by nobody's hand, and is not on the founder's list. Searching for the name finds the host, marked "TikTok: @name (confirmed)". Connecting a second time gives the same result, one entry.
- TikTok asked for permission again the second time, which shows that handing the key back works: TikTok had forgotten the first permission.

What that settled, of the things TikTok's pages do not say: on "Cancel" TikTok returns with a refusal; the sandbox has its own keys; and the "profile" permission works in a sandbox before any approval. Not tried: whether TikTok takes a one-time code twice (nothing depends on it).

**Said plainly: it works, and it is not switched on for real hosts.** TikTok only approves an app whose website is on its own address, fully working, with real terms and privacy pages. It does not ask for a registered company. Its review takes "several days to two weeks". Until then only accounts named in the sandbox can sign in, and real hosts' TikTok accounts keep coming to the founder's list. The sandbox's keys are on the founder's computer only; the live site will get the approved app's keys.

**Astra's check of the plan:** ready with changes, twelve points, all worked in (listed at the end of the plan). The most important: TikTok's side written out exactly, with what counts as a good answer; which of TikTok's two account numbers is kept, and that a sandbox's numbers never meet the live site's; "I've done it" from an old page closed as a way onto the founder's list; a refusal of our keys told apart from everything that is not our fault.

**Astra's review of the code:** ship with changes. It found no way to attach an account to the wrong person or to confirm wrongly: the signed note, the matching value and the same logged-in person stop it in both directions; the one write under the locks covers every saving case; an approved host is never left without a confirmed account. Its five points, all taken:
1. A key from TikTok was not handed back when the answer it came in was not good enough to use (permissions missing, no account number). Any key that was issued is now handed back.
2. The site's address was compared as text, so an address written with capitals or with the usual port at the end would have switched the sign-in off without saying so. It is now read part by part.
3. One check through the running app assumed the app has no TikTok keys. It now holds either way.
4. That check could have passed even if the cookie were removed wrongly. It now reads the cookie line the app really sends: the name, the path and that it is expired.
5. The script's TikTok names and numbers were the same on every run; leftovers from a stopped run could have failed the next. They carry each run's own tag.
Astra also noted three planned cases the script did not have yet (a replacement at the same moment as a removal, as an approval, and an account closed while TikTok was answering). Added.

**CodeRabbit's review:** one comment, taken. Two of the script's same-moment checks could have passed even if the sign-in had failed quietly (the sign-in answers with a message also when it fails). They now read the message and the saved account number.

**How it was checked:** 358 automatic tests (23 new: the settings; the address at TikTok; the signed note; the permissions; TikTok's answers; the three requests with a pretended connection, including that the secret, the code and the key never appear in an address). The accounts script (new section with pretended answers from TikTok: switched off; nine ways the return is stopped before anything is asked; every saving case; two hosts and one account; things at the same moment; paused, closed or no profile; which refusals reach the founder's page; the by-hand way while the sign-in is on and off; and the return address through the running app). The other eleven scripts unchanged and passing. Lint, types, build. By hand in a browser, with pretended keys: the button appears, TikTok leaves the add-with-a-code list, and pressing the button sends the browser to TikTok's own log-in page.

---

## A later change: the new front page (17 November 2026)

**How it was chosen.** Three directions were drawn on a design canvas (calm, warm, bold). The founder chose the warm one (B), cut it down to one screen, and asked for "simple, intuitive, and user friendly". Astra then drew its own front page without seeing the others; its headline, "Go from following to talking.", was taken into B. The canvas: https://claude.ai/artifact/FpwfGTrJkmgsDVxCUa5C9i (private to the founder).

**What the page is now.** Warm off-white, the font Plus Jakarta Sans, the headline "Go from following to talking.", one sentence, one search box ("Who would you like to talk to?") that searches for real, a hint about Instagram, TikTok and YouTube names, one line of reassurance ("Every host's ID is checked. Nothing is charged when you ask."), and in the footer "Become a host", Rules, Terms and Privacy. The three steps and the longer explanations were left out on purpose.

**Who built it.** Astra built it, at the founder's request; Claude reviewed it. Only the front page changed: it draws its own top bar (still marked as the visitor's bar, with Log in and Sign up) and footer, and every other page keeps the plain look for now. The font is loaded for this page only.

**How it was checked.** Types, lint, 358 automatic tests; the accounts script (165) and the whole-journey script (63), whose front-page checks now look for the new words. In a browser: the page at computer and phone width (no sideways scrolling, the search box stacks on a phone), and a search from the front page that lands on the search results.

---

## A later change: the warm look on every visitor page (17 November 2026)

**What changed.** The look of the new front page now covers every page a visitor sees before having an account: search results, a host's public page, log in, sign up, forgot and reset password, "check your email", the welcome step, and Rules, Terms and Privacy. Nothing those pages do or say changed. Pages for logged-in people (Hosting, booking, calls, account, admin) keep the plain look for now.

**How.** The look lives in one place, `src/components/warm-ui.css` and `warm-ui.ts`: a switch on the shared page frame (`SitePage` with `warm`) turns it on per page, so it can spread to the rest of the app one area at a time. The front page uses the same styles. The top bar keeps its marks and links, so the check scripts read it as before.

**Who built it.** Astra, at the founder's request; Claude reviewed it.

**What the review found.** One real fault: Astra put the styles in a "CSS module", and in this app every `.css` file goes through Tailwind as plain CSS, so the module's class names came out empty and the pages showed unstyled (dark, no layout). Astra's own checks could not see this; it only showed in the browser. The styles are now a plain stylesheet whose every rule sits under a `warm-` class, so a page gets them only when it asks. CodeRabbit then caught a leftover of that change: three boxes (the sign-up forms, the text pages, "Available now") still borrowed the card look with a module-only line that plain CSS ignores, so they showed without their white card. They now share the card's rule directly.

**How it was checked.** Types, lint, 358 automatic tests; the accounts (165), whole-journey (63), safety (60) and booking (116) scripts, which visit these pages; the build. In a browser: search, a host's page, log in, Rules and the front page at computer width, a host's page at phone width (no sideways scrolling), and every page in scope confirmed to carry the warm look.

---

## A later change: the warm look on the customer's pages (18 November 2026)

**What changed.** The warm look now also covers what a logged-in customer sees: Your calls, asking for a call (also "call now"), a request's page, a call's results, Your account, confirming your ID, People you have talked to, Report, the paused-account page, the connection test and the email-choices page. Nothing those pages do or say changed. Still plain: Hosting, the admin pages, and the live call.

**How.** Each page turns the look on (`SitePage` with `warm`). These older pages share a small set of styles (a blue main button, a grey-bordered second button, grey-bordered fields and boxes), so `warm-ui.css` restyles those inside a warm page in one place and the pages themselves were not rewritten. Two earlier rules changed: a link inside a sentence is plain text again (as a small box it swallowed the spaces next to it), and only buttons and stand-alone links keep the large tap size; a table keeps its words whole and scrolls sideways in its own box on a phone. On a phone the top bar puts the links under the site's name.

**Who built it.** Claude, at the founder's request; Astra reviewed it.

**What the review found.** Three small things, all fixed: the grey hint text inside fields was too faint (now 4.8:1), "Forgot password?" and a host's name in the search results had lost their large tap size, and a busy button showed a pointing hand instead of the wait cursor. CodeRabbit then pointed out that links standing alone on their own line (a way back, "Choose another time") were small to tap; every such link, about twenty, now has the large tap size.

**How it was checked.** Types, lint, 358 automatic tests, the build; the accounts (165), whole-journey (63), booking (116), safety (60), ratings (73), refunds (112), call-now (74) and verified (30) scripts. In a browser as the test customer: every page above at computer width; Your calls, a call's results, the account, contacts and the asking page at phone width (no sideways scrolling). The visitor pages were looked at again, logged out.

---

## A later change: the warm look on Hosting and admin, and so on every page (18 November 2026)

**What changed.** The Hosting pages (the main page, calendar, requests, "Available now") and the admin pages (money, hosts and accounts, reports and safety, emails, the second-step setup) now have the warm look. With that, every page that uses the shared frame is warm, so the frame's on/off switch is gone: `SitePage` is always warm, and no page can be left plain by mistake. The one page still in its own look is the live call, which has no frame.

**How.** No page was rewritten: the rules added for the customer's pages (in `warm-ui.css`) already restyle the buttons, fields and boxes these pages use. The stand-alone links on the admin pages got the large tap size.

**Who built it.** Claude, at the founder's request; Astra reviewed it.

**What the review found.** One real thing, fixed: the red "close account" button on the admin reports page also carried the grey button's class, so the warm rule for grey buttons had turned it grey; that rule now leaves red buttons alone. Astra also noted something older and outside this change: on the live call, a few coloured texts are slightly too faint when the computer is in dark mode. Left for the step that gives the call screen its look. CodeRabbit was not available for this change, so Claude read the whole change again in its place and found two small things: a note in the stylesheet that was out of date, and the box around a report's quoted text, which was a dark see-through box made for a dark page and is now a light one.

**How it was checked.** Types, lint, 358 automatic tests, the build; all twelve check scripts (accounts 165, whole journey 63, safety 60, notifications 33, booking 116, call-now 74, more time 114, ratings 73, verified 30, refunds 112, connection 27, payments with payouts 145, against Stripe's test mode). In a browser: every Hosting page as the test host and every admin page as the test admin at computer width; each also measured at phone width (no sideways scrolling).

---

## Memberships: the plans (pull request 33, 18 November 2026)

Not built yet. This entry records the planning; each part gets its own entry when it is built.

**What it is.** The founder's idea (17 November 2026): a host invites a customer to a monthly paid
membership whose money is talk time, with member-only hours and bookings that need no approval.
The founder decided to build it before launch and to launch with it. The builder and Astra had
both advised building it after launch.

**The four documents**
- `plans/19-memberships.md`, the rulebook: every rule, each of the founder's decisions with the
  day it was made, what each of the three parts must deliver, and one table of what each part
  hands to the next.
- `plans/20-memberships-part-1-the-money.md`, `plans/21-memberships-part-2-member-calls.md`,
  `plans/22-memberships-part-3-the-pages.md`: how each part is built. They state no rule of their
  own. Each part is two pull requests.

**How the work is organised (the founder's decisions).** The rulebook stays the one place for
rules. All three part plans were written and checked before any building. The builder does the
work alone, without helper agents, except the small helper that starts Astra. Each plan goes back
and forth with Astra until it is sound, and so will each part's code, before CodeRabbit sees it.
The builder merges each pull request once its checks are green and CodeRabbit's points are dealt
with.

**The checks**
- The rulebook: eight rounds with Astra as the decisions were made.
- Part one's plan: three rounds (not ready, not ready, ready with changes). The findings that
  mattered most: a month could have been charged twice after an interruption longer than Stripe
  remembers a request; a pay-back that failed late would not have been tried again; a payment
  cancelled on purpose could have been started again.
- Part two's plan: two rounds (not ready, ready with changes). Most important: added time paid by
  card could have shortened a member's time to ask for a refund.
- Part three's plan: one round (ready with changes). Most important: who may see which page had
  been promised and not specified.
- The connections between the four documents: read name by name by the builder (six mismatches
  found and fixed), then side by side by Astra (sound with changes).
- CodeRabbit (pull request 33): seven comments, all right, all taken. They are listed at the end
  of the rulebook. The largest: the friend test needs memberships on for one host only, so the
  founder's switch got a middle position, "on for the hosts the founder names".

**Still open, for before memberships are switched on for everyone:** the lawyer (monthly charges
that renew by themselves, and paid time that expires), Stripe (holding a member's money for up to
about five weeks, large charges), and a friend test through a whole month with a real renewal.
They are in the rulebook under "Before this can go live".

---

## Whole-code read-through (13 November 2026, after module 8)

The founder asked for the entire code base to be read line by line for mistakes, with Astra double-checking whatever was found. Every file under `src/` and the always-on helper was read (the test scripts in `scripts/` were run, not read line by line). Three mistakes were found; Astra confirmed all three and added two smaller ones. All five are fixed.

| # | What was wrong | What it could do | The fix |
| --- | --- | --- | --- |
| 1 | "End call and report" could be sent for a call at any time, not only during it (the button is only inside the call, but the server did not check). | Before a call: a customer past the host's free-cancelling period could "end" the call instead of cancelling it and pay nothing. After a call: it could push a finished call's charge into manual review, or stop the other person from rating the call. | It only works while the room is open (from 5 minutes before the start until a minute after the end). Before that it is refused; after that nothing is changed and the person goes on to the report form. |
| 2 | Pausing an account left its requests and upcoming calls in place. | A paused customer whose money was already held could not join, but the host could, and the customer was then charged for the host's waiting time. A paused host's customers were not told. | Pausing now does what closing an account does: waiting requests end, calls that have not started are cancelled at no charge (both people are told), and the person is put out of a call in progress. The pause email says so, and the founder is told if anything could not be ended. Lifting a pause does not bring cancelled calls back. |
| 3 | A customer was shown the host's account name instead of the host's display name on the call page, the results page, the list of calls on the home page, the video itself, and the list of blocked people. | A host who uses a display name had their account name (possibly their legal name) shown to customers. | In all five places a customer now sees the host's display name. A host still sees a customer by the customer's own name, and someone who is only known as a customer is never shown as a host. |
| 4 | (Astra) If "End call and report" failed to end the call for the other person, the warning and its "Try again" button disappeared, because the person had already left the call screen. | The other person could stay connected with no warning to the one who pressed the button. | The warning and "Try again" are now shown after leaving. |
| 5 | (Astra) A call ended with "End call and report" still showed as "Open now" on the home page, and its page still offered to join. | Confusing: joining was refused anyway. | Both now say the call has ended. |

Also fixed: one check in the notifications script depended on how fast the computer was, and failed once under load; it now measures against the moments around the step itself.

**Left as it is, on purpose**
- "End call and report" pressed in the 5 minutes before the start, inside the room, still ends the call with nothing to charge. That is a real use (someone behaving badly before the start), and each one lands on the founder's review list.
- When the founder pauses or closes someone during a call, only that person is put out; the call is then charged by the usual rule.

**How it was checked:** lint, types, 197 automatic tests, the build, and all seven journey scripts (accounts 99 checks, safety 60 with 5 new ones for these fixes, notifications 33, booking 93, "call now" 72, payments 71, ratings 73). The changed pages were loaded as a logged-in customer. The video name and the two call-screen changes were not tried in a real two-person call.

**CodeRabbit's review (pull request 13):** two comments, both about the new pause step, both right and both fixed.
- If ending the paused person's waiting requests failed, their calls were never looked at, so they could stay in a call under way. Closing an account already tried the two separately; pausing now uses the very same code, so the two cannot drift apart again.
- The pause email said the requests "have ended" and the calls "are cancelled" before that work had been done. It now says Connect is ending and cancelling them. The email still goes out in the same step as the pause itself, so a paused person is always told.

---

## Things that need the founder or outside help before launch

- **Stripe:** a live account owned by the company, and Stripe's written approval for this kind of business and for the identity check.
- **A lawyer:** terms of service (including how and when hosts collect their earnings, module 12), privacy policy, the rules page, the wording customers agree to when saving a card (which now also covers keeping the card until the call is over and using it when the customer asks for more time), duties around reports involving children, how long records are kept, and which countries must not be served.
- **Email:** a real sending service and the app's own web address.
- **Real-device tests** of the video call (two people, phones, a 60-minute call), including adding time during a paid call.
- **Adding time when the bank wants its own approval step:** not possible inside a call in the first version (the request fails and the call ends as booked). Decide before launch whether it is needed; it matters most for customers outside the US.
- **Google sign-in:** move from "testing" to "live", ideally on the company's own Google account.
- **Hosting:** where the app runs, where photos are stored, and making the founder's own account the admin there.
- **Receipts by email:** switch on Stripe's own emailed receipts and refund notices in the live account (a setting, no code).
- **The front page and the look:** the words on the visitor's front page are a first draft, and the app is plain on purpose. Both are the founder's to shape.
- **Messaging:** left out of the first version; look again if real hosts ask (`docs/research/messaging/`).
- **Before the new timing goes live (module 11):** an outside watching service must call `/api/health` every few minutes, treat no reply as "not healthy", and alert the founder by email or text. Money is now taken a day or two after a call, close enough to the end of a card hold that a helper which has stopped must be noticed within minutes.
- **For the lawyer (module 11):** the terms must say that the charge for a call is taken one to two days after it, that a customer can ask for a refund within 24 hours, that the host decides, and that a host cannot collect the money for a call with a request they have not answered. The privacy page must say that a grade of each person's connection is kept for 60 days for every call, and that with any refund request a summary of those grades, the customer's sentence and the host's message are kept for a year; Connect can see that summary for every request, the two people only when the reason is the connection.
- **Friend tests of the connection check (module 10):** a weak connection, a real iPhone (Safari may answer "not measured"), hotel Wi-Fi, and mobile data on the move. The two limits (0.4 seconds, 3%) are starting values and may need adjusting afterwards. Also confirm in the LiveKit account what a connected minute costs.
- **A friend test (module 11):** what the grades and the reasons look like on a call with a truly bad connection, and a real Visa card's hold from the call to the charge a day later.
- **In Stripe (module 11):** confirm the real card fee and that the name on card statements says Connect. (An email to the customer when a hold is placed on their card: the founder decided on 15 November 2026 not to send one.)
- **Hosts' money that nobody collects (module 12):** the founder decided on 15 November 2026 not to send it automatically. Still to ask: the lawyer, about holding hosts' money for a long time, and Stripe, about how long money earned by hosts may stay in Connect's balance.
- **Putting module 12 live:** stop the always-on helper first, then update it together with the app, so the old weekly payday and the new button never run side by side.

## Memberships, part one, 1a: the money of a membership that exists (pull request 34, 18 November 2026)

The first of six pull requests. The founder's switch is off, so nobody can see or buy anything.
Nothing that makes a membership exists yet (that is 1b); the check script puts its test
memberships straight into the local database.

**What it does**
- A month of a membership gets exactly one payment at Stripe, written down before Stripe is
  asked. First the amount is only held; it is taken at the member's first booking or 72 hours and
  3 minutes after the hold.
- A saved card that fails is tried again after 1, 3 and 5 days; after 7 days the payment is given
  up and the membership paused. A bank that wants the member's own approval counts as a failure,
  and the member pays by hand.
- From the moment the money is taken, every cent of a month is in one of six places (free, set
  aside, used, expired, to be paid back, paid back), and the database refuses a month whose
  places do not add up.
- At a month's end the unused time expires to the host (she collects it with "Collect earnings",
  24 hours later), time that came back because of the host is paid back to the card, and in the
  same step the next month is written down or the membership paused.
- Paying back is owed once and tried as often as needed.
- A bank dispute freezes the month and ends the membership. The helper asks Stripe about every
  open dispute once an hour.
- Today's app knows a membership exists: a block, a paused or closed account and a suspended
  host end it in the same step; the regular price cannot go below the member price; weekly hours
  cannot be cut below what members need; a card belongs to a booking or to a membership, never
  both.
- The founder's switch has its form on "Reports and safety": off, on for named hosts, on for
  everyone. The health check and the admin page have the new lines.

**Where it is**
- `src/lib/membership/`: `rules.ts` (the plain rules, with tests), `months.ts` (the six places),
  `charge.ts` (the monthly payment), `payback.ts`, `close.ts` (month end and renewal),
  `state.ts` and `ending.ts` (pausing, ending, disputes), `cards.ts`, `room.ts`, `recover.ts`,
  `jobs.ts`, `health.ts`, `emails.ts`, `locks.ts`.
- `drizzle/0027_memberships.sql`. Changed: `src/lib/payments/` (a month as a second owner of
  money actions; a payment's kind; collecting), `src/lib/booking/` (cards, weekly hours),
  `src/lib/profiles/`, `src/lib/safety/`, `worker/closer.ts`, the admin pages.

**How it was checked**
- `scripts/membership-check.ts`, against Stripe's test area: 21 journeys, about 270 checks. After
  each journey it compares the month's books with every payment Stripe holds for the member,
  every refund and the money record. Two journeys use real bank disputes (one lost, one won).
  Run it with `--payouts --long` for collecting and for the search through more than 100 refunds.
- Broken on purpose, one at a time, and the script failed each time: the month-end pay-back,
  collecting before the money has expired, a second payment for one month.
- The twelve existing check scripts, `tsc`, `eslint`, `vitest` and the build pass.
- Astra reviewed the code three times (not ready, not ready, ready). The finding that mattered
  most: after a cut in hours, closing the older member's month first could have paused the wrong
  member. All findings are at the end of `plans/20-memberships-part-1-the-money.md`.
- CodeRabbit: about 47 comments. About half were taken. The ones that mattered most: a hold placed
  after the 7 days was still accepted if the helper had been down; and a failed look-up at Stripe
  could be recorded as "Stripe refused", also in the existing recovery of transfers and refunds
  for calls. What was not taken, and why, is at the end of plan 20.

**Found by testing against Stripe.** Stripe refuses a try in the background on a saved card while
the payment is still marked "keep this card for later". The try now takes that mark off, and
"Pay now" puts it back.

**Open points**
- A bank's question that never becomes a dispute (an inquiry) ends the membership today, like a
  dispute. The founder decides before the switch goes on whether that is wanted.
- A refund that Stripe first reports as gone through and later as failed is not handled, for
  memberships as for calls today.
- A second dispute on a charge whose first dispute was already won, and which is itself opened
  and won before any message about it is handled, does not end a later membership of the same two.
- The admin page lists expired member time in a host's uncollected total, not as a row of its own
  under "All payments". The founder's membership page (part three) will.
- `scripts/stripe-webhook-setup.ts` now asks for two more kinds of message. It has to be run
  again before memberships are tried through the browser (part three).

## Memberships, part one, 1b: how a membership comes to exist and what people do with it (pull request 35, 18 November 2026)

The second of six pull requests, and the end of part one. The founder's switch is still off and
no page calls this code yet: the pages are part three. A check in the script confirms that no
page or address of the app can start a membership.

**What it does**
- **The host's membership** (`offers.ts`): its switch, its member price and its time. Before she
  saves a change she is shown what it does, with numbers: who pays less and by how much, which
  invitations are taken back, who is paused. Members' own prices only ever go down.
- **Inviting** (`join.ts`): only someone she has had a call with, at most 3 invitations to one
  person in 30 days. An invitation holds a place for 24 hours and then ends by itself.
- **Joining and resuming** (`join.ts`): the box must be ticked; pressed twice, it is still one
  agreement and one month. What was agreed is kept on record with each month. Resuming is on the
  host's membership as it is then, and is refused if she changed it while the page was open.
- **Cancelling** (`ending.ts`): the normal way stops the renewal and can be undone until the paid
  month ends ("Keep my membership"); "Cancel now" lets the hold go while the money is only held.
  The host can pause a member after this month, or end a membership for good.
- **A cut in hours** (`booking/calendar.ts`, `room.ts`): the host chooses for each member to keep
  them, offer less time or pause them after this month, and the cut is saved only when the ones
  she keeps fit. Invitations give way before members. An offer of less time is accepted or
  declined by the member before their month ends.
- **Switching the membership off** stops each renewal; switching it on again charges nobody by
  itself. Only the member brings their own renewal back.
- **Who may see what** (`access.ts`): an invitation, a membership and a payment only for the
  person they belong to; a member still reaches a host whose page is hidden.

**The database:** one small migration, `0028_membership_offer_stop` (a third mark on a
membership). The member calls' migration in part two is now `0029`.

**How it was checked**
- `scripts/membership-check.ts` now has 29 journeys and about 460 checks against Stripe's test
  area. The eight new ones use the real way in: the host invites, the person joins and pays.
- The twelve existing check scripts, `tsc`, `eslint`, `vitest` and the build pass.
- Astra reviewed the code three times (not ready, ready with defects listed, ready). What
  mattered most: switching the membership off and on again within a month would have let members
  renew without being asked; and "Resume" from an out-of-date page could have recorded a price
  the member never saw. All findings are at the end of `plans/20-memberships-part-1-the-money.md`.
- CodeRabbit: about 31 comments, most of them taken. What mattered most: several deadlines were
  judged by when a request arrived, not by when it was handled (a request can wait for a lock past
  the deadline); and "Cancel now" could tell a member that nothing was charged while the money was
  being taken at that very moment. What was not taken, and why, is at the end of plan 20.

**Open points**
- The pages (part three) must pass on what the functions need: an invitation's id, an offer's id,
  a request id made when the page is drawn, the version of the membership a "Resume" page showed,
  and the mark of a preview before a change or a cut is saved.
- The sentences a member agrees to (`wording.ts`) now tell "Cancel now" apart from cancelling the
  normal way. They are for the lawyer's reading before launch, with the rest.
- The open points of 1a still stand (a bank's question that never becomes a dispute; a refund
  that fails after Stripe said it went through; a second dispute on one charge).

## Memberships, part two, 2a: a member books calls with their membership time (pull request 36, 18 November 2026)

The third of six pull requests. The founder's switch is still off: nobody can buy a membership,
and the check script plays both people. The pages that offer, invite, join and manage a
membership are part three; the pages a booked member call needs are in this one.

**What it does**
- **Member-only hours** (`booking/bookings.ts`, `slots.ts`, the calendar page): a host marks a
  stretch of weekly hours "Members only". Nobody else is shown those times or can ask for them.
- **Booking as a member** (`membership/book.ts`): on the host's page a member sees their time left
  and the times they can book. A booking is confirmed at once and sets money aside in the
  member's month, rounded down so every minute shown can be booked. The host's notice, the
  cancelling rule, the "confirmed ID only" rule and the daily limit on requests apply.
- **The first booking of a month** whose money is only held takes the money first and books only
  when Stripe has confirmed it. In between, the request waits at a stage of its own (`paying`)
  with nothing reserved; "Finish booking" continues it, and it ends by itself after 30 minutes.
- **After the call** (`membership/calls.ts`, `payments/take.ts`): the usual rule and the usual
  time. What the call takes is "used" and the host collects its share like any other; the rest
  comes back, as time while the member can still book from that month, otherwise to their card.
  The month's 30 cents are placed once, on the first amount that is used or expires.
- **Cancelling** moves the money in the same step: in time it comes back, by the host it comes
  back and counts as "because of the host", late it is used.
- **The founder's review, refund requests and "give time back"** (`membership/give-back.ts`) work
  for a member's call with the limits a card payment has.
- **Endings and disputes:** an ended membership cancels its upcoming member calls and the money
  goes to the card; a call under way is left to finish. A month whose payment is disputed is
  frozen: nothing of it is booked, used, given back, paid back or collected.
- **Pages:** the host's page and the booking page as a member sees them (also when the host's
  page is hidden), the booking's own page, the page after a call, the home page's line, the
  founder's deadline, the calendar's tick.
- **Changed for every call:** a call that was ended with "End call and report" can no longer be
  cancelled afterwards; its money waits for the founder's review.

**The database:** migration `0029_member_calls` (`bookings.month_id`, `weekly_hours.members_only`,
`call_extensions.paid_from`, the last one for 2b).

**How it was checked**
- A new script, `scripts/member-calls-check.ts`: 14 journeys and about 200 checks against
  Stripe's test area, with real test transfers for two member calls' shares and a card call's
  share in one collection. Broken on purpose three times (money set aside twice; used and also
  left free; a member's payment sent to the card code): it failed each time.
- The twelve existing check scripts, `scripts/membership-check.ts --payouts`, `tsc`, `eslint`,
  `vitest` (393 tests) and the build pass.
- By hand in a browser at phone size: the member's box and times, a first booking that took the
  month's money, the booking's page, cancelling, the page after the call for both people, the
  calendar's tick.
- Astra reviewed the code five times; every point was taken. What mattered most: time given back
  after a month was finished would have been promised to the card and never sent; a cancellation
  could have decided money that was waiting for the founder's review; and a first booking that
  was continued after an interruption could have taken the month's money for a booking that was
  no longer possible.
- CodeRabbit: 16 comments, 15 taken. What mattered most: the call's record is now read again
  inside the locked step before money comes back or goes to review. What was not taken, and why,
  is at the end of `plans/21-memberships-part-2-member-calls.md`.

**Open points**
- **For the founder:** the daily limit on requests (3 with one host in 24 hours, 10 in all) also
  applies to a member's bookings, as the rulebook says. A member with many hours may meet it.
- **Local testing:** each run of the check scripts leaves test calls whose room is never marked
  closed, and after many runs joining a call as the seeded customer takes minutes (the safety
  script then stops). Marking old, settled test calls as closed in the local database fixes it.
- Extra time during a member's call is 2b; until then such a call offers none.

## Memberships, part two, 2b: extra time during a member's call (pull request 37, 18 November 2026)

The fourth of six pull requests, and the end of part two. The founder's switch is still off.

**What it does**
- **Extra time on a call that was booked with a membership** (`extend/extend.ts`,
  `membership/calls.ts`): when the member's free time covers the whole request and the longer
  call still ends before their month ends, it is taken from the membership: set aside in the
  same step, the host asked at once, and no extra 30 cents. Otherwise the whole request is paid
  by card, on the card saved for the membership, as an ordinary card payment with the usual fee.
  One request is never split between the two.
- **Never a way or a price the member did not see.** The call screen says for each choice how it
  would be paid and sends what it showed. The server decides again with the month locked; if the
  way or the card price is no longer that, nothing is asked of the host and nothing is held, and
  the member is shown how it stands now and presses again.
- **A request that is declined, runs out or fails** gives its money back where it came from,
  once; an accepted one never. If the app stops in between, the helper finishes it.
- **After the call** each payment is settled for its own stretch and by its own kind (2a's code):
  a card charge for added time follows its own hold, while the member's time to ask for a refund
  stays the full 24 hours. One refund request covers the whole call.
- **A membership that ended, was paused or is frozen** pays for no more added time; without a
  saved card, time cannot be added.

**The database:** nothing new (`call_extensions.paid_from` came with migration `0029`).

**How it was checked**
- `scripts/member-calls-check.ts` now has 17 journeys (three new) and about 250 checks against
  Stripe's test area: from the membership (accepted, used in part, declined, not answered, the
  app stopping in between, the fifth request), by card (its own fee and hold, across the month's
  end, the way changing in both directions, a booking and added time for the last free money at
  the same moment, the membership ending while a request is open), and a call with both kinds
  (each payment's own moment, one refund request, the health check, a frozen month beside a card
  payment).
- The existing script for added time on card calls passes unchanged, as do the eleven other
  existing scripts, `scripts/membership-check.ts --payouts`, `tsc`, `eslint`, `vitest` (395
  tests) and the build.
- Through the running app: the screen's data for a member's call in its last minute, presses
  that did not match what was shown (each refused with the way and the price as they are), and a
  matching press. The call screen's own buttons were not pressed by hand (they need a camera and
  a second person).
- Astra reviewed the code twice (not ready, ready). What mattered most: a membership's card that
  was retired a moment ago could still have been held for added time; and a request the
  membership could just pay for was sent to the card by a rounding difference.
- CodeRabbit: one comment, taken (a card retired in the moment between the check and the hold
  gets its hold let go again).

## Memberships: two founder decisions and one narrow guard (pull request 38, 18 November 2026)

A small pull request between part two and part three. The founder's switch is still off.

**What it does**
- **A "No thanks" always stands.** A member who says "No thanks" to an offer of less time keeps
  the month they paid for and is paused when it ends. The host cannot undo that pause
  (`membership/ending.ts`, `undoStop`); the member can resume later, when there is room. If such
  a member cancels and then keeps their membership again, both emails say how it really stands.
- **No daily limit on requests holds a member's booking back** (`membership/book.ts`,
  `booking/bookings.ts`). The limits of 3 with one host and 10 in total are there to stop one
  person flooding a host with requests she has to answer. A member's booking needs no answer, is
  paid for, and is limited by the time they have. A member's bookings are not counted against
  their ordinary requests either. There was never a limit on how many different people may book
  one host, and there is none now.
- **One narrow guard in their place:** a member who has cancelled 5 of their own member bookings
  in 24 hours cannot book as a member again until the next day, because each booking ends other
  people's waiting requests for that time and writes to the host. Bookings that are kept, ones
  the host or Connect cancelled, and a first booking that was not finished never count.

**The database:** nothing new.

**How it was checked**
- `scripts/membership-check.ts` (the host's undo is refused after a "No thanks"; the emails after
  the member cancels and keeps it again) and `scripts/member-calls-check.ts` (a fourth booking
  with ten requests on record is made; member bookings are not counted against ordinary
  requests; five self-cancelled bookings refuse the next one, and an unfinished first booking
  beside four cancelled ones does not), both against Stripe's test area.
- All fourteen scripts, `tsc`, `eslint`, `vitest` (395 tests) and the build passed on the code
  before CodeRabbit's review; after its two points the two membership scripts were run again.
- Astra checked the first version (ready). The guard and the removal of the limit of 10 in total
  came after that check.
- CodeRabbit: two comments, both taken. The guard had also counted a first booking that ended
  unfinished, which can happen through no fault of the member (the month was paid but the time
  was taken meanwhile); and after a "No thanks" an email told the host she could take the pause
  back, which she no longer can.

## Memberships, part three, 3a: the host's pages and the founder's (pull request 39, 18 November 2026)

The fifth of six pull requests. The founder's switch is still off: a host sees "Memberships are
not open yet." and nothing else.

**What it does**
- **Hosting, "Membership"** (`app/host/membership.tsx`, `membership-actions.ts`,
  `app/host/membership/page.tsx`): the switch, the member price, the time included, the monthly
  amount and the room her hours leave. A change is first shown on a page of its own with its
  numbers (who pays less, what it costs her, which invitations are taken back) and saved from
  there with a mark of what was shown.
- **The member list**: each member's time left, when the month ends and whether it renews, and
  the buttons to pause, undo her own pause, take back an offer of less time, and end a
  membership. A renewal that a stop, the founder's switch or an unanswered offer stands in the
  way of is never promised.
- **Inviting** on "People you have talked to", with "Take the invitation back".
- **A cut in hours** (`app/host/calendar`): a stretch is changed in one go, and a cut that would
  touch members or invitations goes through a step where she chooses keep, less time or pause
  for each member; hours and choices are saved together.
- **The founder's page** (`/admin/memberships`): every membership, months not finished, failed
  payments, pay-backs not done, months under dispute, each month's six places. It only reads.

**The database:** nothing new.

**How it was checked**
- All fourteen check scripts against Stripe's test area, `tsc`, `eslint`, `vitest` (395 tests)
  and the build. `scripts/membership-check.ts` has about 475 checks now: the old check "nothing
  can start a membership" became three (only the host's own pages reach the code that changes a
  membership; each of her seven actions asks who is signed in; nothing can join or pay as a
  member yet), and the cut journey gained the out-of-date form and the quiet cut.
- In the running app as the test host and the test founder, at phone width: the "Membership"
  part, the pages that show a change before it is saved, the step for a cut (also with a made-up
  address), the founder's page, with the switch on for the test host and again with it off.
- Astra reviewed the code three times (not ready, not ready, ready). What mattered most: the
  step for a cut could show another host's hours from a typed address; a cut that only took
  invitations back was saved unseen; an out-of-date form could look saved while its choices were
  ignored.
- CodeRabbit: three small comments, all taken (in `plans/22`).

**What is not covered:** the member's own pages and the whole journey in a browser, which are
3b.

## Memberships, part three, 3b: the member's pages (pull request 40, 18 November 2026)

The last of six pull requests. Memberships are now built in full. **The founder's switch is
off**, and turning it on is the founder's step: first for one host (the friend test), and for
everyone only after the lawyer's and Stripe's points in `plans/19`, "Before this can go live".

**What it does**
- **The invitation, joining and resuming** (`/h/<handle>/membership`): what a membership costs
  and gives, the sentences a person agrees to with the tick box, then the card step with
  Stripe's form on the month's one payment. An old invitation link says what became of it.
- **One membership, for its member** (`/memberships/<id>`): the time left, that the amount is
  held or taken and until when "Cancel now" is offered, the next payment or what stands in its
  way, cancelling, "Keep my membership", an offer of less time, and the monthly receipts.
- **"Pay now"** after a failed monthly payment (`/memberships/<id>/pay`).
- **The address the card form asks** (`/api/memberships/<id>/sync`): the server asks Stripe
  itself.
- **"Your account"** lists a person's memberships; the host's page shows an invited person a
  box with the link.
- **The reminder** three days before a month ends (`notifications/membership-reminders.ts`), in
  the helper's reminder loop: once per month, sent whatever the person chose for reminder
  emails, and dropped if it is no longer true when its turn to be sent comes.

**Two rules the pages keep**
- Opening or reloading a page never makes a payment, a month or a membership and never moves a
  deadline; only the buttons do. A page reads an existing payment's secret through
  `secretToPay`.
- Nothing is claimed before it is known: a payment that comes back after a deadline is checked
  with the bank first, and no sentence promises a renewal or a zero charge that a change in the
  moment before a press could make untrue.

**The database:** nothing new.

**How it was checked**
- `scripts/membership-journey-check.ts` (about 110 checks) walks the whole journey through the
  real pages, posting every form as the page drew it, as each person, and paying with Stripe's
  test cards: setting up, inviting, joining, the receipt, a member-only booking, the call, the
  reminder, cancelling and keeping, a renewal, "Cancel now", a failed renewal and "Pay now", a
  lowered price, resuming on changed terms, a cut in hours with keep, less time and pause, an
  ended membership, the founder's page, and the switch turned off while a month runs. It also
  posts forms as the wrong person, out of date and without the tick, and opens every page as a
  stranger, another host and the member's own host.
- All fourteen other check scripts against Stripe's test area, `tsc`, `eslint`, `vitest` (395
  tests) and the build.
- In a browser at phone width and wide, with Stripe's own form: joining with a test card,
  "Cancel now", resuming with a card that needs the bank's approval (failed once, then
  completed), a card step that ran out.
- Astra reviewed the code five times (four times not ready, then ready). What mattered most: a
  payment arriving just after a deadline was told "nothing was charged" before the bank was
  asked; there was no way to cancel while a renewal was being taken; and several sentences
  promised an outcome that a change in the moment before the press could undo.
- CodeRabbit: eighteen small comments, seventeen taken (in `plans/22`).
- The automated security check on a commit found that one fix had let the card form show while
  the host's page was closed to the person; closed the same hour.

**What no check covers:** a real card, a real bank's hold on a statement, a real renewal a
month later, and two real people. The friend test is for those.

**Open for the founder before the switch goes on** (neither blocks the build): a bank's inquiry
that never becomes a dispute ends the membership today, like a real dispute; and switching a
membership off cancels a payment that is still open, also if the card was held a moment before.

**Both decided by the founder on 18 November 2026, with no change to the code:** a bank's inquiry
ends the membership, as a dispute does ("Yes, keep it"); and switching a membership off goes on
cancelling a payment that is still open.

## Memberships: on for everyone from day one (18 November 2026)

The founder's decision after the build: "I want the membership feature to be on from day 1 for
all hosts, so hosts can invite someone to be a member."

**What changed**
- The founder's memberships switch starts as "on for everyone" (`site_switches.memberships`,
  migration `0030_memberships_on`, and `switches()` when no switch was ever saved). The migration
  also turns a saved "off" on, once: until now "off" was only ever the default.
- The switch itself is unchanged: on the admin page, "Reports and safety", the founder can turn
  memberships off or limit them to named hosts, and the rules for "off" hold from then on.
- The three membership check scripts no longer need the switch to be off: each remembers the
  position it finds, works from "off" for its own journeys, and puts the position back.

**Two rules that had leaned on the switch** (found by Astra; with the switch on for everyone
they have to stand by themselves):
- Hours "for members only" are for a host who offers a membership herself (her own membership
  switched on), not for every host the founder's switch covers. Otherwise a host who cannot have
  members could have hidden her hours from ordinary customers.
- Switching a membership on needs an approved host page. (Nobody could have joined a host whose
  page was not approved, but she should not get that far.) One that is already on can still be
  looked after while her page waits: a lower price, or switching it off.

**How it was checked:** all fourteen check scripts and the journey through the pages, run with the
local switch on for everyone; `tsc`, `eslint`, `vitest`. Astra reviewed the change three times
(not ready, not ready, ready): the two rules above, and the check scripts putting the switch
back also when their own set-up fails. CodeRabbit (pull request 41): three small comments, all taken:
the rulebook now names the two rules, and says that a "named hosts" setting made for the friend
test must be set back to "on for everyone" before launch; and the demo of the member-calls
script only puts the switch back if it changed it and nobody changed it since.

**What it means before launch:** the lawyer's and Stripe's points in `plans/19`, "Before this
can go live", now have to be settled before the site goes live, because memberships go live with
it. A host still needs an approved page, a price above zero, a ready payout account and her own
membership switched on before anyone can join.

## Projects: the plans (pull request 42, 18 November 2026)

Not built yet. This entry records the planning; each part gets its own entry when it is built.

**What it is.** The founder's idea (18 November 2026), after memberships: a host runs one project
at a time, in the way people do on Patreon, and tells its story in a diary of posts with text,
pictures and YouTube links. A customer can contribute to it, once or every month, and is shown
the project after a call. A contribution buys nothing in return; that is the difference from a
membership.

**The four documents**
- `plans/23-projects.md`, the rulebook: every rule, each of the founder's decisions with the day
  it was made, and what each of the three parts must deliver.
- `plans/24-projects-part-1-the-diary.md` (the project, its diary and pictures, no money),
  `plans/25-projects-part-2-contributions.md` (the money), `plans/26-projects-part-3-the-ask.md`
  (the box after a call, and the check of the whole journey). They state no rule of their own.

**What the founder decided along the way**
- Anyone with an account may contribute; no call is needed. From $5 to $100,000 in one charge.
- Every payment is first held on the card for three days and then taken, so that a contribution
  cancelled in that time costs no refund fee at Stripe.
- A host collects 7 days after the money is taken; 30 days once one contributor has given her
  more than $1,000 within 30 days. Counted per contributor, not per host (Astra had proposed per
  host).
- Every picture is checked automatically before anyone can see it, by a queue: OpenAI's free
  checking service, then Microsoft's, then Sightengine's, and last an open-source checker on
  Connect's own server. Astra and the builder advised leaving the last one out, because it only
  looks for nudity; the founder kept it.
- At most 20 pictures a day for each host.
- Pictures do not wait for the tool against known pictures of child abuse; it is switched on when
  it is approved. Astra had advised waiting. "Remove and report" stays, because the law asks for
  it.

**The checks**
- Before the rulebook was written, the builder researched the picture checkers and how GoFundMe
  and Patreon limit contributions. Astra then did its own research, apart from the builder's,
  before it read the plan.
- The rulebook: two rounds with Astra (not ready, ready with changes). The findings that mattered
  most: seven days before collecting is no protection at a $100,000 ceiling, since a bank can
  take a payment back for about 120 days; a contribution cannot be written as one more kind of
  call payment; a report must not hide a post by itself, or anyone could switch off a host's
  diary.
- Part one's plan: two rounds (ready with changes, twice). Most important: one of the three
  services was not being asked for violence; an old answer from a checker could have overwritten
  the founder's decision; a flagged picture, removed and uploaded again, would have had a second
  try.
- Part two's plan: three rounds (not ready, ready with changes, then confirmed). Astra agreed
  with writing a contribution in the two layers a membership has. Most important: a refund and a
  collection of the same money could have run at the same moment; a refund that was owed was not
  written down; the $1,000 rule had three gaps.
- Part three's plan: one round (ready with changes). Most important: the box could have been
  shown for a host who is paused.
- The builder tried the open-source picture checker on its own machine: about 50 milliseconds a
  picture, nothing to compile.

- CodeRabbit (pull request 42): six comments, five right and taken, one answered. They are listed
  at the end of the rulebook. The largest: pictures uploaded before the child-safety tool is
  switched on would have disappeared from that day, with nothing ever asking the tool about them.

**Still open, before projects can go live:** Stripe's yes to this exact kind of payment; the
lawyer (the wording, the monthly agreement, the duty to report); the founder's accounts at the
three checking services; and the application for the child-safety tool. They are in the rulebook
under "Before this can go live".

## Projects, part one, 1a: the project and its diary (pull request 43, 18 November 2026)

**What it is.** The first of five steps of projects (`plans/23-projects.md`,
`plans/24-projects-part-1-the-diary.md`). A host starts one project, writes diary posts with
text and YouTube links, changes and removes them, and ends the project. Anyone can read the diary
on her page. No pictures yet (1b) and no money (part two).

**What was built**
- Tables `projects` and `project_posts` (migration 0031). The database itself allows one running
  project per host. A removed post and a hidden post keep their lines.
- `src/lib/projects/`: the plain rules with tests (`rules.ts`), projects (`projects.ts`), posts
  (`posts.ts`). A YouTube link is never kept as it was typed: the address is built again from
  the video's or channel's id, so nothing else a person typed can reach a page. Post text is
  always shown as plain text.
- The host's pages: `/host/project` and `/host/project/posts/[id]`, and a part "Your project" on
  Hosting. The diary: `/h/[handle]/project` and `/h/[handle]/project/[id]`, and a box on the
  host's page. It is there exactly when her page is open to everyone.
- Reporting a post: the report keeps what the post said, and does not block the host (a report
  about a person still does).
- The founder: `/admin/projects` with the switch (off, named hosts, everyone; on for everyone
  unless changed), every project, every post of a project, and "hide" and "show" for a post, each
  written to the record of the founder's actions.

**What the reviewers found**
- Astra, four rounds on the code before the pull request, ending in "ready to open a pull
  request", and a fifth on CodeRabbit's fixes. The findings that mattered: a form left open in an old tab
  could have ended or changed a project started later (every form now names its project); the
  posts of an ended project could not be reached to remove them; the founder could only see the
  newest thirty posts; a post that the server refused was lost, text and all (the post form now
  answers in place and keeps what was typed); and an older check (`safety-check`) compared the
  switches in a way the two new columns would have broken. One rare case was left as it is, with
  Astra's agreement: a host who ends her own project in a second tab and then sends a draft from
  the first, with scripts switched off in her browser, does not get that draft back.

- CodeRabbit (pull request 43): six comments, all right, all taken. "Older posts" could have led
  a reader into a newer project; a host paused while typing lost her draft; a YouTube channel's
  name in another alphabet was refused; an unseen character in a post gave an error nobody could
  read; the switch and its line in the record were not saved together; and one check depended on
  what else was in the database. Astra looked at these changes too and found one slip in them
  (the longest such channel name was saved and then not read back), which was fixed.

**How it was checked**
- `scripts/project-check.ts`: 117 checks in nine journeys, among them two starts at the same
  moment, every way a host's page can be closed, forms from an old tab, the database's own rules
  tried directly, and who can reach which action.
- All fifteen earlier check scripts on the finished code, and again after CodeRabbit's fixes.
- In the browser, as a host, a visitor, a customer who reports a post, and the founder; on a
  phone-sized window too. The post form was also sent without any script, as a plain form.

**Still open.** Nothing for 1a. Pictures follow in 1b.

## Projects, part one, 1b: pictures and the checking queue (pull request 44, 18 November 2026)

**What it is.** The second of five steps of projects (`plans/23-projects.md`,
`plans/24-projects-part-1-the-diary.md`). A host adds up to four pictures to a diary post.
Connect makes its own copy of each, has it checked automatically before anyone else can see it,
and shows it, refuses it or keeps it waiting. No money yet (part two).

**What the founder decided while it was built (18 November 2026)**
- A picture a checker flags is refused by itself: from that moment nobody gets it, it is
  deleted (kept unseen a little longer only while the child-safety tool, once switched on,
  still has to look at it), and when the same host uploads a picture whose copy comes out the same again (it is
  Connect's own JPEG copy that is compared, byte for byte), it is refused at once. No list for the founder and no appeal.
- The check against known pictures of child abuse stays in the plan, because the tool is free.
  Connect has no access to it yet; pictures do not wait for it until it is switched on.
- OpenAI and Sightengine have accounts and keys. Microsoft is skipped for now.

**What was built**
- Tables `project_pictures`, `project_picture_files` (the bytes, kept apart) and
  `picture_checkers`, and a column on `site_switches` for the moment the child-safety tool is
  switched on (migration 0032).
- `copy.ts`: Connect's own copy. The kind of file is read from its bytes (JPEG, PNG, WebP; no
  moving pictures); the copy is a JPEG of at most 1,600 pixels and 1 MB, turned the right way
  up, in standard colours, with nothing of what was hidden in the file. Nothing of the original
  is kept.
- `checks/`: one small file for each checker (OpenAI, Microsoft, Sightengine, and Connect's own:
  the open-source NSFWJS in a thread of its own), each giving one of four answers, and
  `order.ts`, the queue's decision as one plain function.
- `queue.ts`: one round of the queue, run by the always-on helper in a loop of its own. A round
  claims a picture before it is checked, and an everyday checker's answer is only written if
  nothing was decided about the picture in between. (A match from the child-safety tool always
  counts, however late.)
- `child-safety.ts`: the one place that knows the rule for the child-safety check.
- `pictures.ts` (taking an upload in; `pictureFor`, the only function that hands out a
  picture), `moderation.ts` (the founder: remove, hold as suspected, "Remove and report", "I
  have made the report"), `picture-steps.ts` (the steps they share).
- Two addresses: `POST /host/project/posts/[id]/pictures` (the upload, cut off at its size while
  it is read, one picture worked on at a time) and `/pictures/[id]` (the picture, decided afresh
  for every request).
- Pages: pictures on the host's post page with their state, in the diary, and on the founder's
  projects page with how each checking service stands. The privacy page names the checking
  companies.
- 20 pictures a day for each host, four in a post, 10 MB an upload.

**What the reviewers found**
- The automatic security check of the first commit: a refused picture was deleted before the
  child-safety tool, once switched on, could have seen it. Fixed.
- Astra, four rounds on the code, ending in "ready to open a pull request". The findings that
  mattered: the framework's own address for smaller pictures (`/_next/image`) could have kept a
  copy of a shown picture for hours after it was removed (that address is now closed to the
  app's paths); a picture the founder held or locked while the first service was being asked
  could still have gone on to the next service; a host could have got round an open report for
  "someone under 18" by removing a picture and uploading it again; two such reports closed at
  the same moment could have left the mark on for ever; a flag in an incomplete answer counted
  as the service having worked; a fault could be passed over as "still out". The later rounds
  found slips in those fixes (a late answer of the child-safety tool thrown away; a refused key
  read as an outage when its message was cut off) and asked for the rulebook's sentence about
  the first answer of a recovered service to be kept to the letter. All taken. Astra asked for
  nothing to be removed.
- CodeRabbit (pull request 44): twenty comments, all rated minor. Eighteen taken. The ones that
  changed the app: a very long, thin picture could shrink to a copy only 40 points high (it is
  refused at upload now); the host's list of posts had no way to a single picture once her
  project had ended or her post was hidden, so she could only remove the whole post; a service's
  five minutes were looked at before its turn came; the clock was read before a lock that can
  take a while; and two gaps around the moment the child-safety tool is switched on, which
  cannot happen while there is no tool. The rest were wording in the plans and stricter checks.
  Two were answered and not taken: a shown picture may be kept by the visitor's own browser for
  five minutes, as the plan decided; and the check script clears the test database's attempt
  limits, as the other check scripts do. Astra looked at these changes too: "ready to merge". CodeRabbit then withdrew those two
  and asked for three small things more (two sentences made exact, and a service's five minutes
  read afresh when its turn comes), which were done.

**How it was checked**
- `scripts/project-check.ts`: 311 checks in eighteen journeys. The new ones use stand-in
  checkers whose answers the script controls: every outcome of the queue, two rounds at once,
  answers that come back late, the founder or the host deciding during a check, who is handed a
  picture in every state, "Remove and report" and what it protects, reports and their mark, the
  child-safety rule with a stand-in tool, and the two addresses through the running app (a
  request without a stated length, one that lies about it, two files, five uploads at once,
  the framework's picture address, fetching right after logging out).
- Connect's own checker for real, in its thread: ready and answering in under a second, about
  40 ms a picture, a hundred in a row without the helper's memory growing, a failed start and a
  fresh start; and once by hand with the network switched off.
- The real try, by hand: OpenAI and Sightengine each with four harmless pictures made for the
  purpose and with a wrong key. Both answer in the shape the code expects (0.3 to 2 seconds a
  picture); a wrong key reads as a fault.
- The always-on helper was run for real: it picked up an uploaded picture and kept it waiting
  with "No checking service is set up", which was true at that moment.
- 462 unit tests, among them each checker's reading of complete, partial and broken answers.
- All sixteen check scripts on the finished code.
- In the browser, as a host (uploading through the real form), a visitor and the founder (hold,
  "Remove and report", the time of the report), on a wide and a phone-sized window.

**Still open**
- **Microsoft's checker is untried.** It has no key, so it is not in the queue. One guess is in
  its code: a used-up free level is read as code 403 with the word "quota".
- **No borderline pictures were tried.** The thresholds are the plan's starting values. The
  founder can upload a few pictures through the app to see where they fall.
- **The child-safety tool** (Image Intercept) needs its application answered. Until then
  `childTool()` gives nothing, and the rule around it is only tried with a stand-in. Its own
  file must give up by itself inside the two minutes the queue holds a picture.
- **The keys are on this computer only.** The live site needs `OPENAI_API_KEY`,
  `SIGHTENGINE_USER` and `SIGHTENGINE_SECRET` in its own settings; without any key every picture
  waits, and the founder's page says so.
- **The lawyer's steps for a report** are not on the founder's page yet.
- Pictures are kept in the database. That is right for a start; a file store is a later step if
  there are many.

## Projects, part two, 2a: the money of a contribution (pull request 45, 19 November 2026)

**What it is.** The third of five steps of projects (`plans/23-projects.md`,
`plans/25-projects-part-2-contributions.md`): everything that moves the money of a contribution.
No pages yet; nobody can start a contribution until 2b.

**What was built**
- Tables `contributions`, `contribution_agreements`, `contribution_cards`,
  `contribution_payments`, `contribution_refunds` (migrations 0033 to 0036). A contribution's
  payment is a third kind of owner for the "never twice" record and the ledger. The host's share
  is a line of a new kind, "contribution", among her earnings, with its shape enforced by the
  database.
- `src/lib/contributions/`: the plain rules with tests (amounts, the monthly day, the last
  moment, the $1,000 rule); the hold, the taking and letting go (`charge.ts`); refunds owed once
  and sent until done (`refund.ts`); finding out after an interruption (`recover.ts`); bank
  disputes; ending; the saved card; the founder's hold and release; the helper's jobs; the watch.
- Each payment is held first and taken 72 hours and 3 minutes later, never before, and never
  after one hour before the hold ends. A lost hold is not replaced. When Stripe does not say when
  a hold ends, no date is assumed: the hold is let go.
- "Collect earnings" knows a contribution's share: whose it is, its locks, the $1,000 count
  before it judges, and that it is held back while a refund is owed, a dispute is open, the
  founder holds it, or anything of its payment is not finished.

**What the reviewers found**
- The check script itself found one real gap on its first runs: the 30 days written at the
  moment of collecting were lost when that collection had nothing else to send.
- Astra, six rounds on the code, the last one "ready to open a pull request". The findings that mattered: the helper decided about a taking
  by the moment its round began, so a slow round could have taken money after the last moment;
  the moment a taking was recorded at could lie before Stripe's answer, which would have made a
  wait too short; recovery after an interruption did not ask the founder's switch; a saved-card
  hold that Stripe had accepted and that was not yet written down was missing from the $1,000
  count for that moment; a release made while a payment was held was forgotten at the taking;
  and the earnings list could show as ready what a collection would refuse. Rounds three to
  six were about one rare case only: a payment that is stopped while Stripe is still making the
  request for it. No card could be charged in it, but an unused request could be left at Stripe
  if the app stopped at exactly that instant; it is now always found and cancelled (migration
  0035 adds the one field this needed). All taken, each with a check. Astra asked for nothing to
  be removed.
- CodeRabbit, on the pull request: eleven comments. Ten were taken, each with a check. The ones
  that mattered: the $1,000 count used the amount that was held, not the amount Stripe really
  took, and was not made when money was taken that was to be paid back; a cancellation that came
  in the instant between writing a taking down and asking Stripe lost, so the money was taken and
  then refunded (now the cancellation wins); a slow process could record "not sent" although the
  helper might have sent the request itself; an older answer about a bank dispute could
  overwrite a newer one (migration 0036 adds a counter for this); and a collection did not know
  of a payment made with a new card seconds earlier, so it now asks Stripe first. One was not
  taken: writing the migrations so that they do not lock a busy table, because the site is not
  live and these tables are nearly empty.
- Astra then reviewed those fixes in three more rounds, ending "ready to merge". It corrected
  the last one twice: when Stripe cannot be asked, that person's shares now wait for that
  collection (before, the collection went on); and a payment Stripe does not know at all is set
  aside for the founder, so it cannot keep shares waiting for ever.

**How it was checked**
- `scripts/contribution-check.ts`, against Stripe's test mode and the local database: 162 checks
  in thirteen journeys, among them a contribution from the hold to a real transfer with the
  books adding up to the cent; cancelling and the race with the taking; the card step; the
  monthly tries; a bank's confirmation; a lost hold; the last moment by the real clock;
  interruptions of a payment asked for, a taking, a letting-go and a refund; refunds before and
  after the share is sent; the $1,000 rule at its three moments; a real dispute from Stripe's
  test card; ending, the switch and cards; the watch.
- 483 unit tests. All sixteen earlier check scripts, above all the payment, refund and
  membership ones, since their shared code was touched.

**Still open**
- One collection holding a call's share, a member's and a contribution's together is not walked
  by a script.
- Stripe's refusal of a refund, and a dispute won or lost, are handed in by hand in the script:
  Stripe's test mode offers neither on request.
- The founder's email when one person passes $1,000 with a host comes with 2b.
- Nothing here can be reached by a person yet. The browser checks come with 2b's pages.

## Projects, part two, 2b: starting a contribution, and what people do with it (pull request 46, 19 November 2026)

**What it is.** The fourth of five steps of projects (`plans/25-projects-part-2-contributions.md`):
a person can now contribute to a host's project, once or every month, and everyone has their
pages. With this step part two is complete.

**What was built**
- The amounts a host suggests (migration 0037), and the sentences a contributor sees before
  paying, with the box for a monthly contribution (`wording.ts`).
- `start.ts`: who may contribute, starting (one contribution for one press, the agreement kept),
  and making a payment ready to be paid by hand. `monthly.ts`: each month written on its day,
  "Stop contributing", and letting one payment go. `ending.ts`: a block, an account paused or
  closed, a suspended host page and the end of a project end the contributions between those
  people in the same step. `switch.ts`: what saving the founder's switch does. `emails.ts`: nine
  emails, each written in the step it reports.
- Pages: "Contribute" on a project's diary, the summary before paying, the card step and a
  contribution's own page, "Projects you support" on the account page, the host's amounts,
  contributors, "Let it go" and "Refund", and the founder's lists with "Hold back", "Release",
  "Let it go" and "Refund".

**What the reviewers found**
- A security check that runs on saved changes: a payment could still be made ready, and a month
  written, after a block or a pause. Both closed.
- Astra, five rounds on the code, the last one "ready to open a pull request". Its first review
  had six points that had to be fixed. A month written down just before the helper stopped could
  be charged weeks late. Saving the switch at the moment a first hold was accepted could miss
  that contribution, and used a stale moment. Fifty contributions that were not due yet could
  keep one that was from being written. Several notices said "nothing was charged" before that
  was known. The founder could not reach an ordinary payment. The later rounds tightened the
  same things: the rule for a late month had to hold on every way to a first hold (the helper's
  try, paying by hand, a hold that arrives) and never against a try already on its way; the
  founder's $1,000 email is sent at the payment that crosses the line; Stripe's own answer to a
  cancellation now says whether a hold was there, so "nothing was charged" reaches also someone
  whose hold the app had not heard of; and the helper waits two minutes after a month's 7 days
  before it gives the month up. All taken, each with a case in the check script. Astra asked for
  nothing to be removed.
- CodeRabbit, on the pull request: two comments, both taken. A late month is not given up while
  Stripe says its payment is still being worked on; and the two "same moment" cases of the check
  script now always hear a failure of the step they started, and let go of their lock first.
  Astra then found my first fix for the former wrong: it asked Stripe a second time and used
  that answer only to look for "still being worked on", so an answer that said "it went through"
  would have been thrown away. Now one look is both recorded and decided from. A payment Stripe
  keeps working on for more than a day past its month's 7 days is said by the watch; nothing
  about the payment itself is changed, so it goes on being checked against Stripe. (A first
  version set it aside for the founder, which Astra showed would have taken it out of those
  checks.)
  CodeRabbit then asked whether Stripe promises that a hold placed in time can always be seen
  two minutes later. No such promise is leaned on, and the answer was left at that: if a look
  were ever wrong, the month is skipped, the hold is let go, nothing is charged, and the
  contributor is told so.

**How it was checked**
- `scripts/contribution-check.ts`, against Stripe's test mode: six new journeys (starting; the
  monthly rhythm; what ends a contribution from outside, and the switch; the emails; Astra's
  findings; the pages). Two of the cases are real "at the same moment" cases: the script holds
  a lock, starts the other step, and goes on only once that step is really waiting for it.
- In the browser, with the local test accounts and Stripe's test cards: contributing once;
  monthly with the card that asks for the bank's confirmation; stopping; the host's list and a
  refund; the founder's page and "Hold back".
- All the earlier check scripts, and the unit tests.

**Still open**
- The terms page is a placeholder until the lawyer writes it.
- One collection holding a call's share, a member's and a contribution's together is still not
  walked by a script. Neither is the moment a collection uses for its count after waiting for
  its locks.
- The two minutes the helper waits before giving a late month up are a wide margin, not a proof:
  Stripe names no longest time for a card payment that is still being worked on.
- The box after a call is part three.

## Projects, part three: the ask after a call, and the whole journey (pull request 47, 19 November 2026)

**What it is.** The last of the five steps of projects (`plans/26-projects-part-3-the-ask.md`):
the two places where a customer meets a host's project without looking for it, and the check
that walks the whole feature the way two real people would. With this step the feature is
built. It adds no table, no money rule and no email.

**What was built**
- `src/lib/projects/ask.ts`, which only reads. `askAfterCall` gathers what is recorded about a
  call and its two people, and one plain rule (`mayAsk`, in `rules.ts`, with a test for each
  condition) decides whether the customer is shown the host's project. `contributionOf` says
  what a visitor is to a project: whether they could contribute, and their own contribution if
  it gets a line.
- The box on a call's results, for the customer only: "*Name* is working on *project*", the
  first lines of what it is about, and "See the project". No amount and nothing that pays.
- One line for a signed-in visitor in the project's box on the host's page, and the same line on
  the diary: "You contribute $X a month", "Finish contributing", or "Contribute".
- `scripts/project-journey-check.ts`: 89 checks through the real pages, from a host's first post
  to the founder's switch.

**What building changed in the plan** (written into plan 26)
- "The call's record is final" is judged as the charge judges it: the room is confirmed closed,
  too.
- A project with no suggested amounts takes no contributions, so it has no box after a call
  either.
- "Finish contributing" is shown only while contributing is possible and that card step can
  still be finished (its 30 minutes are not over). Someone who already
  contributes every month is not offered a second monthly contribution in the diary, which
  would only be refused.
- The "Your earnings" part of the Hosting page is drawn only for a host with a payout account.
  The journey's host borrows one for the collecting step alone, so outside that step the script
  reads her earnings from the function that part is drawn from.

**What the reviewers found**
- Astra, three rounds on the code, the last one "ready to open a pull request". Its first review had two points that had to be fixed.
  "Finish contributing" could lead to a card step whose 30 minutes were over, with nothing left
  to finish: the line is now shown only while that step can be finished. And a payment that was
  cancelled at Stripe itself (in Stripe's own pages, not by Connect) just after its hold was
  placed lost the note that a hold had been there, so its contributor would not have been told
  "nothing was charged" and could have been asked again after a call: that note is now kept,
  as it already was on every other way a hold can end. That second point is in the money code
  of part two, found because this part reads "was ever held".
- The rest was about the journey script, and all of it was taken except two things: checks
  that would have passed on a page that failed to open, a founder's login that fails being
  skipped instead of failing, the collecting step described as a button press, amounts and
  reasons that were only roughly checked, and a clean-up that could leave a hold at Stripe.
  Not done: marking the founder's record lines of a run that was stopped (it would change the
  app for the sake of a test), and making the script safe beside other work on the same test
  database (like the other check scripts, it needs the database to itself).
- Astra asked for nothing to be removed.

**How it was checked**
- The unit tests of the rule: every condition failing alone, and all of them true.
- `scripts/project-journey-check.ts --payouts`, against the running app and Stripe's test mode.
  Real: sign-up, every page and button of the project, a picture's upload, every contribution's
  payment, the emails. Pretended: the host's approval, that two people had a call, the picture
  checker, the waiting, and in the short cases a pause, a hidden page, a membership and the
  closing of a report. The collecting step is not walked through the pages: its paid call is
  made by the app's functions, and one collection, started by the function behind "Collect
  earnings" with a later clock, sends a contribution's share and a call's share together.
- All 17 earlier check scripts, once more on the finished code.
- In the browser, phone-sized and wide: the box after a call and the "Contribute" line, as a
  signed-in customer. That the host and a visitor who is not signed in see neither was checked
  by the script on the real pages, not by eye.

**Still open, for the whole feature**
- Before it can go live (the rulebook's list): Stripe's word on this exact model, the lawyer's
  terms (the terms page is a placeholder), and the settings of the picture services on the live
  site. The child-safety tool is applied for and switched on when it is approved.
- Microsoft's picture service has no key, so it is not in the queue and its adapter has never
  met the real service.
- A member's share, a call's and a contribution's in one collection: the journey now walks a
  call's and a contribution's together; a member's share with them is still not walked.
- The two minutes the helper waits before giving a late month up are a wide margin, not a proof.
