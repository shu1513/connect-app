# Plan 46: The agreements go live

**Status:** a plan. Written 20 November 2026 by the builder alone (no helper agents), from the
code as it is on `main` after pull requests 80 and 81. Astra (gpt-6.2-astra) checked it twice
against the code, "not ready" both times; the second list was short and exact. Every point of
both is worked in, or answered, in the two sections at the end.

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
   still holds a blank. **No version is edited once it is merged, a draft included**: a
   correction is a new version. (The first draft of this plan read the blanks from settings;
   Astra's check showed that would rewrite archived agreements.) A link from one document to
   another leads, in an earlier version, to the other document as it stood then.
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
8. **Existing hosts are asked on their Hosting page, in a box at its top, and are not locked
   out.** The box shows the Host Agreement's link, the tick, and the business-or-private
   question, until both are answered. A new host cannot apply without them. Why a box and not a
   lock: the Host Agreement itself says a new version applies to a host who keeps hosting after
   being told and asked (19.2), a lock on one page would not close the other host pages or the
   app anyway, and every check script makes its hosts directly. What part 3 relies on before it
   takes money back from a host is said there.
9. **The identity page shows the Identity Check Notice above the button**, and the button
   becomes "I agree, continue to Stripe". The consent is written down **before** Stripe is
   asked for a check (the line in the acceptance table: the first time this person agreed to
   this version). Every check, also a second or third one, gets the notice's version written
   on its own line before the person is sent to Stripe's pages. Asking Stripe for a check
   collects nothing; the pictures are taken on Stripe's pages, after that line exists.
10. **A host says "business" or "private person"** when applying, and can change it later. A
    host from before this change has said nothing, and the app does not make it up: her page
    shows neither until she answers on the Hosting page. The host's page and the booking pages
    say which, also for a hidden page a member can reach. It is the host's own statement;
    Connect does not check it.
11. **Declining or suspending a host page needs a reason**: the rule, and the facts in a
    sentence. It is saved and emailed in the same database step as the decision, shown on her
    Hosting page, and cleared when the page is approved or sent in again. Giving the same
    decision twice changes nothing: the first reason and its moment stay. There are five places
    that take one: decline and suspend on the admin's People page, suspend on the Reports page,
    and close on both. **Closing an account by the founder also takes a reason and
    emails it**, in the closing's own database step, straight to the person's address; today a
    closed person is told nothing. For a host in the United Kingdom or
    Europe the Host Agreement promises 30 days' notice before a page is closed for good, with
    exceptions; the admin page says so beside the button, and the founder keeps to it by hand.
12. **A new version of a document must be in the code at least 30 days before its day**, and a
    test refuses less unless the version carries a written reason for urgency. **The one
    exception is the first published version after a draft:** the 30 days are owed to people who
    hold terms in force, and a draft is not in force. It is the version the site opens with. A version whose
    day has not come is "coming": its text can be read at its own address, and the page of the
    current version says "A new version takes effect on (day)" with a link and a short summary
    of what changes. The helper emails every person it concerns, once, as soon as it sees a
    coming version. **If such an email went out less than 30 days before the day, or is still
    not sent, or failed, the helper says so in the health report**, and the founder moves the
    day; the email's key holds the day, so a moved day is announced again by itself. A person who signs up while
    a version is coming accepts the current one, is shown the coming change on the same step,
    and gets the email at once; so does a new host for a coming Host Agreement. Their shorter
    time does not move the day for everyone. On the day, each person is asked at their next visit. (Part 2.)
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
    Also removed: the extra headers (they can hold a link that still works), the note of an
    error, and the sending service's own number. Whether it was sent or failed stays. An email
    that was never sent is treated the same two years after it was written. **A login
    record still there 12 months after it ran out is deleted** (most are gone much sooner: the
    login library removes them on logging out). These are the two periods of the draft privacy
    policy that do not depend on an account being closed. The others (records of money, of
    acceptances, of reports, of identity-check results, and backups) are **not built**, for open accounts as for closed
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
without the tick and writes the acceptance line in the same step as the profile.
`publicProfile` and `hostForMemberByHandle` both carry the answer.
`decideProfile` takes the reason (`host_profiles.decided_reason`), both admin forms ask for it,
the email wrapper sends it in the same step. `closeAccount` takes a reason and writes the email
in its own step. `/host` shows the box of decision 8.

**Identity.** The notice above the button; the action that starts a check checks the notice's
version, writes the acceptance line and only then asks Stripe; `identity_checks.notice_version`
on each new check.

**One migration** (the next free number when the pull request is opened): the table, and the
columns `seller_kind`, `decided_reason`, `notice_version`, and a reason on a closed account.

**What the check scripts need.** `scripts/seed.ts` and about two dozen scripts stamp their test
people with `TERMS_VERSION`; that keeps working (decision 7): the gate reads the stamp, and a
test person needs no proof. The seed goes on stamping its four people, the admin among them. Scripts that apply to host through
`createHostProfile` (`abroad-check`, `journey-check`, and others) pass the tick, also the ones
that test another refusal, so that a missing tick cannot make them pass for the wrong reason.
Scripts that decline or suspend (`accounts-check`, `membership-check`, `contribution-check`,
`safety-check`) pass a reason, and so do the ones that close an account. `app-door-check`
expects the stamp.

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
- **What the taking relies on:** the host accepted a published Host Agreement, with its section
  9, before the call or payment the debt comes from (her line in `agreement_acceptances`). For
  a debt from before that, the app writes the debt down and takes nothing by itself; the
  founder settles it.
- A host who has not collected for 12 months (decision 14: since her last collection that went
  through, or since her first earning became ready) is sent **everything** that is ready, with
  the usual charge, when her payout account is ready; otherwise it is tried again later. A try
  that was refused does not start the year again. An email tells her what went through.
- The sentence before joining a membership says time "booked or used" in the first 14 days is
  paid for; the Payment Terms say time used. The sentence is corrected with this part.
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

**What is built:** on her Hosting page a host chooses a calendar year and gets a statement of
it, as a page made for printing and as a file for a spreadsheet, month by month and for the
year. It is made from the books the app already keeps, with no new table, in US dollars, and
by the day each line was written into the books, counted in UTC; the page says so, because the
app writes a charge down when it learns of it, which can be a little after the bank moved the
money, and because the day a bank pays a host is not known to the app at all. It says at the
top that it is a summary for her own records and not a tax form. Every host has the link,
whatever she earned and whether or not her payout account is set up. What it adds up:

- **Paid by customers:** every "charged to the customer" line of the books, once, found through
  the call, the membership month or the contribution it belongs to. (The lines for a member's
  calls and for expired time share out money already counted; they are not added again.)
- **Given back (recorded refunds):** every refund line, in the month the refund went through. A
  payment of December given back in January is in two different years.
- **Connect's fees:** the fee lines, with their signs, so a fee returned with a refund is taken
  off again. A tip's payment fee is shown apart, as paid by the customer on top of the tip.
- **Sent to you:** the transfers that went through, and the collection charges really taken. A
  transfer that was refused, or tried twice, counts once, as what really went.
- **Not in it:** money a bank took back in a dispute. The books do not hold a dated amount for
  that until part 3 writes one; until then the page says that disputes are not included.

**What is not built:** the official yearly form (1099-K) and its filing. Uber, Lyft and Airbnb
collect each person's tax number, add up the year, and in January offer the form for download
and file it. Stripe does exactly that for platforms: it asks hosts for their tax details, makes
the forms, files them with the tax office and the states, and gives each host her form as a
download on Stripe's own page. Doing it without Stripe would mean keeping hosts' social
security numbers and filing with every tax office ourselves. So the official form comes from Stripe's tool, switched on in the company's Stripe account. A
link to it from the Hosting page is added when that page of Stripe's exists for Connect and can
be checked; nothing is built for it now.

**Checked by:** tests of the sums (a refund in the next year; a partly refunded payment; an
open dispute, which moves nothing; a tip with its fee; an expired membership month; a
collection that went through in part and its second try; midnight at New Year; the months add
up to the year); the check script reads the page and the file for a host with known payments.

## Not built here, and why

- **Closing your own account, and what is wiped (change 6):** plan 45, parts 19 to 19c.
- **Tax details from hosts (change 11):** no code, and **an open point for launch**, not a
  finished one: this repository only opens payout accounts at Stripe and proves nothing about
  tax forms. What the tax offices' and Stripe's pages say is written up in
  `docs/research/tax-forms-for-hosts.md` (20 November 2026): in the United States a yearly form
  for hosts above $20,000 and 200 payments, filed by the platform, which Stripe's tool can do
  from the company's own Stripe account; in the European Union a yearly report on every host
  from the first euro, for which the company has to register in one EU country.
- **Real addresses (change 4):** the support address is a setting that exists
  (`SUPPORT_EMAIL`); the others are written into the first published version of each document.
  Someone has to read the inbox.
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
- The app must ask for the same documents and versions: decision 7 is for that. What its
  welcome step has to do once part 1 is merged: ask the server which documents and versions to
  show (`agreementsToAccept("sign_up", now)`, with the address of each exact version); show the
  one tick for 18 or older and the sentence with those links; send back the versions it showed;
  and show the step again when the server answers that they are no longer the current ones.
  The server writes nothing for a request that names no versions.
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

## What Astra's second check changed (20 November 2026)

"Not ready", for three ways an acceptance could be written down without proof of what the
person saw, and for sums in part 5. Worked in:

- **No version is edited once merged, drafts included** (decision 3), and a link inside an
  earlier version leads to the other document as it stood then.
- **The stamp is asked for at the moment it is needed** (`generalStamp(now)`: the gate, the
  welcome step, the app's door), never kept from the moment the server started; the old name
  stays only for check scripts.
- **The phone app's welcome step** is said exactly (in "Working beside the phone-apps
  session"); a request that names no versions writes nothing.
- **Identity consent for every attempt** (decision 9): the notice's version on each check's own
  line, before the person reaches Stripe's pages.
- **Five places take a reason**, the first reason stays when a decision is repeated, and the
  email of a closing is written in the closing's own step (decision 11).
- **The first published version is the one exception to the 30 days**, said plainly; lateness is
  judged by emails really sent; a moved day is announced again; new hosts are covered
  (decision 12).
- **Part 3:** the 12 months as decision 14 has them; what the taking of a debt relies on; the
  membership sentence about "booked or used".
- **Part 4:** headers, error notes and the sending service's number are removed too.
- **Part 5:** what each sum is made of, the days it goes by, and that disputes are not in it.
- The draft agreements' own words about when acceptance happens are corrected as they move
  (Terms 1.4, Host Agreement 1.2, the map).

Answered differently from what was suggested, on purpose:

- *A lock on the Hosting page for existing hosts* became a box that does not lock (decision 8),
  for the reasons given there.
- *Proof lines for every test person in every check script*: not done. The gate reads the stamp;
  a test person needs no proof, and two dozen scripts stay as they are.
- *Reserving a check's line before asking Stripe*: not done. Asking Stripe for a check collects
  nothing, and the line with the notice's version exists before the person is sent to Stripe's
  pages, where the pictures are taken.

The plan was not sent a third time. Each part's code goes to Astra, as always.

## What building part 1 added (20 November 2026)

- The phone-apps work merged its part 03 first, with the welcome step in `src/lib/welcome.ts`.
  As agreed, this part adapted: `finishSigningUp` takes the versions shown instead of a "yes"
  to the terms and answers "changed" when they are not the ones in effect; the app's address
  (`src/app/api/app/welcome/route.ts`) gives the documents with GET and takes
  `agreements: [{ name, version }]` with POST; the app's screen and its checks were changed in
  the same pull request.
- Closing an account can name "at the person's own request" instead of a rule.
- `closeAccount` in the code can still be called without a reason (check scripts do); the two
  buttons of the founder always give one.
- The check scripts that log in as the seeded test people need those people stamped for the new
  step: `npm run seed` does it. Until every open branch has this part, a seeded person fits
  either the old step or the new one, not both.

## What building part 2 added (20 November 2026)

- **Who is told:** everyone with an open account who has finished signing up at least once, for
  the Terms, the Payment Terms, the Community Rules, the Privacy Policy and the Copyright Policy;
  everyone with a host profile, for the Host Agreement. Nobody for the Identity Check Notice: it
  is shown in full, in the version in effect, at every check. A paused account is told; a closed
  one is not. (`src/legal/notices.ts`.)
- **One email for each document that changes**, not one for all of them: the key is document,
  version, day and person, as decision 12 says. Three documents changing on one day are three
  emails.
- **An email is not sent after its day**, not to an account closed since it was written, and not
  for a day that has been moved since.
- **Changed against decision 12: the warning is not in the health report.** That address is
  watched for money, turns "not healthy" for any line, and would stay so until the day. When the
  30 days are at risk the founder is written an email, once for each problem, and the founder's
  Emails page shows for every announced version how many emails went out in time, later, or not
  at all. Counted: only versions the 30 days are owed for (not the first published one after a
  draft, not one marked urgent with a reason), and only people who were concerned before the last
  day for it. Four cases: an email that went out with fewer than 30 days left; one still not out
  with fewer than 30 days left; one that failed for a reason of ours (a bounced address or an
  account closed in between is not one); a day moved back to one that was announced before.
- **The Hosting page** says a coming Host Agreement the way the documents' own pages do, and its
  box's words follow what is missing.

## What Astra's review of part 2 changed (20 November 2026)

Astra read the first build and said to hold it. Taken:

- **Every future version is announced, not only the next one of a document.** A second change
  planned behind the first would have had almost no notice. Two versions of one document can no
  longer take effect on the same day, and "urgent" has to give a reason.
- **Someone who finishes signing up, or applies to host, while a version is coming is written to
  in that same database step.** Before, the helper found them within a minute, and not at all in
  the last minute before the day.
- **The helper's round of notices no longer waits behind other work**, and is timed by the clock:
  a failure elsewhere in the helper cannot hold it up.
- **A helper still running older code during a release could give a good email up for ever.** The
  next round takes such an email up again.
- **The founder can have refused emails sent again** (a button on the Emails page). Only emails
  the sending service refused outright: those certainly did not go out.
- **Both coming notes are shown before a person agrees:** a coming Host Agreement beside the form
  that applies to host, and a coming Privacy Policy or Copyright Policy on the last step of
  sign-up.
- **The email's words:** the hour (00:00 UTC); a link to the version held today by its own name,
  so it still shows that text afterwards; for hosts, that they can end hosting by closing the host
  page and that booked calls and begun membership months are not touched (Host Agreement 19.2);
  for the Terms, the way to reject a change to how disputes are settled (20.10).
- An email whose time ran out is asked about once more right before it is handed to the sending
  service.
- The check script's checks each prove what their label says (the exact moment an email runs
  out, a closed account apart from a refusal, two helpers at once, a backlog over several rounds).

**Astra's second review** (of that rework) said to hold it once more, for three ways an email
could have gone out twice or a warning could have been wrong. Taken:

- An email taken up again keeps its count of tries and the moment of its first try. So if the
  sending service was asked before and its answer was lost, the sending's own rule decides (a
  try older than a day is never repeated blindly), and the email waits for a person.
