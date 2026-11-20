# For the lawyer

Every point in the Connect app that a lawyer should look at, in one place.

**How this file is kept.** It was put together on 19 November 2026 from the plans (`plans/`) and
the record of what was built (`docs/module-record.md`). Each point names where it comes from, so
the full background can be read there. Whenever a plan raises a new point for a lawyer, it is
added here in the same change. Nothing here is legal advice: these are the questions, written by
the builder, not the answers.

**Where the app stands.** Connect is not live. A customer books a private, paid, one-to-one video
call with a host. Hosts can be based in 33 countries (the United States, the United Kingdom and
most of the European Union among them); customers can be anywhere. There is no registered
company yet.

## 1. The three documents every user agrees to

- **First drafts now exist** (20 November 2026): the builder's drafts of the Terms of Service,
  the Payment Terms, the Community Rules, the Host Agreement, the Privacy Policy, a copyright
  and complaints policy and an identity-check notice. Since plan 46 they are shown on the site
  itself, each marked "Draft. Not in force yet." (the texts are in `src/legal/documents/`);
  Astra's own set is in `docs/legal/astra-drafts.md`. `docs/legal/README.md` lists the blanks,
  the choices made and the points where the two drafts differ. Every one of them needs a
  lawyer's reading, and a reviewed version with the blanks filled in is added as a new,
  published version; the drafts themselves are never edited.

- **The terms, the privacy page and the rules page are placeholders.** A lawyer has to write the
  terms and the privacy page and review the rules. (Plans 3, 5, 11.)
- **The two boxes at sign-up:** "I am 18 or older" and "I accept the terms". No date of birth is
  asked. Is that enough? (Plan 3.)

## 2. Money

- **The wording a customer agrees to when saving a card.** It covers placing a hold later,
  keeping the card until the call is over, and using it when the customer asks for more time
  during a call. Stripe requires clear consent. (Plans 4, 9.)
- **When money is taken, and refunds.** The terms must say: the charge for a call is taken one
  to two days after it; a customer can ask for a refund within 24 hours of the call; the host
  decides; a host cannot collect the money for a call with a refund request they have not
  answered. The waiting, cancelling and refund wording needs a look, especially for customers
  outside the United States. (Plans 2, 13.)
- **Hosts' money that nobody collects.** The founder decided not to send it automatically. How
  long may Connect hold money that hosts have earned? (Plan 14.)
- **How and when hosts collect their earnings** must be in the terms. (Module 12 in the record.)
- **Memberships** (a customer pays a host every month for talk time): monthly charges that renew
  by themselves (the wording before joining, the agreement, cancelling, the reminder), and paid
  time that expires. Some places treat prepaid value like a gift card, with their own rules on
  expiry. "Cancel now" and normal cancelling are worded apart and need reading. Memberships are
  on for every host from the first day, so this has to be settled before launch. (Plans 19, 20.)
- **Contributions to a host's project** (once or monthly, with no promised reward): the wording
  (never "donate"); the monthly agreement, and whether a yearly reminder is needed; that the email
  at the hold cannot always come three days before the money is taken, because a bank can shorten
  a hold. (Plans 23, 25.)
