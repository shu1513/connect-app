# Plan 40: Hosts cannot set free calls

**Status:** built with this plan, 19 November 2026 (see `docs/module-record.md`). Written by the
builder alone, from the code as it is on `main` after pull request 64, and from what the founder
said that day. It is a small change, so the plan and the code are in one pull request.

## For the founder: what this is

Until today a host could set their price to at least $5 per 15 minutes, or to 0 for free calls.
A free call still costs Connect the video (about 6 to 9 cents per 15 minutes once the monthly
allowance at LiveKit is used up) and brings in nothing.

After this change **every host charges at least $5 per 15 minutes.** Zero can no longer be
entered. Nothing else about prices changes.

## What the founder said (19 November 2026)

"no host is free. host has a minimum amount they need to charge right? free calls cost us money".
Told that zero was allowed: "no. hosts must charge something, and that something should cover our
expenses with livekit." And, shown what a $5 call leaves after Stripe's and LiveKit's costs (a few
cents either way), and two ways to make every call cover its video (a small video charge in our
fee, or a higher minimum): "we keep $5 per 15 minutes as the minimum for now, hosts can't set free
calls."

So decided by the founder: no free calls; the minimum stays $5; no video charge and no higher
minimum for now. This changes decision 9 of `plans/02-payments.md`.

## Decisions (the builder's; the founder can change any of them)

1. **The door is closed where a price is set.** There are exactly two places: a person applies
   to host, and a host saves their profile. Both now refuse a price under $5, zero included, with
   one sentence: "Your price must be at least $5.00 per 15 minutes."
2. **The form no longer offers it.** The Hosting page says "at least $5" and its price field does
   not take less.
3. **A host who is at zero today** (only test accounts: the app is not live) keeps that price
   until they next save their profile, and can be asked for calls without a price until then.
   From that save on, new requests cost at least $5; requests and calls already made keep their
   price. Their form says so. Nobody is hidden or blocked.
4. **The rules for a call that has no price stay in the code.** A call keeps the price it was
   made with, so a call that already exists at zero still works: it skips payment, and its
   customer had to confirm their ID first. These rules can no longer be reached by a new host,
   and the check scripts use them to try calls without going to Stripe (they set a test host to
   zero straight in the database, as a host from before this change). Taking them out would be a
   large change for no gain while no host can be at zero.
5. **Two sentences for customers are corrected.** The account page and the "Confirm who you
   are" page said an ID check is needed by "anyone booking a free call". That is dropped: there
   are no free calls to book.

## What it relies on (each read in the code by the builder)

- The price rule was `priceProblem` in `src/lib/payments/hold.ts`, used only by `checkedDetails`
  in `src/lib/profiles/profiles.ts`, which both `createHostProfile` and `updateHostProfile` go
  through. Nothing else in `src/` or `scripts/` called it.
- The form: `src/app/host/page.tsx` (two price fields, for applying and for editing).
- `updateHostProfile` had a sentence of its own for a host with a membership who tried zero; it
  is no longer reachable and is removed. The rule beside it (the regular price is never below
  the member price) stays.
- Check scripts that made a free host through the real functions: `scripts/accounts-check.ts`
  (five hosts) and `scripts/journey-check.ts` (the host of the journey's first, unpaid call).
  `scripts/membership-check.ts` checks that a host with a membership cannot go to zero.

## The changes

- `src/lib/payments/pricing.ts`: `hostPriceProblem`, plain logic with tests, in place of
  `priceProblem`.
- `src/lib/profiles/profiles.ts`: uses it; the unreachable sentence is gone.
- `src/app/host/page.tsx`: the two fields and their label; one sentence for a host at zero.
- `src/app/account/page.tsx`, `src/app/identity/page.tsx`: the corrected sentence.
- The three check scripts: free test hosts are made at $5 and then set to zero in the database;
  a price of zero is checked to be refused, with the sentence it gives.
- `plans/02-payments.md`: a note at decision 9. `docs/module-record.md`: what was built.

## How it will be checked

- Tests of the rule: $5 and more pass; anything under, zero included, is refused; so is a price
  that is not a whole number of cents.
- `scripts/accounts-check.ts`, `scripts/journey-check.ts` and `scripts/membership-check.ts`
  against the running app and the local database.
- In a browser: the Hosting form refuses zero, and a host at zero sees the sentence.

## Not built

- A video charge in Connect's fee, or a higher minimum (the founder: not for now).
- Removing the rules for calls without a price from the code (decision 4).
- Changing the price of calls that already exist.

## Still open

- **Before launch:** the live database starts empty, so no host can be at zero there. Test hosts
  and their requests must never be copied into it; if they ever are, hosts at zero must be given
  a price first.

## Astra's check (19 November 2026)

"Ready", with no defect that must be fixed. Astra went through every way a price is set or
copied (applying, saving a profile, the membership's own prices, admin pages, the seed script,
defaults in the database) and found each closed for a new host; confirmed that a host at zero can
still save their name, about text and languages (the form then sets $5); found no check script
that was missed; and judged decision 4 sound for a live database that starts empty. One point
taken: the sentence for a host at zero is clearer about what changes and what does not.
- **For the founder, from the numbers of that day:** at $5 a call about pays for its own card
  and video costs and leaves nothing for the monthly costs (LiveKit's plan, Stripe's $2 in a
  month in which a host is paid, hosting). The numbers are in `docs/module-record.md`.
