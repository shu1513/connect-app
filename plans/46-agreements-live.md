# Plan 46: The agreements go live

**Status:** a plan. Written 20 November 2026 by the builder alone (no helper agents), from the
code as it is on `main` after pull request 80. To be checked by Astra before anything is built.

**Its size, said plainly:** four parts. Part 1 is a module of its own (the documents in the app,
and proof of who accepted what). Part 2 is small. Part 3 is money and gets a detailed plan of its
own before it is built. Part 4 is small.

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
in, and a lawyer. Until every blank is filled, every legal page says "Draft, not in force yet".

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
3. **The blanks are settings, not text.** Company name, addresses, state and so on are read
   from the server's settings (`src/legal/settings.ts`), each with its `[BLANK]` as the value
   when unset. While any required blank is unset, every legal page carries a line at the top:
   "Draft. Not in force yet." The founder fills them in without touching the documents.
4. **Acceptance of the general terms is implicit; three things stay tick boxes.** The welcome
   step keeps one tick, "I am 18 or older". Beside its button: "By creating your account you
   agree to the Terms of Service, the Payment Terms and the Community Rules", each a link, and
   under it "Our Privacy Policy explains what we do with your information." Pressing the button
   is the yes. The Host Agreement is a tick when applying to host. Repeating payments keep their
   ticks (already built).
5. **Every acceptance is one line that is never changed** (a new table,
   `agreement_acceptances`: person, document, version, the occasion, the moment). The person's
   own line keeps a short stamp of the versions they hold, so the gate still costs one read.
6. **The form says which versions it showed, and the server refuses others.** A person who had
   the page open while a new version took effect is shown it again.
7. **One function tells the website and the phone app which documents and versions to ask
   for** (`agreementsToAccept("sign_up" | "hosting")`), so the two can never ask for different
   things.
8. **Existing hosts are asked for the Host Agreement on their Hosting page**, which shows
   nothing else until they accept. This is a gate on the page only; there are no real hosts
   yet, so no money path is changed for it.
9. **The identity page shows the Identity Check Notice above the button**, the button becomes
   "I agree, continue to Stripe", and pressing it writes an acceptance line.
10. **A host says "business" or "private person" when applying** and can change it later. The
    host's page and the two booking pages say which. It is the host's own statement; Connect
    does not check it. A host from before this change counts as a private person until she
    says otherwise.
11. **Declining or suspending a host page needs a reason**: the rule, and a sentence. It is
    stored, put in the email, and shown on her Hosting page.
12. **A new version of a document must be in the code at least 30 days before it takes
    effect.** A test refuses a shorter time unless the version carries a written reason for
    urgency. From the day it is merged, the helper emails every person it concerns, once: what
    changes (a short summary kept with the version), from when, and a link to read it. After
    the day, they are asked to accept at their next login. (Part 2.)
13. **When Connect gives a refund after the host has collected, the host owes her share of it,
    and it is taken from her next earnings** after she has been told in writing and had 14 days
    to object. The same for a bank dispute lost after collection, and for a contribution or tip
    the founder refunds after collection. Nothing is ever taken from a host's bank account.
    (Part 3; its money rules get a detailed plan of their own, checked by Astra, before
    building.)
14. **Earnings a host has not collected for 12 months are sent to her by the helper**, with the
    usual 25-cent charge, if her payout account can take them; she is told by email. (Part 3.)
15. **Emails are emptied two years after they were sent** (that it was sent, to whom and about
    what stays), **and login records are deleted 12 months after they ran out.** These are the
    two periods of the draft privacy policy that do not depend on an account being closed; the
    others are built with plan 45, parts 19 to 19c. (Part 4.)

## Part 1: the documents in the app, and proof of acceptance

Changes 1, 2, 3, 4, 8 and 10 of the list.