- **Tips after a call** (new, plan 44). A customer can give the host a tip after a call, from $2,
  paid by card, held for three days and then taken. The host gets the whole tip and Connect keeps
  nothing of it. What the card payment costs (2.9% plus 30 cents) is added on top for the
  customer as a "payment fee": a $5 tip costs $5.46. The total is shown before they pay.
  - **The added payment fee.** In the United Kingdom and the European Union a business may not
    add a charge for paying by card, also not under another name; in the United States card rules
    do not allow one on debit cards, and some states have rules of their own. A fee that every
    payment carries, whatever it is paid with, is not such a charge, and Connect takes cards only.
    Is that enough? Must the fee be named or shown differently, or must Connect pay it itself for
    customers in some countries?
  - In some places the law says a tip must reach the worker in full (for example the United
    Kingdom's law on tips of 2023, and rules for employees in several US states). Hosts are not
    Connect's employees, and Connect keeps nothing of a tip. But the 25-cent charge when a host
    collects her earnings can fall on a collection that holds only a tip. Is that allowed?
  - Is the wording right: a tip is a thank-you for a call that took place, it buys nothing, and it
    is not a donation to a charity?
  - What is a tip for tax: the host's income like a call's price? Does sales tax or VAT apply to
    it in any of the 33 countries a host can be in?
  - Refunds of a tip are the host's decision once the money is taken. Is that allowed for
    customers outside the United States?
- **Money when someone deletes their own account** (new, plan 39; not built). A customer who
  deletes their account with a call booked would be treated as cancelling it themselves, so a
  late cancellation would be charged as usual. A host who deletes theirs would still be paid
  what they have earned. Is that allowed, and what must the person be told before they confirm?
  Plan 45 (parts 19 and 19b; not built) adds: the cost of each cancelled call is fixed at the
  moment the person confirms; a deleted host's earnings are sent to her payout account by
  Connect, without the usual 25-cent charge; money that cannot be sent (no working payout
  account, an open dispute) stays owed, with a reference she can claim it by. How long may
  such money be kept, and what must she be told?

## 3. Safety and children

- **A report about a child.** What the law requires Connect to do, and how. In the United States
  there is a duty to report to the national centre (NCMEC) and to keep the evidence. Connect needs
  a way to file such reports before diary pictures go live, and the exact steps for the founder's
  page. (Plans 5, 23, 24.)
- **Pictures in a host's diary.** A picture a checking service flags is refused and deleted by
  the app alone, with nobody at Connect deciding about it. A picture shown after a check for
  nudity only may have been seen before its full check flagged it. A refused picture's file can be
  kept, unseen, until the child-safety tool has looked at it. Is each of these right? (Plan 23.)
- **Pictures sent to checking companies** (OpenAI, Microsoft, Sightengine): what the terms and the
  privacy page must say. (Plan 23.)
- **Intimate pictures shared without consent** (the US "Take It Down Act", removal within 48
  hours): does it apply to the diary, and to Connect as a whole? (Plan 23; messaging research.)
- **Someone under 13 or under 18.** Connect is not for children. What must happen when a report
  says a user is a child, and is age checking needed for customers? (Messaging research.)
- **How long reports and identity-check results are kept, and how to answer the police.**
  (Plan 5.)
- **What the site may promise about urgent reports:** only what Connect can really do. (Plan 5.)

## 4. What Connect keeps about people

- **Connection grades.** A grade of each person's connection is kept for 60 days for every call.
  With any refund request, a summary of those grades, the customer's sentence and the host's
  message are kept for a year. Connect sees that summary for every request; the two people only
  when the reason is the connection. The privacy page must say so. (Plan 13.)
- **A host's private notes about a customer.** In the UK and the EU a person can ask a company
  what it holds about them. Are these notes covered, and what should the rules tell hosts about
  writing them? (Plans 8, 32.)
- **A copy of a host's profile picture** from Instagram or TikTok, kept at the host's request.
  Meta's and TikTok's terms should be read with that use in mind. (Plans 29, 33.)
- **Suggested hosts** (new, plan 37). To choose which hosts to suggest, the app uses who follows
  whom (a call that took place makes the customer follow the host by itself, so this includes
  most people who called). It records which hosts each person was suggested, which of those
  cards they saw, and whether they opened that host's page from the card (plan 41; it decides
  whether a suggestion comes back or rests), for 90 days; and which suggestions they hid, for as
  long as the account exists. Is using this information for suggestions allowed as it is (in the EU and the UK: on
  which legal ground), what must the privacy page say, and must a person be able to switch
  personal suggestions off?
- **What a suggestion could give away** (plan 37). A host gets points from this only when at
  least three different people who follow one of the customer's hosts follow that host too, and
  the page never says why a host is suggested. In a very small community, someone who knows
  exactly who else follows their host could still guess something. And someone who makes two
  accounts of their own can supply two of the three people, and so learn that at least one more
  person follows the same two hosts (not who). To make that harder, an account only counts once
  it is at least three days old. Is three enough, and does this need saying in the privacy page?
- **Deleting your own account** (new, plan 39; not built). Apple and Google require that a
  person can delete their account and the personal details that go with it, except records
  the law says must be kept. Today an account can only be closed by the founder, which locks
  it and keeps almost everything. Which records must Connect keep, and for how long (paid
  calls and money, refund requests, reports, identity-check results, blocks)? Which must be
  wiped, and how soon? May Connect keep enough about someone it removed for breaking the
  rules to stop them signing up again?
