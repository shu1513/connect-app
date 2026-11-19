# Plan 27: Hosts outside the United States

**Status:** built, 19 November 2026 (see "What building added to this plan" at the end, and
`docs/module-record.md`). Written 19 November 2026 by the builder alone (no
helper agents), from the code as it was on `main` after pull request 47, from Stripe's own pages,
and from tests in Stripe's test mode on that day. Astra checked it twice, both times "ready with
changes"; every point is worked in below (the two lists are at the end).

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

Two smaller things the builder chose, which the founder can change:

- **Stripe's charge for paying out across a border** (its price list says from 0.25% of the
  amount) is carried by Connect, not taken from the host.
- **Greece, Cyprus and Bulgaria are in the list**, although Stripe says its ID check cannot read
  fields written in Greek or Cyrillic letters. A host there can use a passport, which is printed
  in Latin letters. Someone whose document cannot be read does not pass the ID check, as today.

## What Stripe allows

**Tried in Stripe's test mode,** with the app's own way of paying a host: a charge in dollars on
Connect's account, then a transfer of the host's share that names that charge.

| Tried | What Stripe did |
| --- | --- |
| The payout account exactly as the app opens it today, for a host outside the US | **Refused, for every country.** Stripe wants the account to ask for "card payments" as well. |
| The same account, also asking for "card payments" | **Accepted** for the UK, Germany, France, Switzerland, Canada, Australia, New Zealand, Singapore, Japan, Hong Kong and Mexico. |
| Sending a $10.00 share to an account with the same two abilities | **Accepted** for the UK, Germany, France, Spain, Switzerland and Canada. It arrived in the host's own money (that day: £7.62, €9.10, 8.43 francs, 14.31 Canadian dollars). These test accounts were made a slightly different way from the one payout setup opens, so that a script could fill in the host's details: see the next row but one. |
| The same for Australia, Singapore and Mexico | **Refused:** "Funds can't be sent to accounts located in AU". |
| Accounts in Argentina, Chile, Colombia, Peru, Uruguay | **Refused:** they cannot receive money from us at all. |
| An account in Brazil | **Refused:** a US account cannot open one. |
| Stripe's older, lighter kind of account for people who only receive money | **Refused** for a US account in every other country. |
| Stripe's own form for a host abroad | The link to it is made as today. Filling the form in to the end was not tried yet. |
| Filling in the host's details by script, for the account payout setup opens | **Refused.** Only the host can do that, on Stripe's form. So a collection into exactly that kind of account needs a person to fill in the form once (the browser check below). |
| Removing a test account that holds test money | Worked. |

**Read on Stripe's pages, not tried for every country:** money can go between the United
States, the United Kingdom, the European Economic Area, Canada and Switzerland, and nowhere else
without talking to Stripe. Six countries were tried; the others in the list below rest on that
rule and on Stripe's own table of countries. The check script of this change opens an account in
every one of them (below).

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
   website or a line of business: Connect's own web address, and "private video calls".
3. **Collecting** works as today. Their share leaves Connect in dollars and arrives at Stripe in
   their own money.
4. **The "Getting paid" part** of the Hosting page says, for a host abroad, that earnings are
   counted in dollars; that the dollars shown as sent are turned into their own money by Stripe
   at its rate; and it gives no number of days for the first payment to their bank, which was
   only ever measured for US hosts.

For a host in the United States the payout account and the money are exactly as today, and
nothing changes for customers. One thing is new for everyone: a payout account can only be
started once the host profile has been sent (rule 1 below).

## One rule that must always hold

**Connect never links, sets up or pays a Stripe account that is in another country than the
host's profile.** Stripe fixes an account's country when it is opened, and the wrong one cannot
be paid. Four things keep the rule:

1. **A payout account can only be started by someone who has a host profile.** Today the
   "Set up payouts" button is also there for a person who has not applied yet, and it opens a US
   account. The button is drawn only with a profile, and the action behind it refuses without
   one, whatever the page showed.
2. **Someone who already has a payout account and no profile** (a person who pressed the button
   before applying, which was possible until this change; such an account is a US one) can apply
   as a US host only. Any other country is
   refused with words: the account they started is for the United States, write to support.
