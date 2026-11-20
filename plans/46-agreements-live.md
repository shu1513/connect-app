# Plan 46: The agreements go live

**Status:** a plan. Written 20 November 2026 by the builder alone (no helper agents), from the
code as it is on `main` after pull requests 80 and 81. Astra (gpt-6.2-astra) checked the first
draft against the code: "not ready", with the points listed at the end. All are worked in.

**Its size, said plainly:** five parts. Part 1 is a module of its own (the documents in the app,
and proof of who accepted what). Part 2 is small. Part 3 is money and gets a detailed plan of its
own before it is built. Parts 4 and 5 are small.

## For the founder: what this is

The agreements exist as drafts (`docs/legal/`). Their list of "where the app would have to
change" had 14 points. Two are done (pull request 80: the 14-day sentence and "it renews every
month"). This plan builds the rest, except two that are not the builder's to build:

- **Closing your own account** is already planned as plan 45, parts 19, 19b and 19c, and the
  phone-apps session builds it. Agreed with that session on 20 November 2026. Until then the
  agreements say "write to us", which is true: the founder closes an account by hand.
- **Tax details from hosts** needs no code. Stripe has a product for each side of it, and both
  are switched on in the Stripe account of the company, which does not exist yet (see "Tax").

After this plan the app shows the real documents on real pages, keeps proof of every
acceptance, asks hosts to accept the Host Agreement, tells people 30 days ahead when the terms
change, lets Connect give a refund after a host has collected and get the money back from the
host, sends a host earnings she has not collected for a year, and deletes old emails and login
records. **None of it puts the agreements in force.** That needs the company, the blanks filled
in, and a lawyer. The documents go in as a **draft version**, and every legal page says "Draft.
Not in force yet." until the founder publishes a reviewed version with no blanks (decision 3).

## What the founder said (20 November 2026)

- "build the 14 changes so the agreements can go live. do what you think is the best."
- "do you need to make plans for this first? you know our flow yes? ... (if something is small
  enough maybe plan is not necessary or you can group them?)" So: the two wording changes went
  in without a plan (pull request 80), and the rest is grouped into this one plan.
- "after building everything, make sure the mobile session knows it." Done at the start, and
  again when each part merges (see "Working beside the phone-apps session").
- From earlier the same day: acceptance of the general terms is implicit, "like how we did it
  for electionssimplified.com"; "maximum protection for us".

## What is there today (read in the code)

- `/terms`, `/privacy`, `/rules` (`src/app/terms/page.tsx` and so on): a placeholder, a
  placeholder with true paragraphs about each feature, and the nine rules of `src/lib/terms.ts`.
- Sign-up's last step (`src/app/welcome/page.tsx`, `actions.ts`): two tick boxes, "I am 18 or
  older" and "I accept the rules, the terms and the privacy policy". The server writes
  `adultConfirmedAt`, `termsAcceptedAt` and `termsVersion` on the person's own line and nowhere
  else, so an earlier acceptance is overwritten. The form does not say which version it showed.
  `welcomed` in `src/lib/session.ts` compares `termsVersion` with the constant `TERMS_VERSION`.
- Applying to host (`createProfile` in `src/app/host/actions.ts`, `createHostProfile` in
  `src/lib/profiles/profiles.ts`): no agreement of any kind.
- The founder's decision about a host page (`decideProfile`): no reason is taken or stored; the
  email for "suspended" and "declined" gives none (`src/lib/profiles/decision-email.ts`).
- The identity page (`src/app/identity/page.tsx`): three sentences and a button "Start the
  check".
- A refund of a call's payment is refused once the host has collected: "A refund now has to go
  through support" (`refundPayment` in `src/lib/payments/actions.ts`). For a contribution the
  founder can refund after collection, out of Connect's own money
  (`src/lib/contributions/refund.ts`). A lost bank dispute after collection is "settled by hand"
  (`src/lib/payments/disputes.ts`). Nothing records that a host owes Connect money.
- A host's share is only ever sent when she presses "Collect" (`collectEarnings`), or when the
  founder does it for a closed host (`collectForClosedHost`).
