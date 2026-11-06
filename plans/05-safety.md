# Plan: Module 5 — Safety

**Status: approved by the founder on 6 November 2026 ("go with your recommendations"), after Astra's review. For decision 3 that means option A: an identity check before a customer's first free call. For decision 2: Stripe Identity.**

The app now lets strangers meet on a private video call and pay each other. This module is about what
happens when someone lies about who they are or behaves badly: checking that hosts are real adults,
letting people block and report each other, ending a call that has gone wrong, and giving the founder
the tools to act.

It builds on what exists: hosts are already approved by hand (module 3), social accounts are confirmed
with a code, the founder can suspend a profile or close an account, and closing or suspending ends
that person's requests and bookings (module 4).

## What this module must prove

1. A host's page only goes public after we know the person behind it is a real adult, without us storing their ID.
2. Anyone can cut off contact with another person at once, without asking us.
3. Anyone can end a call that has gone wrong and report it in a few seconds, and is not charged for the time after that.
4. A report reaches the founder with the facts needed to judge it, and the founder can act (warn, pause, suspend, close) with a record of what was done and why.
5. The rules of the site are written down, accepted by everyone, and are the same rules the founder enforces.
6. The admin account cannot be taken over with a stolen password alone.

## The founder's decisions (the recommendation was approved for each)

1. **What is allowed on a call (the rules).**
   This must be decided first: our payment company (Stripe) does not allow sexual services of any kind, and the video company has its own rules.
   Recommended: Connect is for conversation: advice, coaching, a chat with someone you follow.
   Not allowed: nudity, sexual acts or sexual services; anyone under 18 on a call; pretending to be someone else; threats, harassment or hate; scams; sharing someone's private details; recording a call; anything illegal; asking to pay for a Connect call outside Connect. Talking about relationships or health is fine.
   Everyone accepts these rules (people who already have an account are asked once, the next time they log in), and they are linked from every call page.

2. **Checking hosts' identity and age.**
   Recommended: before a host profile can be approved, the host does an identity check with **Stripe Identity**: a photo of their ID and a selfie that must match it, on Stripe's own pages. We learn "real person, 18 or older" and the name on the ID, which only you see, next to the display name they chose. We never hold the ID or the selfie.
   Cost: **$1.50 for each completed check**, paid by the company. A host gets at most 3 tries. In Stripe's test area it is free, so building and testing costs nothing.
   Alternative: rely on the check Stripe already does for payouts. Free, but it only covers hosts who take paid calls and does not prove the person on camera is that person.

