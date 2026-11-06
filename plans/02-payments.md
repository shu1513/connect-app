# Plan: Module 2 — Payments

This module makes a call cost money. A hold is placed on the customer's card before the call, the card
is charged afterwards for the time that actually counted, and the host is paid their share. It builds
directly on module 1: the time totals for a call decide the amount.

Calls are still created from the test page. The calendar and booking come in module 3.

**Development only.** Everything here runs in Stripe's test area (a "sandbox") with Stripe's test cards.
No real money moves. Production will use the company's own Stripe account later; switching is a change
of keys, and hosts set up their payout accounts again there.

## What this module must prove

1. A host can set up a payout account, and a customer can pay, without us ever seeing card or bank numbers.
2. A paid call cannot start unless the money is held first.
3. After the call, the customer is charged exactly what the rules say, never more than the booked price, and never on a guess.
4. The host receives their share, and we can show where every cent went.
5. No money step ever happens twice, even after a retry, a double click, a crash, or a repeated message from Stripe.

## The founder's decisions (approved 5 November 2026)

1. **Our fee follows the real costs, and comes out of the host's share.**
   - 4.9% of the charge.
   - 30 cents per paid call (Stripe's fixed card charge).
   - 1.5% of the charge extra when the customer pays with a card from outside the United States (Stripe's surcharge).
   - 25 cents per payout to the host's bank (Stripe's payout charge).
   - Stripe also charges us $2 in any month a host is paid. **The company absorbs this**; hosts are not charged a monthly fee.
   - These are settings and can be changed at any time. A call keeps the fee it was created with.
2. **What the customer pays for a booked call: the time the host was connected inside the booked window**, counted to the second, at the call's price.
   - Host late or leaves early: the customer does not pay for that time.
   - Host never shows up: the customer pays nothing.
   - Customer late or never shows up: the customer still pays for the time the host waited, up to the full booked price. There are no free waiting minutes.
   - The customer is told this in plain words before paying, and the receipt separates time together from time the host waited.
3. **The host sets the cancelling rule; we set the default.**
   - The host chooses how long before the start cancelling is free: any time before the start (our default), 1 hour, 12 hours or 24 hours before.
   - A call keeps the rule it was created with. The customer sees the rule before paying.
   - **Late cancelling follows Airbnb's rule for services:** after the free period the customer can still cancel, but gets no refund. The full booked price is charged, the host is paid and does not have to wait in the room, and the host may refund if they wish.
   - A host can cancel their own call for free at any time before the start. The customer pays nothing.
   - Once the call has started it cannot be cancelled.
4. **Hosts are paid once a week.** Each weekly payday sends every host the share from calls that ended at least 7 days earlier. The delay leaves time for a refund before the money has left, and one weekly payout means one 25-cent charge.
5. **A call marked "needs review" is never charged automatically.** It appears on an admin page where the founder chooses an amount (up to the booked price) or releases the hold. The deadline is 3 days after the call, or 1 day before the card hold runs out, whichever comes first. If nothing is decided, the hold is released and nothing is charged.
6. **The host decides refunds, directly.** On their own calls a host can refund all or part of the charge, until their share is sent to them. Our fee is returned in the same proportion, so a full refund is truly full. Stripe keeps its card fee, and we absorb that. After the host's share has been sent, a refund goes through the founder by hand.
7. **The host is paid out of money we actually collected.** If a call really happened and the money was lost through our own mistake, the company pays the host. That is handled by hand, and is not built in this module.
8. **US dollars only, and hosts in the United States only, in this module.** Customers can be anywhere their card works.
9. **A paid call costs at least $5 per 15 minutes.** A price of zero is a free call and skips payments entirely, which covers "the host invites a customer at no cost".

Other rules:

- **The customer confirms and pays on the call's page.** A paid call waits for the customer, who enters their card in Stripe's form and places the hold. Being present means any extra approval their bank asks for can happen right then. Saving a card for later comes with booking.
- A paid call must start within 2 days of the hold being placed, so the charge always lands well before the hold runs out.
- Amounts are worked out to the second and rounded to the nearest cent, once, at the end.
- If the final amount is under 50 cents (Stripe's minimum), nothing is charged.
- If a customer disputes a charge with their bank, the company covers it and it is recorded. A dispute can arrive months later. A refund is blocked while a dispute on the same charge is open, so nobody is repaid twice.
- No tips, taxes, invoices or other currencies in this module.

## Decisions already made

- **Stripe Connect with "separate charges and transfers".** The charge is made on our Stripe account and the host's share is sent to the host's Stripe account afterwards, tied to that charge. This is what lets us decide the amount after the call and delay the host's pay. We are the business the customer pays, so refunds and disputed charges land on us.
- **Hosts get a Stripe-hosted payout account**, set up only to receive money, with Stripe's limited "Express" dashboard. Stripe collects and checks their identity and bank details. We store only the account's ID and whether it can receive money.
- **Cards are entered in Stripe's own form.** We never see or store card numbers.
- **Hold now, charge later, once.** One hold per call for the full booked price, one charge for the real amount, and the rest is released automatically. Stripe allows only one charge per hold, so the amount is settled once and never topped up.
- **Money is stored as whole cents.** Never as decimal numbers.

## How the money moves

1. **Host sets up payouts.** A button sends the host to Stripe's form. We do not trust "they came back from the form": we ask Stripe whether the account can actually receive money, and keep that answer up to date. Until it can, the host cannot be on a paid call.
2. **A paid call is created.** Its price, booked total, fee settings and cancelling rule are fixed at that moment. It waits for payment.
3. **Customer confirms and pays.** The customer sees the price, the waiting rule and the cancelling rule, enters their card, and a hold for the full booked price is placed. We note when the hold runs out and which country the card is from.
4. **Joining.** The join check from module 1 gains one condition for paid calls: a hold that is in place and has not run out.
5. **After the call.** When the room is closed, the wait for late messages is over and the record is complete, the time totals are frozen and the amount is worked out from them. The card is charged once and the unused part of the hold is released. If the record needs review, nothing is charged and it waits for the founder. If something about the record changes after the charge, the call is flagged; the charge is never silently changed.
6. **Late cancelling.** The full booked price is charged straight away and the room is not opened.
7. **The split is recorded.** Customer charge, our fee and the host's share are written to the money record, with Stripe's own reference for each.
8. **On the weekly payday** each host is sent the share from calls that ended at least 7 days earlier, less any refunds they gave and less the 25-cent payout charge. Nothing is sent for a call while one of its refunds is still in progress.
9. **Receipts.** The results page shows the customer what they paid and why, and shows the host what they earned.

## The pricing rule

- **Booked total** = price per 15 minutes × booked length, rounded to the cent. This is the most that can ever be charged.
- **Charge** = price per 15 minutes × the host's connected seconds inside the window, rounded to the cent, and never above the booked total. Under 50 cents, the charge is zero. After a late cancellation the charge is the booked total.
- **Our fee on a call** = 4.9% of the charge, plus 30 cents, plus 1.5% of the charge for a card from outside the United States. Never more than the charge.
- **Host's share** = charge minus our fee. The two always add up to the charge exactly.
- **After a refund**, the host's share and our fee both shrink in the same proportion as the charge, and still add up exactly to what the customer has paid.
- **The payout charge** (25 cents per payout) is taken from the payout, never more than the payout itself.
- If the time totals are unknown, there is no amount. Unknown is never treated as zero.

## How "never twice" is guaranteed

- Before asking Stripe to do anything, we write down what we are about to do. Each action has one fixed label, and Stripe refuses to repeat an action it has already done under that label.
- Only one action can run on a payment at a time.
- If we are ever unsure whether an action went through (a timeout, a crash), we ask Stripe what actually happened before doing anything else.
- The always-on helper regularly re-checks anything left unfinished, so a missed message from Stripe cannot leave a payment stuck.

## Stages

Kept as three small, separate tracks, because one payment can be charged, partly refunded and paid out at the same time.

- **Payment:** waiting for payment → held → charged, or closed without a charge. A "needs review" flag on a held payment blocks the automatic charge.
- **Host's share:** not due → due → sent, or nothing owed.
- **Refunds:** each refund is its own record: in progress → done or failed.

## What gets built, in order

1. **The pricing rule and the stages**, with their tests written first. Plain calculations: no Stripe, no database.
2. **Money tables and the Stripe message inbox.** One payment record per paid call, a money record that is only ever added to (corrections are new lines, never edits), and an endpoint that checks each Stripe message is genuine, saves it, and only then replies "ok".
3. **Host payout setup**, and the host's cancelling rule.
4. **The hold:** the customer's confirm-and-pay step on the call page, cancelling, and the extra condition in the join check.
5. **Charging after the call**, as a second job for the always-on helper, together with releasing holds that are about to run out and the re-check of unfinished actions.
6. **Admin page:** calls waiting for a decision, with charge, release and full refund. Open only to an account marked as admin.
7. **Host refunds.**
8. **The weekly payday.**
9. **Receipts** on the results page.

## What we store

- **Per person:** for customers their Stripe customer ID; for hosts their Stripe payout account ID, whether it can receive money, and their cancelling rule.
- **Per call:** the price per 15 minutes (zero for a free call) and the cancelling rule it was created with.
- **Per payment:** the call, the terms fixed at creation (price, booked total, fee settings, currency), when the hold runs out, the card's country, the frozen time totals, the amount charged and why, our fee, the host's share, its stage on each track, and Stripe's references.
- **Per refund:** amount, who decided it and why, its stage, Stripe's reference.
- **Money record (add-only):** one line per movement, in cents, with what it was, which call, when, and Stripe's reference.
- **Stripe messages:** saved as received, with Stripe's own ID to ignore repeats, and whether we have finished handling each one.

## How we test it

- **Automated tests for the pricing rule:** normal call, host late, host leaves early, customer late, nobody shows, free call, under 50 cents, never above the booked total, a foreign card, a late cancellation, rounding, refunds in part and in full, and fee plus host share always equal to what the customer paid.
- **Automated tests for "never twice":** the same step run twice; two helpers charging the same call at once; a crash right after Stripe succeeded; messages from Stripe repeated or out of order.
- **Automated tests for deadlines and rules:** a hold that has run out blocks joining; an undecided review is released on time; each cancelling rule at its exact cut-off; a refund and a payday arriving together.
- **Sandbox tests with Stripe's test cards:** a card that works, a declined card, a card that needs the bank's extra approval, and a foreign card.
- **Whole journey in the sandbox:** payout setup, hold, a simulated call, charge, a host refund, a payday brought forward for testing, host paid.
- **Stripe's messages:** a fake message is rejected and a repeated one is ignored.

## This module is done when

- [ ] A paid call cannot be joined without a valid hold, and a free call can.
- [ ] For every test case, the amount charged matches the pricing rule to the cent.
- [ ] The host's share plus our fee always equals what the customer paid, and the money record explains every payment.
- [ ] No test can make a charge, refund or payout happen twice.
- [ ] A "needs review" call is never charged without a decision.
- [ ] Each cancelling rule charges nothing before its cut-off and the booked price after it.
- [ ] A host can refund before their share is sent, and the customer receives it.

## Not in this module

The calendar and booking, saving a card for later, "available now" calls, extending a call, tips, taxes
and invoices, other currencies, hosts outside the United States, refunds after the host has been paid,
paying a host from company money, penalties for hosts who cancel, fighting disputed charges with
evidence, setting when Stripe pays each host's bank (we send once a week; Stripe's own bank timing
is left at its default), and going live with real money.

## What the automatic checks cannot test

Real cards, real bank payouts, and how long a real card hold lasts. The sandbox moves no real money.
These are checked once, with small real amounts, on the company's own Stripe account before launch.

## Before real money (not needed for development)

- Written approval from Stripe, on the company's account, for this exact business. Stripe's rules ban adult live-chat services, so the request should describe non-sexual conversations between adults and the rules we enforce.
- A lawyer's look at the waiting, cancelling and refund wording, especially for customers outside the United States.
- A budget for the costs the company absorbs: Stripe's $2 monthly charge per paid host, Stripe's card fee on refunds, disputed charges, and hosts paid after our own mistakes.