3. **Before an account is used or kept, Stripe is asked for its country.** When payout setup is
   started with an account that already exists, and after a new one is opened, its country at
   Stripe must be the profile's. If it is not, nothing is saved or linked, the person is told to
   write to support, and it is logged. The same label is sent to Stripe for a host as today
   (`host-account:<their id>`), so pressing twice still opens one account. A new account's id is
   saved only if none was saved meanwhile, in one step; otherwise the one that was saved is
   used, after the same question to Stripe.
4. **"Can be paid" also asks it.** `refreshPayoutsReady` already asks Stripe about the account
   on every visit to the Hosting page, on the way back from Stripe's form, before a new
   collection and before a hold is placed for a call. It now also reads the account's country
   (written the same way as the profile's before the two are compared), and for a host whose
   profile says another country, or whose account's country cannot be read, it writes down "not
   ready" like any other no. (A payout account with no profile beside it has nothing to be
   compared with and is judged as today: the check scripts make such accounts, and so did a
   person who pressed the button before applying.)

What the rule does not do: it does not remove an account at Stripe that was opened and never
linked (it holds nothing and is never paid), and it does not look again at a collection that
was already accepted, whose account was checked when it was accepted.

**When this goes live,** the app is stopped and started with the new code in one go, as for
every change so far, so that no old request can still open a US account for someone while the
new form already takes other countries.

**A host cannot change their country.** The page says so next to the list. If it is wrong,
they write to support; there is no button for it, and after payout setup it cannot simply be
edited, because the Stripe account would no longer match.

## What it relies on (each read in the code by the builder)

- **Where the country is assumed today.** The tick box (`src/app/host/page.tsx:208`), its check
  and the moment it is written (`createHostProfile`, `src/lib/profiles/profiles.ts:96`, the
  column `us_confirmed_at`), and the payout account's country
  (`ensurePayoutAccount`, `src/lib/payments/hosts.ts:40`: `identity: { country: "us" }`).
  Two check scripts call `createHostProfile` with the old tick (`scripts/accounts-check.ts:306`,
  `scripts/journey-check.ts:195`). Nothing else reads a host's country. The other places that
  say "US" are about the customer's card (the 1.5% for a card from outside the United States)
  and stay as they are.
- **How a share is sent.** `transferAtStripe` (`src/lib/payments/actions.ts:428`) sends the
  amount in the payment's own currency, dollars, to the host's account, naming the charge
  (`source_transaction`). That is exactly what was tried above; it needs no change. Shares of
  calls, of membership months and of contributions all go this way.