**The documents.** `src/legal/documents/`: `terms-of-service`, `payment-terms`,
`community-rules`, `host-agreement`, `privacy-policy`, `copyright-policy`,
`identity-check-notice`, each with its first version `2026-11-20` and the banner lines of the
drafts taken out. `src/legal/registry.ts`: the list, `currentVersion(name, now)`,
`textOf(name, version)`, `agreementsToAccept(occasion)`, `stampOf(occasion, now)`.
`src/legal/settings.ts`: the blanks. `src/legal/render.tsx`: the reader (headings, paragraphs,
bold, links inside the site and outside, lists with one level of nesting, tables, quotes, a
line). The nine rules of `src/lib/terms.ts` become the twelve of the Community Rules; the
report form and the warning email keep working from `RULES` (the keys stay, three are added).

**The pages.** `/terms`, `/payment-terms`, `/rules`, `/host-agreement`, `/privacy`,
`/copyright`, `/identity-notice`. Each shows the current version, its date, and "Earlier
versions"; `?version=` shows an older one, marked as no longer current. The footer links all
seven. The true paragraphs of today's privacy page are already in the draft policy.

**Acceptance.** New table `agreement_acceptances` (id, person, document, version, occasion:
`sign_up`, `new_version`, `host_application` or `identity_check`, moment; one line for each
person, document and version). `finishSignUp` writes one line for each of the three documents
and the stamp on the person's line, in one database step; it refuses when the versions the form
carries are not the current ones. `welcomed` compares the stamp with `stampOf("sign_up", now)`.
A person who accepted under the old single tick is asked again (the stamp differs): the app has
no real users.

**Hosts.** The application form gets the Host Agreement tick and the business or private
choice (`host_profiles.seller_kind`). `createHostProfile` refuses without the tick and writes
the acceptance line with the profile. `/host` shows only the acceptance step to a host who has
not accepted the current version. `decideProfile` takes a reason for "declined" and
"suspended" (`host_profiles.decided_reason`); the admin page asks for it; the email and the
Hosting page show it.

**Identity.** The notice above the button, the button's new words, and the acceptance line
written by the action that starts the check.

**One migration** (`0049`, or the next free number): the table and the two columns.

**Checked by:** tests for the reader (every mark used in the seven documents; a document with a
mark the reader does not know fails a test), for the registry (no version without a text, the
current version by date, the 30-day rule of part 2), and for the stamp. A check script,
`scripts/agreements-check.ts`: signing up writes three lines and the stamp; a stale form is
refused; a new version asks again and keeps the old lines; applying to host without the tick is
refused; the reason reaches the email; each page answers with the document's first heading; the
draft line is there while a blank is unset and gone when all are set. `journey-check`,
`accounts-check` and `safety-check` are run again, since they sign people up.

## Part 2: thirty days' notice of new terms

Change 5. Built on part 1's registry: a version whose day has not come is "coming". The helper,
once an hour, writes one email for each person a coming version concerns (everyone for the three
sign-up documents and the privacy policy; hosts for the Host Agreement), with a key so it is
written once. The welcome step for a returning person shows the same summary. A test keeps the
30 days. **Checked by:** tests, and the check script with a made-up coming version: one email
each, none twice, none to a closed account, and the acceptance asked only from the day on.

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

## Part 4: end dates for emails and login records

Change 7. Two jobs for the helper, about once a day: the text of an email is emptied two years
after it was sent (the line stays); a login record is deleted 12 months after it ran out. The
draft privacy policy's two `[PERIOD]` blanks for these become the real numbers. **Checked by:**
tests of the rules, and a check that makes old lines and sees them emptied or gone and young
ones left alone.

## Not built here, and why

- **Closing your own account, and what is wiped (change 6):** plan 45, parts 19 to 19c.
- **Tax details from hosts (change 11):** no code. In the United States, when the platform sets
  the terms of payment, the platform files the yearly forms; Stripe's "tax reporting for Connect
  platforms" collects the hosts' details and files them from the Stripe dashboard. For the
  European Union and the United Kingdom, Stripe's "Platform Tax Reporting" does the same and was
  in private preview when this was written. Both belong to the company's own Stripe account.
  (Read on Stripe's pages, 20 November 2026: docs.stripe.com/connect/tax-reporting and
  docs.stripe.com/connect/platform-tax-reporting.) With the accountant.
- **Real addresses (change 4):** they are settings (decision 3). Someone has to read the inbox.
- **A way for people without an account to send a notice:** the Copyright Policy gives an email
  address. A public form is not built.

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