- The founder's button sends again only an email that was asked **once** and refused outright;
  not one tried several times, and not one whose answer says an earlier request is still under
  way. It is one statement, so nothing can change between looking and writing.
- "People were last told another day" is judged by what was really sent, in the order it was
  sent, for every coming version and everyone concerned. A day written about and never sent
  does not count.
- The notices have a loop of their own in the helper, beside the money work, not in front of it.
- Applying to host reads the clock with the person's line locked, like finishing sign-up.
- The email calls the version it links "the version in effect today" (with two changes planned,
  "until then" would have been wrong for the second).
- The founder's page counts by what the emails' own keys say, so a day that was announced and
  then moved keeps its line.
- Both pages show every coming version, and the last step of sign-up shows them above the
  button.
- The check script: an email whose time runs out while emails are being sent; an email given up
  by an old helper whose earlier try may have gone through; the health address asked while a
  problem is open.

Not taken:
- *Keep the sending service's own times for each email.* The app records when the service
  accepted an email. If that answer is lost and a second try succeeds later, the later time is
  kept, which can only make a notice look later than it was, never earlier.
- *A record of who was never told, kept after the day.* The Emails page counts the emails of a
  version for about a year; a person with no email at all is only counted while the version is
  coming.
- *A day moved back to one already sent sends a correction by itself.* It is said to the founder,
  who chooses a day that was not announced before; that day is then announced to everyone.
- *The last look before sending cannot be made in the same instant as the sending.* It is made
  twice, the second time as the last thing before the service is asked.
- **Not built:** the phone app's last step of sign-up does not show a coming version (the email
  and the website do). The phone-apps session is told.