- **The list of what deleting wipes and keeps** (new, plan 45, part 19c; not built). The
  builder wrote a first version, group by group: erased, kept without anything that says who,
  or kept for a reason and a time. It needs a lawyer's decision line by line. The builder's
  own first values: everything is wiped within 30 days of the request, **with three kinds of
  exception**: (1) reports about the person, whether still open or long closed, and pauses
  and blocks against them, kept 3 years; (2) the records of paid calls and money, kept for as
  long as tax and dispute rules need (to be named); (3) the texts and evidence of a refund
  request or bank dispute that is still open, kept until it is closed and then wiped. Also: there is no way back once a deletion is confirmed; and outside companies
  that hold copies (Stripe for ID checks and cards, the email and video services) are asked
  to remove theirs where they offer a way. Are these right?
- **The phone apps** (new, plan 39; not built). The privacy page must also cover what an app
  adds: the phone's address for notifications, what a notification shows on a locked screen,
  and the camera and microphone on the phone. Both stores ask for a form saying what the app
  collects; it has to match the privacy page.
- **Two versions of the privacy and rules pages from one source** (new, plan 45, part 18;
  not built). The apps do not have projects, so the apps' version would leave out the parts
  that are only about projects and add what an app collects. The terms a person accepts stay
  the same everywhere. Is that acceptable, and what must the apps' version say?
- **Photos sent to checking companies from an app** (new, plan 45, part 14; not built). Apple
  asks for a person's plain yes before personal data goes to another company, a company that
  checks pictures by machine included. The app would ask before the first photo is sent.
  Does the website need the same, and what should the sentence say?
- **How long records are kept, in general.** (Plan 5.)

## 5. Emails

- **Emails to followers** ("a host you follow is available", "a new diary post"). US law asks for
  the sender's postal address in such an email, and there is no registered company yet, so these
  emails are built but switched off. Before they are switched on: the address, and a look at the
  emails for the UK and Europe. (Plan 31.)

## 6. Countries

- **Which countries must not be served.** (Plan 5.)
- **The United Kingdom:** the Online Safety Act has no exemption for small services. Private video
  calls between users are likely covered. A written risk assessment may be needed before UK users
  are let in. (Plan 27; messaging research.)
- **The European Union:** the rules for online platforms (the Digital Services Act) and for
  personal data (GDPR). (Plan 27.)
- **Consumer rules** in the UK and the EU for memberships and monthly contributions. (Plan 27.)
- **Tax:** VAT on Connect's fee; whether Connect must report what hosts in the EU and the UK earn
  to the tax offices there; tax papers for hosts abroad (with the accountant). (Plan 27.)

## 7. How hosts are ordered and suggested (new, plan 37)

- **Explaining suggestions to customers.** The EU's Digital Services Act (Article 27) makes
  online platforms explain, in plain words, the main things that decide what is suggested.
  Article 19 exempts micro and small companies: fewer than 50 staff, and a yearly turnover or a
  balance sheet total of no more than 10 million euros, counted together with linked and partner
  companies. Does the exemption fit Connect? If the rule applies, the explanation has to be in
  the **terms**, not only beside the row. The app shows a short "Why these hosts?" explanation
  in any case.
- **Explaining the order to hosts.** A separate EU rule (the Platform-to-Business Regulation,
  2019/1150, Article 5) may require the **terms** to tell hosts the main things that decide how
  they are ranked. The builder found no exemption for small companies for that article (to be
  confirmed). Does it apply?
- **Search** orders hosts by how well the name matches. If the rule above applies, the terms
  should say that too.

## 8. Only if messaging is ever built

Messaging between customers and hosts is not built. If it is, the points are in
`docs/research/messaging/compared.md`: the duty to report, how long messages are kept, what the
terms must say about staff reading reported messages, and the UK and EU rules.

## 9. The company and the founder (new, legal review of 20 November 2026)

Sections 9 to 14 come from a read of the whole app on 20 November 2026, done to find what the
sections above leave out. The places in the code are named so each point can be checked.