- Deleted by the helper today: connection grades after 60 days, suggestion history after 90
  days, the texts of a refund request after a year, the text of login emails once sent. Every
  other email is kept in full with no end date (`email_outbox`), and so is every login record
  (`session`, with internet address and browser).
- The support address falls back to `support@connect.example` (`src/lib/terms.ts`).

## Decisions (the builder's; each can be changed)

1. **The documents live in the code, one file for each version, and old versions are never
   removed.** `src/legal/documents/<name>/<version>.ts`, each holding the text as written
   (the same plain marks as the drafts: headings, lists, tables, bold, links). A list
   (`src/legal/registry.ts`) says for each document its versions and the day each takes effect.
   The drafts in `docs/legal/` move there; `docs/legal/` keeps the map and Astra's drafts. So
   the text of every version a person ever accepted can always be shown, and a change to a
   document is a change in the code, reviewed like any other.
2. **A small reader of its own turns the text into a page**, with tests. No new package: the
   marks used are few, and a package would bring far more than is needed.
3. **A published version is frozen: its text never changes afterwards, and it has no blanks.**
   The first version of every document (`2026-11-20`) is marked a draft, with its blanks still
   in it; every page that shows a draft says so at the top. When the company exists and a lawyer
   has read the documents, a new version is added with the names and addresses written into the
   text itself, marked as published, and everyone is asked to accept it. So filling in a company
   name later can never change what an earlier acceptance was an acceptance of, and accepting a
   draft is never mistaken for accepting terms in force. A test refuses a published version that
   still holds a blank. (The first draft of this plan read the blanks from settings; Astra's
   check showed that would rewrite archived agreements.)
4. **Acceptance of the general terms is implicit; three things stay tick boxes.** Sign-up ends,
   as today, on the welcome step, after the email address is confirmed (an account already
   exists by then, also with Google). That step keeps one tick, "I am 18 or older". Beside its
   button: "By finishing sign-up you agree to the Terms of Service, the Payment Terms and the
   Community Rules", each a link to the exact version, and under it "Our Privacy Policy explains
   what we do with your information." The button says "Finish sign-up". For a person asked
   again after a change the sentence says "By pressing the button you agree to the updated..."
   and the button says "Accept the updated terms". Pressing is the yes. The draft Terms,
   section 1.4, say the same. The Host Agreement is a tick when applying to host. Repeating
   payments keep their ticks (already built).
5. **Every acceptance is one line, never changed while it is kept** (a new table,
   `agreement_acceptances`: person, document, version, the occasion, the moment; one line for
   each person, document and version, so a second press writes nothing). The person's own line
   keeps a short stamp of the three general documents' versions (`termsVersion`, the field that
   exists), so the gate still costs the one read it costs today. **Only the three general
   documents are in the stamp:** a new Host Agreement or privacy policy never sends everyone
   back to the welcome step. The stamp and the lines are written in one database step, with one
   moment, for a person who is verified and not closed.
6. **The form says which versions it showed, and the server refuses others.** A person who had
   the page open while a new version took effect is shown it again.
7. **One function tells the website and the phone app which documents and versions to ask
   for** (`agreementsToAccept("sign_up" | "hosting", now)`: name, title, version, address), and
   **one function writes an acceptance** for both. `TERMS_VERSION`, which the app's door
   already sends (`src/lib/app-door/start.ts`) and two dozen check scripts write onto their test
   people, stays as a name and becomes the stamp, so neither breaks.
8. **Existing hosts are asked on their Hosting page**, which shows the Host Agreement, the
   business-or-private question and, if there is one, the reason their page was declined or
   suspended, and nothing else until they accept. This is a gate on that one page: the requests
   page, the calendar and the app are not closed by it. It is enough before launch, when there
   are no real hosts. It is **not** proof that a host who never opened that page accepted a
   later version; part 3 (taking money back from a host) says what it relies on.
9. **The identity page shows the Identity Check Notice above the button**, and the button
   becomes "I agree, continue to Stripe". The consent is written down **before** Stripe is
   asked for a check, and the version of the notice is kept on each check's own line, so every
   attempt has its evidence.