- **Nothing is ever taken back from a host's Stripe account.** A refund is refused once the
  share was sent, or (the founder's refund of a contribution) is paid by Connect itself. No code
  reverses a transfer or debits an account, so nothing has to be turned back from pounds into
  dollars. Astra read every refund, dispute and closing path for this and found none.
- **Whether a host can be paid** is read from Stripe as "transfers: active"
  (`refreshPayoutsReady`, `hosts.ts:69`). The same line exists on an account abroad, and an
  account with it active took the transfer in the test. Nothing listens to Stripe's messages
  about a host's account; it is asked at the four moments named in rule 4.
- **The ID check** (`src/lib/safety/identity.ts`) names no country. It passes someone when
  Stripe has verified their document and read a date of birth that makes them 18.

## The changes

| Place | Change |
| --- | --- |
| `src/lib/profiles/countries.ts` (new) | The list: each country's two-letter code and its English name. One function says whether a code is in it. Nothing else. |
| `src/db/schema.ts`, one migration | `host_profiles.country`: never missing, `'US'` for every host there is today and for a row written without one. That it is a country of the list is checked where a host applies, the one place that writes it. The column `us_confirmed_at` stays, as the moment the host said where they are based; only its comment changes. |
| `src/lib/profiles/profiles.ts`, `createHostProfile` | Takes the country in place of the tick. It must be given and be in the list: a missing or unknown one is refused, never taken as the United States. Rule 2 above. Nothing else in this file is touched (another change is being made to its social-account parts at the same time). |
| `src/app/host/page.tsx`, `src/app/host/actions.ts` | The list in the sign-up form, with the sentence about dollars and "this cannot be changed later". The host's country shown to the host on the Hosting page (not on their public page). The payout button only with a profile, and the action's own refusal (rule 1). The paragraph under "Getting paid" for a host abroad. When Stripe cannot be asked about the payout account, the page says that what it shows is what was last known. |
| `src/app/host/earnings.tsx` | For a host abroad: beside what was sent, that it is the amount in dollars and arrives in their own money; no "days until the first bank payment" sentence. |
| `src/lib/payments/hosts.ts` | `ensurePayoutAccount` needs the host's profile and follows rule 3. What is asked of Stripe is built by one small function with no side effects, from the host and their country. For the United States it gives exactly today's request. For any other country it also asks for "card payments" and hands Stripe Connect's web address, "private video calls" as what the host does, and the matching category. `refreshPayoutsReady` follows rule 4. |
| `src/app/host/payouts-return/page.tsx` | The sentence for "not ready yet" also says to write to support if the setup cannot be continued. |
| `src/app/admin/people/page.tsx` | The founder sees each host's country where hosts are approved. |
| `scripts/accounts-check.ts`, `scripts/journey-check.ts` | Call `createHostProfile` with a country. The check "a host outside the United States is refused" becomes: a host in the UK is accepted and their country kept; Australia, an empty country and a made-up one are refused. |
| `scripts/abroad-check.ts` (new) | Below. |
| The other check scripts | No change: the hosts they write straight into the database are US hosts by the column's default, and their borrowed US payout account matches. |

**The category handed to Stripe** is "professional services" (Stripe's code 8999). It describes
the host for Stripe's records; the host's account never takes a card payment itself. Stripe is
asked about it together with the approval of the business.

**The web address handed to Stripe** is Connect's own front page, not the host's page: a host's
page is not public until the founder has approved it, and payout setup comes before that. It is
only sent when Connect runs on a public https address. On a developer's computer it is left
out, and Stripe asks the host for it.

## What is left out, on purpose

- **Prices in pounds or euros.** The founder chose dollars only. It would touch every price,
  every receipt and every money rule.
- **Showing a host what arrived in their own money** for each collection. They see it in their
  Stripe dashboard. Connect shows dollars, as it counts them.
- **A founder's switch for single countries.** The list is in the code. Taking a country out of
  it stops new hosts from there applying. It does not switch off hosts from there who are
  already approved.
- **Moving a host to another country.**

## The order of work

Small steps, each checked before the next:

1. The list of countries with its tests, and the migration.
2. The payout account: the function that builds the request (with a test that the US request is
   today's, field for field, and its label too), rules 1, 3 and 4.
3. Applying: `createHostProfile` takes a country (rule 2) together with everything that calls
   it, the form and the two scripts, in one step. Then the wording on the Hosting page and in
   the earnings part, and the founder's page.
4. `scripts/abroad-check.ts` against Stripe's test mode, the browser, and every earlier check
   script, in a time slot the other change is not using.

## How it is checked

- **Unit tests:** the list (every code is two capital letters, no country twice, the United
  States is in it, Australia and Iceland are not); the request for a US host is exactly today's,
  and its label; the request for a host abroad has both parts.
- **`scripts/abroad-check.ts`**, a script of its own, against Stripe's test mode and the local
  database, with the same two guards as the payments check (a test key, this computer's
  database). It makes its own people (their ids start `ab-`), never touches the test host
  `host@test.local` or its payout account, and removes what it made in a `finally`: every test
  account at Stripe is noted the moment its id is known and is also found again by its email
  address (so one whose id never came back, and those of a run that was stopped, are removed
  too), each is removed even if another could not be, and one that could not be removed is a
  failed check, with its id. The test customers go too; test payments stay at Stripe as history.
  **It only ever acts on its own records.** It never runs the helper's jobs, which act on every
  call and payment in the database: its call is settled by the function that settles one call
  (`settleOrdinaryCharges`), its contribution's money is taken by the function that takes one
  payment, and its collection is its own host's.
  1. **Every country in the list:** a test host there starts payout setup; Stripe accepts the
     account and says it is in that country. This shows an account can be opened there. It does
     not show money can be sent there; step 3 shows that for four of them.
  2. **The rule:** payout setup without a profile is refused. Someone with a US account and no
     profile cannot apply from the UK, and can from the United States. A host whose profile says
     the UK and whose linked account is a US one is refused at setup, counts as not ready, and
     cannot collect; this is shown with a US account Stripe has activated, which counts as ready
     beside a US profile, so that the country is the only difference. An account whose country
     Stripe's answer does not name is not ready either. Two setups started at the same moment leave one account. And an account
     that was opened at Stripe for the United States and never saved, for someone who then
     applies from the UK: whatever Stripe answers to the second request, no US account is
     linked.
  3. **A real collection, for the UK, Germany, Switzerland and Canada.** A test host there gets
     a test account that Stripe has activated (its details are Stripe's own test values; the
     account is written beside the host as payout setup would). The account that payout setup
     itself opens cannot be activated by a script, since Stripe collects its details on its own
     form; so this one is made with the same two abilities and the same responsibilities, and
     the script says so. The setup's own account is completed once by hand, in the browser
     check. A customer's call is held, charged and settled, the host presses "Collect
     earnings", and the script reads at Stripe: one transfer for that share, to that account, in
     dollars, of the amount Connect's books say, naming the call's charge; and on the host's
     side a line for that very transfer in the account's own money. In Connect's books the share is "sent" with the same cents and
     the same collection charge as for a US host. No exchange rate is checked: it changes.
  4. **A contribution's share** to the UK host goes out in the same collection (a second
     transfer, one collection charge for both), so that a second kind of share has crossed a
     border once. Shares of membership months use the same sending
     code and are not walked here.
  5. **A US host,** made by the same script the same way, collects as before.
- **Every earlier check script,** once more on the finished code.
- **In the browser:** the sign-up form and the Hosting page as a host abroad, phone-sized and
  wide. "Set up payouts" opens Stripe's form for the right country, and the form is filled in
  to the end once, in test mode with Stripe's own test values, for a host in the UK: back in
  Connect the host is "ready", without having been asked for a website or a line of business.
  That payout account is a new one of its own, not the test host's. Then
  `scripts/abroad-check.ts --setup-host=<that host's email>` makes one paid call for that host
  and collects it: the one collection into an account that payout setup itself opened.
- Astra reviews the code, then CodeRabbit, as for every change.

## Done when

- A person can apply as a host from any country in the list, and from no other.
- A host abroad can open their payout account, and a collection reaches it.
- Connect never links a newly opened account in another country than the host's profile, and
  refuses payout setup and new collections for one that is linked.
- A US host sees and gets exactly what they do today.
- Every earlier check script passes.
- The record in `docs/module-record.md` is written.

## What only the founder, Stripe or a lawyer can settle

- **Stripe's fees for this.** What Stripe keeps when it turns dollars into pounds or euros is
  not on the pages that were read, and in the test no fee line appeared on either side. To ask
  Stripe, together with the 0.25% above.
- **Stripe's approval** of hosts abroad, of the category above, and the question about
  Australia, Singapore and Latin America.
- **The law in each country.** For the lawyer: the UK's Online Safety Act, the EU's rules for
  online platforms and for personal data, consumer rules for memberships and monthly
  contributions, VAT on Connect's fee, and whether Connect must report what hosts in the EU and
  the UK earn to the tax offices there.
- **Tax papers for hosts abroad.** Stripe's yearly tax form is for US hosts only.
- **How long a first payment to a bank abroad takes.** Not measured.
- **A real host abroad**, before launch: one person in the UK and one in a euro country who
  apply, pass the ID check, open the payout account and collect once. And one person from
  Greece, Cyprus or Bulgaria who tries the ID check with their national ID card.

## Working beside another change

"Connect your Instagram" is being built at the same time, on its own branch. Both changes add a
migration and both add to `docs/module-record.md`; whichever is merged second brings `main` in
first and makes its migration again. The two share one local test database and one Stripe test
account, so neither runs a check script while the other does.

## Astra's check (19 November 2026): "ready with changes"

Astra read the plan against the code, without running anything. It took the Stripe tests as
reported.

| Astra's point | What was done |
| --- | --- |
| **Had to change.** Nothing made the profile's country and the Stripe account's country agree: payout setup can be started before applying, and then opens a US account that a later application from abroad would reuse. | "One rule that must always hold": the four parts. |
| **Had to change.** "The other check scripts need no change" was wrong: two of them call `createHostProfile` with the old tick. | Both are in the table of changes, with what their check becomes. The scripts that write hosts straight into the database do stay as they are. |
| **Had to change.** The new checks could have used or overwritten the shared test host's payout account, and could have left accounts behind at Stripe. | A script of its own, with its own people, that never touches the test host, cleans up in a `finally`, and fails when an account is left. |
| The checks claimed more than they showed: "the US request is unchanged" by one field, a collection that only did not fail, an account opened taken as proof that money can be sent. | The whole US request and its label are compared; the collection is read at Stripe and in the books; the all-countries step says what it does not show. |
| The host's own page is not public before approval, so it cannot be the web address given to Stripe at payout setup. | Connect's own front page is given. |
| Filling in Stripe's form to the end was not tried. | Said under "What Stripe allows", and done once in the browser check. |
| The earnings part says dollar amounts were "sent to your Stripe payout account" and names days until the first bank payment. | Its wording for a host abroad is in the table of changes. |
| "Only support can change it" promised something the plan leaves out. | The page says it cannot be changed, and why an edit after payout setup is not possible. |
| Who carries Stripe's cross-border charge, and whether Greece, Cyprus and Bulgaria are promised at launch, were left between the lines. | Both are stated as the builder's choices the founder can change, in the decisions. |
| "Tested, not assumed" covered countries that were not tried. | The section says which were tried and which rest on Stripe's rule. |
| The order of work was not clear enough to build in small steps. | "The order of work". |
| Membership months sending several shares from one charge across a border is not walked. | One contribution share is walked; the rest is said to be not walked. |

Astra asked for nothing to be removed, and warned against adding a currency ledger, stored
exchange rates, a country panel for the founder, or a check of every money journey in every
country. None is in the plan.

## Astra's second check (19 November 2026): "ready with changes"

Astra read the rewritten plan against the code again. It found the three earlier points closed
in the design, one new point that had to change, and several details.

| Astra's point | What was done |
| --- | --- |
| **Had to change.** "Settled as in the payments check" would have run the helper's jobs, which act on every call and payment in the database, also other people's. | The new script only ever acts on its own records; the functions it uses are named. |
| The rule promised more than it does: an account opened at Stripe and never linked can still exist, and an accepted collection is not looked at again. | The rule is worded as what Connect never does, and what it does not do is said. |
| A no from the country check must be written down as "not ready", not thrown, or the Hosting page would go on showing "ready". | Said in rule 4. |
| The account's country must be asked for from Stripe explicitly and compared in the same writing as the profile's; a country that cannot be read is not a match. | Said in rule 4. |
| The page a host returns to from Stripe tells them to continue the setup, which is no help when the country is wrong. | It also says to write to support. |
| The case "an account was opened and its id was lost, then the person applies from another country" was not among the checks. | Added to step 2 of the new script. |
| The collection would be shown with an account that payout setup did not open. | Said why, what the fixture shares with the real one, and that the real one is completed by hand in the browser check. |
| "One transfer" for a collection that carries two shares. | One transfer for each share, one collection charge. |
| Changing `createHostProfile` in one step and its callers in the next would leave a broken step between. | One step. |
| Payout accounts with no profile are not only the check scripts': a person who pressed the button before applying has one too. | Said in rules 2 and 4. |
| "Shown on their profile" could be read as the public page. | The Hosting page. |
| "Nothing changes for a US host" was not quite true: nobody can start payout setup before applying any more. | Said. |
| An old request still running while the new form is live could open a US account for someone applying from abroad. | "When this goes live". |

## What building added to this plan (19 November 2026)

Nothing here changes a rule.

- **The test accounts of the check script.** The plan had them made the older way, with no
  Stripe dashboard. An account made that way could not be read the newer way for minutes ("try
  again shortly"), and the app only ever asks the newer way. So they are opened with what the
  app's own request builder gives, with a test web address and no Stripe dashboard, which lets
  the script fill in Stripe's test details. That is closer to the real thing than planned.
- **Stripe checks a host's details after its form.** In the test that took about a minute for
  a host in the UK (a US test account was ready at once); for a real host it is not known.
  During that time the Hosting page and the page a host comes back to used to say that Stripe
  still needs details from them. They now say that Stripe may still be checking, that the setup
  can be continued if Stripe needs more, and to write to support if it cannot be.
- **The second form of the check script,** `--setup-host=<email>`: one collection into an
  account that payout setup itself opened and its host completed on Stripe's form. It takes only
  a fresh host with no calls, members, contributions or collections, and refuses the shared test
  host.
- **Where a host comes back to after Stripe's form** is the app's public address. On a
  developer's computer that is a temporary address which may be switched off; the same page on
  the local address gives the same answer. Nothing to change in the app.
- **Checked:** 43 checks of the new script, all 18 earlier scripts, and the browser check with
  Stripe's own test form for a host in the United Kingdom, ending in a collection that arrived
  in pounds.