- **There is no company, so the founder answers for everything in person.** Every refund, every
  bank dispute, every claim after a bad call would be against the founder's own money. Which kind
  of company, registered where, and is it in place before the first real user? Which accounts must
  then be in the company's name (Stripe, Meta, TikTok, Google, the web address, the video, email
  and picture-checking services)?
- **Who owns the app.** `LICENSE` names the founder in person. Much of the code was written with
  AI tools. What must be signed so that the company owns the code, the name and the look, and how
  far can code written this way be protected at all?
- **The name "Connect".** It is an everyday word, and other companies use it (Stripe's own product
  for paying hosts is called "Connect"). Can the name be protected, and could someone else stop
  its use?
- **Insurance.** Which cover is sensible before launch: for a data leak, for mistakes in the
  service, for general claims?

## 10. What the terms have to do (new, legal review of 20 November 2026)

- **The protections themselves.** Section 1 says a lawyer writes the terms. The parts that protect
  Connect are: a cap on what Connect can owe, "as it is" with no promises, the user paying for
  claims they cause, disputes settled one by one in arbitration and not as a group (in the United
  States), and which country's law applies. How far do UK and EU consumer rules cut these back?
- **Proof that a person accepted.** The app keeps the moment and the version name
  (`termsAcceptedAt`, `termsVersion` in `src/db/schema.ts`; written in
  `src/app/welcome/actions.ts`). It does not keep the text of each version, and one tick covers the
  rules, the terms and the privacy page together. Is that enough proof in a dispute, should each
  version's text be kept, and in the EU should the privacy page be something a person is told,
  not something they "accept"?
- **Who the customer's contract is with.** Connect takes the customer's money into its own Stripe
  account and passes the host's share on later (`src/lib/payments/hold.ts`,
  `src/lib/payments/actions.ts`, the transfer). So to the bank and to the card companies Connect
  is the seller. Yet the host gives the call and decides about refunds. The terms must say who
  sells what: is Connect the seller, or the host's agent for taking payment? The answer decides
  who owes the refund, who answers under consumer law, and who owes sales tax or VAT.
- **A separate agreement for hosts.** Nothing a host accepts today is about hosting. Points for
  it: a host works for herself and is not an employee; she handles her own taxes; she lets Connect
  show her name, photo and diary; Connect may take back money from her later earnings when a bank
  dispute is lost after she collected (`src/lib/payments/disputes.ts`: today a lost dispute is
  "settled by hand"); no taking payment for a Connect call outside Connect; how an account is
  paused or closed.
- **Pausing and closing a host's account, in the EU.** The Platform-to-Business Regulation asks
  for reasons in writing, 30 days' notice before closing in most cases, and a way to complain.
  The paused page gives the reason and an email address (`src/app/paused/page.tsx`). The email
  that tells a host her page is suspended gives no reason at all
  (`src/lib/profiles/decision-email.ts`), and a suspension ends her memberships and contributions.
  What must each message say, and what must the terms add? (Section 7 raises the same regulation
  for ranking only.)
- **Advice given on calls.** The rules page describes Connect as "advice, coaching, or a chat" and
  says talking about health is fine (`src/app/rules/page.tsx`). A host may give health, money or
  legal advice with no training. What must the terms and the pages say so that Connect does not
  answer for it, and should the rules forbid presenting oneself as a doctor, lawyer or adviser
  without being one?
- **"Every host's ID is checked."** The front page promises this (`src/app/page.tsx`), and the
  code does require it before a host is approved (`src/lib/profiles/profiles.ts`). The check
  proves a name and an age, not good character. Should the terms say it is not a background check
  and not a promise of safety, and is the sentence safe as it stands?
- **Quarrels between a host and a customer.** What is Connect's part, and what must the terms say
  so that Connect is not made the judge or the payer?
- **Recording.** The rules forbid recording, and the app records nothing (no recording is started
  anywhere in `src/lib/video/livekit.ts`). Connect cannot stop a person recording with their own
  device. In some US states and countries recording a call in secret is a crime. What should the
  terms say?

## 11. More on money (new, legal review of 20 November 2026)

- **Holding hosts' money, and licences.** Section 2 asks how long Connect may hold earnings nobody
  collects. The wider question: does holding other people's money for an open-ended time need a
  money-transmitter licence in US states, and does Stripe's own agreement set a limit? What is the
  safe design (a time limit, automatic sending)?
