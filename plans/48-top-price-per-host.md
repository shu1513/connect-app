# Plan 48: A higher top price for one host

**Status:** built with this plan, 20 November 2026 (see `docs/module-record.md`). Written by the
builder alone, from the code as it is on `main` after pull request 87, and from what the founder
answered that day. It is a small change, so the plan and the code are in one pull request.

## For the founder: what this is

Every host can charge at most $1,000 per 15 minutes. That stays. New: on the admin page "Hosts
and accounts" you can let **one host at a time** charge more, up to **$2,500 per 15 minutes**,
and take that away again. No host can do this for themselves.

## What the founder said (20 November 2026)

The founder asked whether $1,000 per 15 minutes is too low for a very big celebrity. The advice
was to keep $1,000 for everyone, because Connect carries the loss when a customer's bank takes a
payment back and the whole booked price is held on the customer's card, and to raise the limit
for a single host by hand. Two questions were then put to the founder, each with the builder's
pick and the reason.

1. *What is the highest price per 15 minutes you would ever allow, for a host you have checked
   yourself?* Offered: $10,000 (the builder's pick), $5,000, $2,500, $25,000. **The founder chose
   $2,500.** The longest call (6 hours) then costs $60,000.
2. *You let a host charge up to $2,500, they set $2,000, and later you lower their limit to
   $1,500 or take it away. What happens to their price?* Offered: the price drops at once and
   the host gets an email (the builder's pick); the price stays until they change it; lowering
   is refused. **The founder chose: the price drops at once.** Calls already booked keep their
   price.

## Decisions (the builder's; the founder can change any of them)

1. **Where it lives.** One new field on the host's profile: her own top price. Empty for every
   host but the ones the founder raised. The database itself refuses a value that is not above
   $1,000 or is above $2,500.
2. **Who can write it.** Only the founder's step (`setTopPrice`). A host's own "Save" names the
   fields it writes, and this is not one of them: nothing a host's form sends can reach it.
3. **Where the price is checked.** In the two places a price is set, as before: applying to
   host (always $1,000, an applicant has no top price yet) and saving the profile (that host's
   own top price, read with the profile locked, so a save and the founder's change cannot cross).
4. **What a host is told.** A price above the limit is refused with "Your price can be at most
   $1000.00 per 15 minutes." (it said "The price is too high."). A host with a higher top price
   sees one line under the price field: "Your price can be up to $2500.00 per 15 minutes."
   Other hosts see nothing new. A raise sends no email: the founder gives it to someone she is
   already talking to.
5. **Lowering.** When the host's price is above the new top price, it comes down to exactly the
   new top price in the same step, and the host gets an email that says the old and the new
   price. Requests and calls already made keep their price: it is fixed on each of them.
6. **One thing stops a lowering.** A regular price is never below what a member pays (plan 19).
   If the host offers a member price above the new top price, or a member's month at such a
   price is open, the lowering is refused with a sentence that says how far it can go now.
7. **Taking it away has its own button** ("Put back to $1000.00"), so an empty field pressed by
   mistake lowers nobody's price.
8. **Written down.** Every change is a line in the founder's record (`admin_actions`: "top price
   set" or "top price removed", from what to what, and whether the host's price came down), in
   the same database step as the change and the email.
9. **A membership month costs at most $400,000.** That was already the most a month could cost
   (100 hours at $1,000). With a member price of $2,500 a month of 100 hours would cost
   $1,000,000, one cent more than Stripe takes in one payment. So the old ceiling is now a rule
   of its own; no host at $1,000 or less notices it.
10. **The Host Agreement is not changed here.** It says a host sets a price and names only the
    lowest. Whether it should name a highest price, and Connect's right to lower one, is put to
    the lawyer (`docs/for-the-lawyer.md`, section 17). A new version would ask every host to
    accept again, which is the founder's call.

## What it relies on (each read in the code by the builder)

- The only check of a highest price was `MAX_PRICE_PER_15_CENTS` in `checkedDetails`
  (`src/lib/profiles/profiles.ts`), which `createHostProfile` and `updateHostProfile` go through.
  The founder's pages, the phone app's door and the check scripts set no price another way (two
  check scripts write a price straight into the database, at $1,000 or less).
- A member price is never above the regular price (`offerProblem`), so it follows the host's
  top price without a rule of its own.
- A call, a request and a request for more time each copy the price when they are made; nothing
  reprices them later.
- **Are sums this large safe?** The longest call at $2,500 is $60,000 (6,000,000 cents). Money
  is kept in whole cents in 32-bit numbers (up to about $21 million). The sums in
  `src/lib/payments/pricing.ts` are done in the program, not the database, and stay exact far
  beyond this. Stripe takes up to $999,999.99 in one payment. A tip and a contribution keep
  their own ceiling of $100,000. A test now holds these together, so a later, higher ceiling
  that breaks one of them fails the tests.

## The changes

- `src/db/schema.ts`, `drizzle/0052_top_price.sql`: the field and the database's own check.
  (Numbers 0050 and 0051 are left for the two other branches that were open that day.)
- `src/lib/payments/pricing.ts`: the two limits, `topPriceOf`, `topPriceProblem`, and
  `hostPriceProblem` now also refuses a price above the host's top price.
- `src/lib/profiles/profiles.ts`: the two checks use it; `setTopPrice`, the founder's step.
- `src/lib/profiles/top-price-email.ts`, `emails.ts`: the email to a host whose price came down.
- `src/app/admin/people/`: the section "A higher top price for one host" and its action.
- `src/app/host/page.tsx`: the price fields take no more than the limit; the one line for a
  raised host.
- `src/lib/membership/rules.ts`: a month costs at most $400,000.
- `scripts/top-price-check.ts`: a new check script against a real database.
- `docs/module-record.md`, `docs/for-the-lawyer.md`.

## How it is checked

- Tests of the rules: $1,000 passes and one cent more is refused for a host without a top price
  of her own; a raised host goes up to her top price and no further; what the founder may type;
  the database's check holds the same two numbers; the largest sums fit Stripe and the database;
  the month's ceiling; the words of the email.
- `scripts/top-price-check.ts`, through the app's own functions on a real database: everything
  above, plus that the other host is never touched, the founder's record, the email, the member
  price stopping a lowering, and the database refusing a wrong value written around the app.
- In a browser: the founder's form (raise, lower, take away, an empty field), and the Hosting
  page of the raised host.

## What cannot be tested here

- Whether a customer's bank allows a hold of tens of thousands of dollars on a card. Many will
  not, or will ask the customer first.
- What Stripe does with very large single payments on a new account (it may hold or review
  them). Worth asking Stripe before the first host is raised.
- What a lost bank dispute over such a call costs Connect: the whole amount, as before, only
  larger. That is the reason the ceiling is $2,500 and not more.