10. **A host says "business" or "private person"** when applying, and can change it later. A
    host from before this change has said nothing, and the app does not make it up: her page
    shows neither until she answers on the Hosting page. The host's page and the booking pages
    say which, also for a hidden page a member can reach. It is the host's own statement;
    Connect does not check it.
11. **Declining or suspending a host page needs a reason**: the rule, and the facts in a
    sentence. It is saved and emailed in the same database step as the decision, shown on her
    Hosting page, and cleared when the page is approved or sent in again. Giving the same
    decision twice changes nothing. **Closing an account by the founder also takes a reason and
    emails it**; today a closed person is told nothing. For a host in the United Kingdom or
    Europe the Host Agreement promises 30 days' notice before a page is closed for good, with
    exceptions; the admin page says so beside the button, and the founder keeps to it by hand.
12. **A new version of a document must be in the code at least 30 days before its day**, and a
    test refuses less unless the version carries a written reason for urgency. A version whose
    day has not come is "coming": its text can be read at its own address, and the page of the
    current version says "A new version takes effect on (day)" with a link and a short summary
    of what changes. The helper emails every person it concerns, once, as soon as it sees a
    coming version. **If such an email is written less than 30 days before the day, the helper
    says so in the health report**, and the founder moves the day. A person who signs up while
    a version is coming accepts the current one, is shown the coming change on the same step,
    and gets the email at once. On the day, each person is asked at their next visit. (Part 2.)
13. **When Connect gives a refund after the host has collected, the host owes her share of it,
    and it is taken from her next earnings** after she has been told in writing and had 14 days
    to object. The same for a bank dispute lost after collection, and for a contribution or tip
    the founder refunds after collection. Nothing is ever taken from a host's bank account.
    (Part 3; its money rules get a detailed plan of their own, checked by Astra, before
    building.)
14. **A host who has not collected for 12 months is sent what is ready** by the helper, with the
    usual 25-cent charge, if her payout account can take it; she is told by email. Twelve
    months since her last collection, or, if she never collected, since her first earning became
    ready: the Host Agreement's own rule (7.7). Closed accounts are plan 45's. (Part 3.)
15. **Two years after an email was sent, only the fact that it was sent is kept**: its text, its
    subject and the address it went to are removed; its kind, its key and its times stay. An
    email that was never sent is treated the same two years after it was written. **A login
    record still there 12 months after it ran out is deleted** (most are gone much sooner: the
    login library removes them on logging out). These are the two periods of the draft privacy
    policy that do not depend on an account being closed. The others (records of money, of
    acceptances, of reports, and backups) are **not built**, for open accounts as for closed
    ones; the draft policy marks them as proposals, and plan 45, parts 19 to 19c, builds what
    happens on closing. (Part 4.)

## Part 1: the documents in the app, and proof of acceptance

Changes 1, 2, 3, 4, 8 and 10 of the list.

**The documents.** `src/legal/documents/`: `terms-of-service`, `payment-terms`,
`community-rules`, `host-agreement`, `privacy-policy`, `copyright-policy`,
`identity-check-notice`, each with its first version `2026-11-20`, marked a draft, with the
"draft" lines of `docs/legal/` taken out (the page says it instead). One copy only: the files
in `docs/legal/` go, except the map and Astra's drafts. `src/legal/registry.ts`: the list, with
for each version its day, whether it is a draft, and a short summary of what changed;
`currentVersion`, `comingVersion`, `textOf`, `agreementsToAccept`, `generalStamp`.
`src/legal/parse.ts` (written): the reader. `src/legal/legal-text.tsx`: draws what the reader
gives. Before the documents move, two things the present pages say and the drafts do not are
carried over into the privacy policy: how to disconnect Connect at Meta, and who sees a
person's photo.

**The rules.** `RULES` in `src/lib/terms.ts` keeps its nine keys (the admin's warning and pause
forms, and the pause for an age under 18, look them up by key) and gains three: professional
advice, spam and misuse, and posting only what is yours. The report form has its own list
(`REPORT_REASONS`) and is not changed. The rules page shows the Community Rules document.