- **US tax forms for hosts.** The code has nothing about tax. Because Connect takes the money and
  pays hosts, who must send hosts in the United States their yearly tax form (1099), from what
  amount, and which form must a host fill in first (W-9, or W-8 abroad)? Stripe can do part of
  this; it has to be switched on. (With the accountant.)
- **A booked call and the 14-day right to change one's mind** (UK and EU). A customer there can
  usually cancel a service bought online within 14 days, unless they agreed that it starts
  earlier. What must the booking page say and collect for calls, memberships and contributions?
- **Prices shown in full.** For a call the customer pays the host's price and Connect's fee comes
  out of the host's share, so nothing is added at the end. For a tip a "payment fee" is added on
  top (section 2). California's law on prices shown in full (SB 478) is one more rule to test that
  fee against.
- **Stripe's own yes.** One-to-one paid video calls with online personalities can look like adult
  services to a payment company. Has Stripe been told exactly what Connect is, and has it agreed
  in writing? An account closed after launch would freeze everyone's money.

## 12. More on what Connect keeps about people (new, legal review of 20 November 2026)

- **The face match in the ID check.** The check compares a selfie with the ID
  (`require_matching_selfie` in `src/lib/safety/identity.ts`). Stripe does it and Connect keeps
  no picture. Several places have strict rules on face data (Illinois, Texas and Washington in the
  United States; the EU and the UK). Is Stripe's own consent screen enough, or must Connect ask
  and publish a policy of its own?
- **The outside companies.** Personal details go to Stripe, the video service (LiveKit), the email
  service (Resend), the picture checkers (OpenAI, Microsoft, Sightengine), Google, Meta, TikTok,
  YouTube, and the companies that will run the site and its database. Is a written data agreement
  needed with each, and what covers details leaving the EU and the UK?
- **A representative in the EU and in the UK.** A company outside them that offers its service to
  people there usually has to name one. Does Connect?
- **Things the app keeps that the privacy page does not mention.** Each login keeps the internet
  address and the browser (`session` in `src/db/schema.ts`). The emails the app sends about
  bookings and money are kept in full with no end date (`email_outbox`); only login emails are
  emptied once sent, and emails about a refund request after a year. Most records have no end date in the code at all.
- **Cookies.** The app sets only the cookies it needs to log in and to connect an Instagram or
  TikTok account, and Stripe sets its own on payment pages. No tracking or advertising tools were found. Does that mean no cookie banner is needed
  in the EU and the UK? (Adding any tracking tool later changes the answer.)
- **A data leak.** What must be done, and how fast (72 hours in the EU and the UK; each US state
  has its own rule)? A written plan is needed before launch.
- **The code is public.** The repository is public on GitHub, with the plans and this file. Is it
  wise to publish a list of open legal questions and the way the safety checks work? Would this
  file be better kept private, and written with a lawyer?

## 13. Things other people own (new, legal review of 20 November 2026)

- **Copyright in what hosts post.** Diary pictures, texts and photos can belong to someone else.
  In the United States a site is protected only if it has registered a contact person with the
  Copyright Office, takes reported material down, and closes the accounts of people who do it
  again. None of this exists yet: the report form has no reason for copyright
  (`REPORT_REASONS` in `src/lib/safety/reports.ts`), and only a person with an account can send a
  report, so an owner from outside cannot. In the EU the
  Digital Services Act asks every hosting service, small ones too, for a way to report illegal
  content, a written reason when something is taken down, and a named contact. What is needed?
- **The right to use what hosts post.** The terms need the host's permission for Connect to store
  and show her pictures and texts, and to make the checked copies.

## 14. Other points (new, legal review of 20 November 2026)

- **Customers "can be anywhere".** Section 6 asks which countries must not be served. To add: the
  code blocks no country for customers. The United States forbids doing business with people in
  some countries and with named persons. Is relying on Stripe to refuse those cards enough?
- **Showing that the rule against sexual content is enforced.** The rules forbid it. Pictures
  are checked by machine, but on a call it is found only when someone reports it. US law (FOSTA)
  and Stripe both look at what a site does, not
  only what it says. What record of reports and actions should Connect keep to show it acts?
