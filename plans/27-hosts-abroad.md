# Plan 27: Hosts outside the United States

**Status:** a plan only; nothing is built. Written 19 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 47, from Stripe's own pages,
and from tests in Stripe's test mode on that day. Astra's check of this plan is at the end.

## For the founder: what this is

Today only someone based in the United States can be a host: the sign-up form makes them tick
"I am based in the United States", and their payout account at Stripe is opened as a US account.

After this change a host can be based in any of 33 countries: the United States, the United
Kingdom, Canada, Switzerland, and 29 more countries of Europe. Everything else stays as it is.
Customers could already be anywhere.

It is a small change in the app. Most of the work was finding out what Stripe allows.

## What the founder decided (19 November 2026)

| Question | Decided |
| --- | --- |
| Hosts abroad at launch? | **Yes, from day one**, in "any countries that we can easily do". |
| Which countries | **Every country Stripe lets a US account pay without asking Stripe first** (the list below). |
| Prices | **In US dollars only.** A host abroad sets a dollar price. |
| What a host abroad receives | **What Stripe turns their dollars into**, in their own money, at Stripe's rate at that moment. The host carries the cost of the exchange, and is told so before applying. |

## What Stripe allows (tested, not assumed)

All of this was tried in Stripe's test mode with the app's own way of paying a host: a charge in
dollars on Connect's account, then a transfer of the host's share that names that charge.

| Tried | What Stripe did |
| --- | --- |
| The payout account exactly as the app opens it today, for a host outside the US | **Refused, for every country.** Stripe wants the account to ask for "card payments" as well. |
| The same account, also asking for "card payments" | **Accepted** for the UK, Germany, France, Switzerland, Canada, Australia, New Zealand, Singapore, Japan, Hong Kong and Mexico. |
| Sending a $10.00 share to such an account | **Accepted** for the UK, Germany, France, Spain, Switzerland and Canada. It arrived as £7.62, €9.10, 8.43 francs and 14.31 Canadian dollars. |
| The same for Australia, Singapore and Mexico | **Refused:** "Funds can't be sent to accounts located in AU". |
| Accounts in Argentina, Chile, Colombia, Peru, Uruguay | **Refused:** they cannot receive money from us at all. |
| An account in Brazil | **Refused:** a US account cannot open one. |
| Stripe's older, lighter kind of account for people who only receive money | **Refused** for a US account in every other country. |

Stripe's own pages say the same: money can go between the United States, the United Kingdom,
the European Economic Area, Canada and Switzerland, and nowhere else without talking to Stripe.

**So the list is:**

- United States, United Kingdom, Canada, Switzerland;
- Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Denmark, Estonia, Finland, France,
  Germany, Greece, Hungary, Ireland, Italy, Latvia, Liechtenstein, Lithuania, Luxembourg, Malta,
  the Netherlands, Norway, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden.

That is every country of the European Economic Area except Iceland, which Stripe's own table
leaves out. Gibraltar is in Stripe's table but outside the regions its rule names, so it is left
out until it is tried.

**Not in this plan: Australia, Singapore, Latin America.** No code can change Stripe's answer.
The ways there are to ask Stripe's sales team, to use a different Stripe product made for
companies with their own money-transfer licences, or later a company and a Stripe account in
that region. The founder asks Stripe about them together with the approval of the business.

## What changes for a host abroad

1. **The sign-up form** asks "Where are you based?" with the list above, in place of the tick
   box. Under it, one sentence for hosts outside the US: prices and earnings are in US dollars,
   and Stripe pays them in their own money at its rate at that moment.
2. **Their payout account** is opened for their country. Stripe then asks them for the same
   things it asks a US host (name, address, date of birth, phone, bank account), plus what kind
   of business they are. Connect fills in two things for them, so they are not asked about a
   website or a line of business: the address of their Connect page, and "private video calls".
3. **Collecting** works as today. Their share leaves Connect in dollars and arrives at Stripe in
   their own money.
4. **The "Getting paid" part** of the Hosting page says, for a host abroad, that earnings are
   counted in dollars and turned into their own money by Stripe when they collect.

Nothing changes for a host in the United States, and nothing for customers.

## What it relies on (each read in the code by the builder)

- **Where the country is assumed today.** The tick box (`src/app/host/page.tsx:208`), its check
  and the moment it is written (`createHostProfile`, `src/lib/profiles/profiles.ts:96`, the
  column `us_confirmed_at`), and the payout account's country
  (`ensurePayoutAccount`, `src/lib/payments/hosts.ts:40`: `identity: { country: "us" }`).
  Nothing else reads a host's country.
- **How a share is sent.** `transferAtStripe` (`src/lib/payments/actions.ts:428`) sends the
  amount in the payment's own currency, dollars, to the host's account, naming the charge
  (`source_transaction`). That is exactly what was tested above; it needs no change. Shares of
  calls, of membership months and of contributions all go this way.
- **Nothing is ever taken back from a host's account.** No code reverses a transfer, so there is
  no amount to turn back from pounds into dollars.
- **Whether a host can be paid** is read from Stripe as "transfers: active"
  (`refreshPayoutsReady`, `hosts.ts:69`). The same line exists on an account abroad.
- **The ID check** (`src/lib/safety/identity.ts`) names no country. It passes someone when
  Stripe has verified their document and read a date of birth that makes them 18.