**The pages.** `/terms`, `/payment-terms`, `/rules`, `/host-agreement`, `/privacy`,
`/copyright`, `/identity-notice`. Each shows the current version, its day, "Draft. Not in force
yet." where that is so, and "Earlier versions"; `?version=` shows another one, marked as not
the current one. Both footers link all seven (`src/components/site-page.tsx` and the front
page's own, `src/app/page.tsx`).

**The support address** stays one thing: `SUPPORT_EMAIL` in `src/lib/terms.ts`, which emails
answer to and a dozen pages show. The documents do not read it; a draft shows `[SUPPORT EMAIL]`
and a published version has the address written in.

**Acceptance.** New table `agreement_acceptances` (id, person, document, version, occasion:
`sign_up`, `new_version`, `host_application`, `host_new_version` or `identity_check`, moment;
one line for each person, document and version). One function, `acceptAgreements(tx, person,
occasion, shown, now)` in `src/legal/accept.ts`, used by the website's welcome step, by applying
to host, by the Hosting-page step, by the identity step, and by the app's own address when the
phone-apps session moves to it: it refuses versions that are not the ones due, writes the lines
that are missing, and for the general documents writes the stamp with them. `welcomed`
(`src/lib/session.ts`) compares the stamp with `generalStamp(now)`, as it compares a constant
today. A person who accepted under the old tick is asked again: the app has no real users.

**Hosts.** The application form gets the Host Agreement tick and the business-or-private choice
(`host_profiles.seller_kind`, empty for a host who has not said). `createHostProfile` refuses
without the tick and writes the acceptance line in the same step as the profile. `/host` shows
only the step of decision 8 to a host who has not accepted the current version or has not said
business or private. `publicProfile` and `hostForMemberByHandle` both carry the answer.
`decideProfile` takes the reason (`host_profiles.decided_reason`), both admin forms ask for it,
the email wrapper sends it in the same step. `closeAccount` takes a reason and writes the email
in its own step.

**Identity.** The notice above the button; the action that starts a check checks the notice's
version, writes the acceptance line and only then asks Stripe; `identity_checks.notice_version`
on each new check.

**One migration** (the next free number when the pull request is opened): the table, and the
columns `seller_kind`, `decided_reason`, `notice_version`, and a reason on a closed account.

**What the check scripts need.** `scripts/seed.ts` and about two dozen scripts stamp their test
people with `TERMS_VERSION`; that keeps working (decision 7). Scripts that apply to host through
`createHostProfile` (`abroad-check`, `journey-check`, and others) pass the tick, also the ones
that test another refusal, so that a missing tick cannot make them pass for the wrong reason.
Scripts that decline or suspend (`accounts-check`, `membership-check`, `contribution-check`,
`safety-check`) pass a reason. `app-door-check` expects the stamp. The admin test account goes
through the same welcome step as everyone.

**Checked by:** tests for the reader (written), for the registry (every version has a text; a
published version has no blank; the seven documents as they are read without a single problem;
the current and the coming version by day; the 30-day rule of part 2), and for the stamp. A
check script, `scripts/agreements-check.ts`: finishing sign-up writes three lines and the
stamp; pressing twice writes nothing more; a stale form is refused; a new version asks again,
keeps the old lines and writes `new_version`; applying to host without the tick is refused and
with it writes its line with the profile; the reason reaches the decision email and is cleared
on approval; the identity consent is written before Stripe is asked; each page answers with the
document's first heading and the draft line. Every check script that signs people up, applies
to host or decides about a page is run again.

## Part 2: thirty days' notice of new terms

Change 5, as decision 12 says it. Who a coming version concerns: everyone with an open account
for the three general documents and the privacy policy (the privacy policy is told, not
accepted); hosts for the Host Agreement, who accept it on their Hosting page from its day; the
Copyright Policy is part of the Terms, so a change to it that matters is announced like a change
to the Terms. Calls already booked, membership months already begun and disputes already raised
stay under the version that applied to them, as the drafts say; nothing in the code decides
anything from a document's version, so there is nothing to build for that. **Checked by:**
tests of the 30-day rule and of "coming"; the check script with a made-up coming version: one
email each and none twice; none to a closed account; a person who signs up meanwhile accepts the
current version, sees the coming one, and gets the email; the acceptance is asked only from the
day on; an email written too late shows in the health report.

## Part 3: refunds by Connect after a host has collected, and uncollected earnings

Changes 12 and 14. **A detailed plan (`plans/46-part-3-money-owed.md`) is written and checked by
Astra before this part is built.** The rules it must keep:

- The founder can refund a call's payment, in full or in part, also after the host collected.
  The customer gets the money from Connect at once. Connect's fee goes back in proportion, as
  today.
- The host's share of that refund becomes a line "the host owes Connect": which payment, why,
  how much. She gets an email with exactly that, and 14 days to object by writing to support.
- After the 14 days, and never before, the amount is taken from her next collections until it is
  paid; her earnings page shows it. A founder's button drops a debt (a goodwill refund Connect
  chooses to carry).