- **Ratings.** Only a person who had the call can rate, and only averages are shown. Is anything
  else needed under the US rule against fake reviews (2024)?
- **People with disabilities.** Do the US law (ADA) and the EU's accessibility law (in force since
  June 2025, with an exemption for very small companies) ask anything of the site at launch?

## 15. From the second review (new, 20 November 2026)

A second, separate review of the whole app was made the same day by Astra (GPT). It agreed with
the points above. These are the points it added. Each was checked against the code before it was
written here.

**Where the app does not do what it says, or what the law would expect**

- **A person the ID check finds to be under 18.** As found, such a person kept full use of the
  app: the result was saved, but the gate looked only at the two ticked boxes. **Changed the same
  day:** the app now pauses the account by itself when it reads that result from Stripe
  (`pauseUnderage` in `src/lib/safety/reports.ts`). Their waiting requests end, their calls that
  have not started are cancelled at no charge, they are told why and where to write, and the
  founder is told by email. (Two cases apart: an admin's own account is not paused, only logged;
  an account paused already keeps its pause and its reason, and the founder is told.) Still to decide: is a pause enough, or must the account be closed and
  its details removed? What must be done about calls that person already had, and about the hosts
  on them? If the check was wrong (a misread ID), is lifting the pause by the founder enough?
- **"Remove and report" does not report.** The founder's button locks the picture and writes a
  line in the log (`lockAndReport` in `src/lib/projects/moderation.ts`). The report to the
  authorities is made by hand, and the app only notes the time the founder says it was made.
  Should "reported" need proof, such as the receipt number? Hosts' and customers' photos are not
  under the child-safety tool at all yet (`src/lib/projects/child-safety.ts` says so).
- **"Only the host sees it."** The booking form said this about the customer's note. When either
  person reports the other, the note is copied into the report, which the founder reads
  (`src/lib/safety/reports.ts`). **Corrected the same day:** the form now says the host sees it,
  "and Connect only if one of you reports the other" (`src/app/h/[handle]/book/page.tsx`). Is
  that wording right?
- **The ID page** said Stripe tells Connect "only" that the person is real, 18 or older, and the
  name. In fact the server reads the full date of birth from Stripe to work out the age, and does
  not keep it (`src/lib/safety/identity.ts`). **Corrected the same day:** the page now says so
  (`src/app/identity/page.tsx`). Is that wording right?
- **The tick box for a monthly contribution** said the money is taken "three days later each
  time", while the lines beside it said a bank can make that shorter. **Corrected the same day:**
  the box, and the email that repeats it, now add "or sooner if my bank shortens the hold"
  (`src/lib/contributions/wording.ts`). Is that wording right?
- **The time to ask for a refund runs from the start of the call, not its end**
  (`moneyTiming` in `src/lib/payments/rules.ts`), and a short card hold can cut it shorter.
  Section 2 above says "within 24 hours of the call". The terms must give the real rule. Also:
  once the host has collected, the customer is sent to support with no set way to be paid back.
  Who pays then?
- **Refund texts are wiped after one year, whatever is going on** (`forgetOldRequests` in
  `src/lib/refunds/requests.ts`). If a bank dispute or a court case about that call is still
  open, the evidence goes too. Is a "keep this, there is a case" switch needed?
- **Accepting the terms again overwrites the first record.** Only the latest moment and version
  are kept (`src/app/welcome/actions.ts`), and the form does not say which version the person was
  looking at. So Connect cannot show what someone accepted last year.

**Wider questions it added**

- **Are hosts really self-employed?** Connect sets a lowest price, approves and suspends hosts,
  and forbids payment outside the app. Tests such as California's, the UK's "worker" status and
  the EU's new platform-work law look at control like this, not at what the contract says. This
  needs its own look, country by country.
- **Large sums and money laundering.** A single contribution can be up to $100,000, and a tip
  with its payment fee has the same ceiling (`src/lib/contributions/rules.ts`). Two people working together
  could move money this way. Are lower limits needed, and does Connect have duties of its own
  beyond Stripe's checks? The sanctions question in section 14 also covers named persons, not
  only countries, and hosts already approved in a country later taken off the list.