- **Stripe's form for the host** (`payoutSetupLink`) was tried with an account abroad: the link
  is made as it is today.

## The changes

| Place | Change |
| --- | --- |
| `src/lib/profiles/countries.ts` (new) | The list: each country's two-letter code and its English name. One function says whether a code is in it. Nothing else. |
| `src/db/schema.ts`, one migration | `host_profiles.country`: two letters, `'US'` for every host there is today. The column `us_confirmed_at` stays, as the moment the host said where they are based; only its comment changes. |
| `src/lib/profiles/profiles.ts`, `createHostProfile` | Takes the country in place of the tick. A country that is not in the list is refused. Nothing else in this file is touched (another change is being made to its social-account parts at the same time). |
| `src/app/host/page.tsx`, `src/app/host/actions.ts` | The list in the sign-up form, with the sentence about dollars. The host's country shown beside their handle once they have applied, with "only support can change it". The paragraph under "Getting paid" for a host abroad. |
| `src/lib/payments/hosts.ts`, `ensurePayoutAccount` | Reads the host's country. For the United States the account is asked for exactly as today. For any other country it also asks for "card payments" and hands Stripe the host's page address, "private video calls" as what they do, and the matching category. |
| `src/app/admin/people/page.tsx` | The founder sees each host's country where hosts are approved. |
| `scripts/payments-check.ts` | A new part, `--abroad` (below). |
| The other check scripts | No change: the hosts they make are US hosts by the column's default. |

**A host cannot change their country themselves.** Stripe fixes an account's country when it is
opened. It is chosen once, like the handle.

**The category handed to Stripe** is "professional services" (Stripe's code 8999). It describes
the host for Stripe's records; the host's account never takes a card payment itself. Stripe is
asked about it together with the approval of the business.

**The page address handed to Stripe** is only sent when Connect runs on a public https address.
On a developer's computer it is left out, and Stripe asks the host for it.

## What is left out, on purpose

- **Prices in pounds or euros.** The founder chose dollars only. It would touch every price,
  every receipt and every money rule.
- **Showing a host what arrived in their own money** for each collection. They see it in their
  Stripe dashboard. Connect shows dollars, as it counts them.
- **A founder's switch for single countries.** The list is in the code. Taking a country out is
  a one-line change.
- **Moving a host to another country.**

## How it is checked

- **Unit tests** of the list: every code is two capital letters, no country twice, the United
  States is in it, Australia is not.
- **`scripts/payments-check.ts --abroad`**, against Stripe's test mode and the local database:
  1. For every country in the list, `ensurePayoutAccount` for a test host there is accepted by
     Stripe, and the account has that country. (Each test account is removed again.)
  2. A US host's account is still asked for exactly as before: no "card payments".
  3. For the UK, one euro country, Switzerland and Canada: a real collection. A test host there
     gets a test account that Stripe has activated (its details are Stripe's own test values),
     a customer's call is held, charged and settled as in the rest of the script, the host
     presses "Collect earnings", and the share arrives in that account's balance in its own
     money, with the dollars in Connect's books exactly as for a US host.
  4. A host in a country that is not in the list (Australia) is refused at sign-up, before
     anything is asked of Stripe.
- **Every earlier check script,** once more on the finished code.
- **In the browser:** the sign-up form and the Hosting page as a host abroad, phone-sized and
  wide; "Set up payouts" opens Stripe's form for the right country.
- Astra reviews the code, then CodeRabbit, as for every change.

## Done when

- A person can apply as a host from any country in the list, and from no other.
- A host abroad can open their payout account, and a collection reaches it.
- A US host sees and gets exactly what they do today.
- Every earlier check script passes.
- The record in `docs/module-record.md` is written.

## What only the founder, Stripe or a lawyer can settle

- **Stripe's fees for this.** Stripe's price list says paying out across a border costs from
  0.25% of the amount, charged to Connect. This plan lets Connect carry that; it is the
  founder's to change. What Stripe keeps when it turns dollars into pounds or euros is not on
  the pages that were read. In the test no fee line appeared on either side.
- **Stripe's approval** of hosts abroad, of the category above, and the question about
  Australia, Singapore and Latin America.
- **The law in each country.** For the lawyer: the UK's Online Safety Act, the EU's rules for
  online platforms and for personal data, consumer rules for memberships and monthly
  contributions, VAT on Connect's fee, and whether Connect must report what hosts in the EU and
  the UK earn to the tax offices there.
- **Tax papers for hosts abroad.** Stripe's yearly tax form is for US hosts only.
- **ID documents in Greek or Cyrillic letters.** Stripe says it cannot read fields written in
  those scripts. If it cannot read a date of birth, that person does not pass the ID check.
  A passport is printed in Latin letters. To be tried with a real host from Greece, Cyprus or
  Bulgaria before those countries are promised to anyone.
- **A real host abroad**, before launch: one person in the UK and one in a euro country who
  apply, pass the ID check, open the payout account and collect once.

## Working beside another change

"Connect your Instagram" is being built at the same time, on its own branch. Both changes add a
migration and both add to `docs/module-record.md`; whichever is merged second brings `main` in
first and makes its migration again. The two share one local test database and one Stripe test
account, so neither runs a check script while the other does.