3. **Checking customers' age.** *(This is the one Astra and I see differently; it is a cost-against-risk call that is yours.)*
   Fans of influencers are often young, and a child on a private call with an adult is the worst thing that can happen on this site. A ticked "I am 18" box does not stop it, and nor does a payment card (it can be a parent's).
   - **Option A (my recommendation):** an identity check **before a customer's first free call**; for paid calls, the card plus the 18+ statement, and hosts are told to end the call and report if the person looks under 18. Cost: $1.50 only for customers who book free calls.
   - **Option B (Astra's recommendation):** an identity check before **every** customer's first call, paid or free. Strongest protection. Cost: $1.50 per new customer, and some people will give up rather than show ID.
   - **Option C:** no check; rely on the 18+ statement and on reports. Cheapest and weakest.
   In all three, you can pause any account you have doubts about (decision 7).

4. **Recording calls.**
   Recommended: **calls are not recorded**, by us or by the people on them (the rules forbid it). It keeps calls private and avoids the laws about recording. The price: a report about what happened in a call is one person's word plus the facts we do have (who joined, when, for how long, the note sent with the request).

5. **Blocking.**
   Recommended: anyone can block anyone. It ends every waiting request between the two, cancels their future calls with each other for free, and stops new requests in either direction. The blocked person is not told; to them the host just shows no open times. It can be undone, which allows new requests but does not bring back what was cancelled.

6. **Ending a call and reporting.**
   Recommended: inside every call there is an **"End call and report"** button. Pressing it ends the call for both people at once and neither can come back in. Then a short form: a reason (pretending to be someone else, sexual content, someone under 18, harassment or threats, asked to pay outside the site, something else) and what happened.
   **Money:** time after the button is not counted. The call is not charged automatically; it goes to your review list (the one from the payments module) and you decide the amount, anything from nothing to the time that counted.
   There is also a plain "Report" link on a host's page, a request and a call's page. Reporting someone always blocks them for you, and the form says so.

7. **What you can do with a report.**
   Recommended: a new admin "Reports" page showing the report, both people, their history with each other, earlier reports about the same person, and a snapshot of the profile and request as they were. You can: close it with a note; send a warning email; **pause the account** (the person can log in, see receipts and write to us, but cannot book, host or join calls; you can lift it); suspend a host profile; or close the account. Refunds stay where they are (payments module).
   The reporter gets a reference number and is told when it is closed, not what was decided. A paused person is told which rule, and an email address to appeal to. Nobody is told who reported them (though on a one-to-one call they may guess).

8. **Urgent reports.**
   Recommended: a report about someone under 18, or about threats, is marked urgent: it goes to the top of your list and you get an email at once. **Nothing is hidden or paused automatically on one person's say-so**; contact between the two people is already cut by the report itself, and you decide the rest when you look. (Hiding a host automatically would let anyone switch off a host's business with one false report.)

9. **Protecting the admin account.**
   The admin can close accounts and refund money, so it is the account most worth stealing.
   Recommended: admin accounts log in with a password plus a 6-digit code from an authenticator app on your phone, with one-time backup codes kept somewhere safe. Admin accounts cannot use "Continue with Google". Every admin page and action checks this.

10. **A stop switch.**
    Recommended: two switches on the admin page for emergencies: "no new requests" and "nobody can join a call". Reports, refunds and payments keep working.

## Decisions already made

- Hosts stay approved by hand (module 3); the identity check is an extra condition. Approval is tied to the identity check and to the name and text you saw. A changed display name needs approval again (already built); a changed "about" text puts the profile at the top of your list to look at.
- The identity result is stored as: passed or not, 18 or older, the name on the ID (for you only), when, and Stripe's reference. No date of birth, no ID number, no photos.
- An identity check and a payout account are separate things; a host needs both for paid calls.
- Blocks belong to accounts, not to roles, and work in both directions.
- Suspending and closing work as built in modules 3 and 4.
- Every admin action, including the ones that already exist (approve, decline, suspend, close, reopen, confirm a social account, charge, release, refund), is written to a record that the app only ever adds to.

## How it works

**Identity check**
1. On the Hosting page, a step "Confirm who you are" opens Stripe's own pages.
2. When the person comes back we ask Stripe for the result ourselves. What the browser says is never trusted, and Stripe's messages about identity are not saved (only their reference).
3. Passed: the profile can be approved. Not passed or abandoned: they can try again, up to 3 times.

**Blocking** is checked wherever contact can start or continue: when open times are shown to a logged-in person, when a request is made, when a card step finishes, when a host accepts, and when a call is joined.

**End call and report**
1. The button disconnects the person immediately, then closes the room and cancels both entry passes, so nobody can rejoin.
2. The call is marked "ended for safety" with the moment it happened. Time after that moment is not counted.
3. The payment goes to the founder's review list instead of being charged automatically.
4. The report form follows. Even if it is never filled in, the call stays ended and under review.

**Pausing an account** is one more condition in the gate that every page and action already goes through. A paused person can still log in, see their receipts and past calls, and read why.

## What gets built, in order

1. **Two-step login for admins**, one shared admin check for every admin page and action, and the record of admin actions.
2. **The rules page**, and asking everyone to accept the current version.
3. **Pausing an account.**
4. **Blocking**, enforced at every point above.
5. **End call and report**, with the payment going to review.
6. **Reports**: the form, the list, the actions, the notices, urgent emails.
7. **Identity check** for hosts (and for customers as decided in 3), tied to approval.
8. **The stop switches.**
9. **Tests, journeys and a browser walk-through.**

## What we store

- **Identity checks:** person, Stripe's reference, state, 18 or older, name on the ID, tries used, when.
- **Blocks:** who blocked whom, when.
- **Reports:** a reference number, reporter, reported person, where it was made, reason, text, urgent or not, a snapshot of the profile and request at that moment, state, the founder's note, when it was closed.
- **On a call:** if it was ended for safety, when and by whom.
- **On an account:** paused or not, why, when.
- **Admin record:** who did what to whom, when and why. Only ever added to.
- **Site switches:** new requests on or off; joining calls on or off.

## How we test it

- **Automatic tests** for the rules that are plain logic.
- **A script of real journeys:** a profile cannot be approved before the check passes; the result comes only from Stripe; three failed tries and no more; a blocked person cannot ask, accept, finish a card step or join, in either direction, and existing requests and calls between the two end; ending a call for safety closes the room, refuses rejoining, stops the clock and sends the payment to review; each kind of report; an urgent report emails the founder; every admin action and its record; a paused account can log in but not book, host or join; an admin without the second step, or using Google, or with an old session, gets nowhere; the stop switches.
- **In a browser:** the identity check with Stripe's test documents, "End call and report" from inside a real call, and the admin's second step.

## Not in this module

- Checking automatically what is said or shown in a call.
- Attachments on reports. Risk scores. Background checks.
- Counting no-shows and acting on them (module 8).

## What the automatic checks cannot test

- Real IDs and real faces. Stripe's test area only imitates them.
- Whether the rules read clearly to real people, and whether a real person answers urgent reports quickly.

## Before launch

- **Stripe must confirm in writing** that it accepts this kind of business (paid private calls with creators) and the use of its identity check here. This goes together with the approval already listed in the payments plan.
- A lawyer must review the rules, the terms and the privacy policy, and set out: what the law requires us to do with a report about a child (in the United States there are duties to report to a national centre), how long reports and identity results are kept, how to answer requests from the police, and which countries we must not serve.
- Decide who reads urgent reports and how fast, and say on the site only what we can actually do.