- The same line is written when a bank dispute is lost after collection, and when the founder
  refunds a contribution or a tip after collection (today Connect simply carries both).
- A host who never earns again still owes it; nothing is taken from her bank, and nothing is
  collected by the app in any other way.
- Earnings ready for 12 months and not collected: the helper makes a collection for her, with
  the usual charge, when her payout account is ready; otherwise it tries again later. An email
  tells her.
- Every step uses the existing money operations (one at a time for each payment, safe to run
  twice), and is checked against Stripe's test mode by a script of its own.
- **A new membership cancelled within 14 days** (the rest of change 9; Payment Terms 12.3): a
  founder's tool that ends it, lets go a month that is only held, cancels its coming calls,
  keeps the price of time used at the member price, gives the rest back to the card and stops
  renewal. Today "Cancel now" refuses once the month's money is taken, and nothing does this.

What the detailed plan must not forget (from Astra's check): a debt is written when the refund
has really gone through, not when it is started, and for the change in the host's share as it
was first split, to the cent; a contribution refunded after collection is booked today wholly
as Connect's cost, and a tip's payment fee sits on top of the tip; a dispute's "open" mark is
the same for a bank's question, an open dispute and a lost one, so the debt needs the real lost
amount and the dispute's own number, once, however often Stripe repeats the message, and a
disputed membership month can pay for several calls; the 14 days run from the notice really
sent, and an objection in time stops the taking until the founder decides; what is taken from a
collection is set aside under the lock collections already use and settled or given back with
each transfer's outcome, also when the debt eats the whole collection; the admin page hides the
refund form after a transfer and lists only the latest 200 payments; a collection started by
the helper needs a "started by" that is not a person.

## Part 4: end dates for emails and login records

Change 7, as decision 15 says it. Two jobs for the helper, about once a day. An email that is
still waiting to be sent, or being sent, is never touched. The clean-up of refund texts after
one year finds its emails by their key, which stays. The draft privacy policy's lines for emails
and login records get the real numbers; its other periods stay marked as proposals that are not
built. **Checked by:** tests of the rules, and a check that makes old lines and sees them
emptied or gone, and young ones and waiting ones left alone.

## Part 5: a yearly statement a host can download

Not one of the 14 changes. The founder asked on 20 November 2026, after the research on tax
forms (`docs/research/tax-forms-for-hosts.md`): "we can build an automated system according to
these laws to give these 1099 as a downloadable form, like uber/lyft/airbnb right?"

**What is built:** on her earnings page a host chooses a calendar year and gets a statement of
it, as a page made for printing and as a file for a spreadsheet: for each month and for the
year, what customers paid for her calls, memberships, contributions and tips; what was given
back; Connect's fees; the collection charges; and what was sent to her. It is made from the
books the app already keeps (`ledger_entries`, `payments`, `collection_items`), in US dollars,
by the dates the money was taken and sent. It says at the top that it is a summary for her own
records and not a tax form. It is there for every host, in every country, whatever she earned.

**What is not built:** the official yearly form (1099-K) and its filing. Uber, Lyft and Airbnb
collect each person's tax number, add up the year, and in January offer the form for download
and file it. Stripe does exactly that for platforms: it asks hosts for their tax details, makes
the forms, files them with the tax office and the states, and gives each host her form as a
download on Stripe's own page. Doing it without Stripe would mean keeping hosts' social
security numbers and filing with every tax office ourselves. So: when the company's Stripe
account has that tool switched on, the earnings page gets a link "Your tax forms" to Stripe's
page; until then the link is not shown. The founder's switch for it is a setting.

**Checked by:** tests of the sums (a year with a refund, a partly refunded payment, a dispute, a
tip, an expired membership month, a collection with its charge; the months add up to the year,
and the year to the books); the check script reads the page and the file for a host with known
payments.

## Not built here, and why

- **Closing your own account, and what is wiped (change 6):** plan 45, parts 19 to 19c.
- **Tax details from hosts (change 11):** no code, and **an open point for launch**, not a
  finished one: this repository only opens payout accounts at Stripe and proves nothing about
  tax forms. What the tax offices' and Stripe's pages say is written up in
  `docs/research/tax-forms-for-hosts.md` (20 November 2026): in the United States a yearly form
  for hosts above $20,000 and 200 payments, filed by the platform, which Stripe's tool can do
  from the company's own Stripe account; in the European Union a yearly report on every host
  from the first euro, for which the company has to register in one EU country.
- **Real addresses (change 4):** they are settings (decision 3). Someone has to read the inbox.
- **A way for people without an account to send a notice:** the Copyright Policy gives an email
  address. A public form is not built.
- **Closing every host path to a host who has not accepted the Host Agreement** (decision 8),
  and **end dates for records of money, acceptances and reports** (decision 15).

## Working beside the phone-apps session

Agreed with that session on 20 November 2026 (it builds plan 45):

- It holds migration `0048`, and one more will come with its part 06. This plan takes the next
  free number when its pull request is opened; whoever merges second renumbers.
- Its part 03 moves the welcome step into `src/lib/welcome.ts`, shared by the website and the
  app. Whoever merges second adapts: if that file exists when part 1 is built, part 1's change
  is made inside it.
- The app must ask for the same documents and versions: decision 7 is for that.
- Parts 19 to 19c stay with it.
- It is told when each part of this plan merges: what changed, which files, and what the app
  must show and send.

## What stays with the founder

A company; the blanks; a lawyer's reading of every document; the nine choices of
`docs/legal/README.md`, section 8; Stripe's tax products on the company's account; an inbox
that is read.

## What Astra's check changed (20 November 2026)

"Not ready." Kept from the first draft: the registry of versions, the history table with a
stamp on the person's line, documents as code files, the separate money plan. Changed:

- **Blanks as settings would have rewritten archived agreements**, and filling the last one
  would have turned a draft acceptance into seeming proof of terms in force. Now a published
  version is frozen and has no blanks, and the first version is a draft (decision 3).
- **The words beside the button did not fit the moment**: an account exists before the welcome
  step. Now "By finishing sign-up...", and other words for a person asked again (decision 4).
- **The stamp covers the three general documents only**, with one moment and one database step
  (decision 5). **The phone app's door keeps its `TERMS_VERSION`**, and one function writes an
  acceptance for both (decision 7).
- **A host from before is not given a "private person" she never said** (decision 10).
- **Identity consent is written before Stripe is asked, and kept for each attempt**
  (decision 9).
- **The reason for a decision** goes through both admin forms and the email in one step, is
  cleared on approval, and closing an account gets one too (decision 11).
- **The 30 days cannot be proven by two dates in the code.** Now a coming version is readable,
  announced on the page, emailed as soon as seen, and a late email shows in the health report;
  a person signing up meanwhile is covered (decision 12).
- **The 14-day cancellation of a new membership had no owner**: it is in part 3.
- **The 12 months** follow the Host Agreement's own rule (decision 14).
- **What survives an emptied email** is said exactly (decision 15), and the periods that are
  not built are named as not built.
- The plan now names the rules list's keys, the second footer, the paragraphs of today's
  privacy page that the draft lacked, and what two dozen check scripts need.

Not taken: nothing was refused. One thing is deliberately left small, as Astra agreed: the
Hosting-page gate stays a gate on one page.