- **Canada, Switzerland, Norway and Liechtenstein** are in the host list too
  (`src/lib/profiles/countries.ts`). Their privacy, tax and email laws (Canada's anti-spam law
  among them) are not on this list yet.
- **Time that expires in a membership.** When a month's unused time expires, the money is split
  between the host and Connect (`src/lib/membership/months.ts`). That Connect earns from expired
  time matters for the gift-card and unclaimed-money rules in section 2.
- **What a host writes in her diary.** She could call the project a charity, or promise a return
  on the money. Either changes what the law thinks a contribution is (charity rules, investment
  rules). Should the rules forbid both, and should Connect keep a copy of the page as it was when
  someone paid?
- **Sexual exploitation and urgency.** A report of "nudity or sexual content" is not marked
  urgent, while threats and "under 18" are (`REPORT_REASONS` in `src/lib/safety/reports.ts`).
  Is a separate, urgent way needed to report being pushed or forced into sexual acts?
- **Automatic renewals in the United States.** The national "click to cancel" rule was struck
  down by a court in 2025 (to be confirmed), so the state laws, California's first, are what
  count. Section 2 should be read with that in mind.
- **The invitation to a membership is an email with a price in it**
  (`src/lib/membership/emails.ts`). Is it an advertisement in law, which needs the sender's
  postal address and a way to stop, like the follower emails in section 5?
- **Someone who is not a user** (a person being impersonated, or shown in a picture without
  consent) cannot use the report form: it needs an account. Such a person can only write to the
  support address shown on the site, which is still a placeholder. A manager or agency running a
  star's account raises the question of who really has the right to sell calls under that name.
- **Stars are not a safety mark.** Calls ended for safety cannot be rated, and a new host starts
  with an assumed rating when hosts are ordered (`src/lib/ratings/rules.ts`,
  `src/lib/suggestions/rules.ts`). Should the pages say what a star average does and does not
  show?
- **Security duties.** The full text of every message from Stripe is kept
  (`src/app/api/stripe/webhook/route.ts`). Which card-industry form (PCI) applies, and is the
  video service set so that it records nothing? That cannot be seen from the code.
- **Tips are switched on unless the founder switches them off** (`tips_off` in
  `drizzle/0047_tips.sql`). Given the open questions on the payment fee, should they start off?
- **Requests from the police and courts.** Beyond section 3: how to check a request is real,
  what may be handed over without a court order, and who decides.
- **The phone apps and the stores' own payment rules.** Apple and Google allow outside payment
  for a live call between two people. They may not allow it for memberships or tips. (The plans
  cover this; it was missing here.)
- **Software from others.** One building block for pictures (libvips, inside `sharp`) has a
  licence with conditions of its own (LGPL). Do they matter for the phone apps?

## 16. Telling people about new terms (new, plan 46 part 2, 20 November 2026)

How it is built: a new version of a document is put on the site at least 30 days before its day;
the page of the current version says so; everyone it concerns is sent one email with the day, a
sentence about what changes, and a link to the new text; from the day on, each person is asked to
accept at their next visit (hosts on their Hosting page). The app keeps, for each email, when it
was written and when it was sent. Questions:

- **Is that enough to change the terms for people who signed up under the old ones**, in each
  country hosts are in? In particular for prices and money rules, and for consumers in the EU and
  the UK, where a change by notice alone can be an unfair term.
- **From when do the 30 days count:** from the email being sent, or being received? The app
  counts from the sending.
- **An address that no longer works.** The email is then not sent again, and the app does not
  treat that as a notice that failed. Is the notice on the site enough for that person?
- **A person who signs up, or becomes a host, inside the 30 days** accepts the current version,
  is shown the coming one on the same page, and gets the email at once. They get less than 30
  days. Is that all right, since they knew before they agreed?
- **The Privacy Policy is told and not accepted.** Is telling enough where the change needs
  consent (a new purpose, a new kind of information)?
- **A person who does not agree** is told to stop using Connect and to ask for the account to be
  closed. What about a booked call, a membership month that has begun, or money a host has not
  collected, on the day the new version starts?
- **The first published version** follows a draft that was never in force, so no 30 days are
  given for it. People who signed up under the draft are asked to accept it at their next visit.
  Is there anything they should be told beyond that?

