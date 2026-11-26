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
- **Saving a card, and the ID check, in the phone apps** (new, plan 45, part 06; built, not
  live). Before a paid request is sent from the app, the customer ticks the same box, with the
  same words and the same recorded version, as on the website. The card is then typed into
  Stripe's own sheet, which adds a line of Stripe's own under the card ("By providing your card
  information, you allow Connect to charge your card for future payments in accordance with
  their terms"). Do the box's words and Connect's terms cover what that line says? The ID check
  opens Stripe's page in the phone's browser over the app; Stripe asks there for its own yes
  to the photo and the selfie. Is anything more needed from Connect before that page opens?
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

## 8. Messages between hosts and customers (plan 49, built on 26 November 2026)

A host and a customer can write short text messages to each other, around a call and, from the
host's side, afterwards too. The messages are stored by Connect as plain text. Proposed wording
for the Terms, the Community Rules and the Privacy Policy is in
`docs/legal/messages-proposed-wording.md`, and a draft of what the founder does when a report
suggests a child or exploitation is in `docs/legal/when-a-report-suggests-a-child.md`. Both need
a lawyer's read before Connect opens to real people. The research behind them is in
`docs/research/messaging/compared.md`.

- **The duty to report.** Once Connect stores private messages, when must it report to the
  national centre (NCMEC), what must a report hold, how fast, and for how long must what was
  reported be kept? Is anything owed for people outside the United States? The app sends nothing
  by itself; a person does.
- **Keeping messages.** The app deletes a message 12 months after it was sent. Is that a period
  Connect may promise, and is it long enough? What is kept with a report is never deleted by the
  app: how long must and may that be kept?
- **Staff reading messages.** The app shows the founder a part of a conversation only when one
  of its two people reported a message in it, and records every look. Is the proposed wording in
  the Terms and the Privacy Policy enough as the people's agreement to that? Must it say more
  about handing messages to the authorities?
- **Not end-to-end encrypted.** Is saying so plainly, as the proposed wording does, enough?
- **Intimate pictures** (the law on removing them within 48 hours): messages are text only. Does
  that law reach a description in a message, and does it ask anything of the message feature?
- **A host writing first.** A host can write at any time to a customer she has had a call with.
  The customer reads it inside Connect; no email is sent about it (the founder's decision). Is a
  message like "I have a time free on Thursday" advertising under the rules for commercial
  messages (in the United States and, for customers there, the UK and EU)? If so, what must the
  customer have agreed to beforehand, and is his switch for each host enough as the way out? And
  if Connect later sends an email that only says "a message is waiting", with a "Book a time"
  link: does that email need the postal address and the stop link that advertising email needs?
- **Customers in the UK and the EU.** The UK's online safety law has no exception for small
  services, and private video calls between users are already under it. Do messages add duties
  (a written risk assessment, a way to complain), and must anything be in place before a UK or
  EU customer can write?
- **A child.** What must Connect do when it learns that a person who wrote messages is under 18,
  or under 13? (Section 2 asks the same for calls.)
- **"End call and report".** Answered by plan 50 (26 November 2026): the button is now "End call
  now", which ends the call and then offers "Report", "Block" and "Neither". The draft documents
  still describe the old button until their new versions are in. See section 24.

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

## 16. Bank disputes handled by the app (new, plan 47)

From `plans/47-bank-disputes.md`. The app answers a bank dispute by itself (built, parts 1 and
2), and takes a share back from a host after a lost dispute (built, part 3).

- **What is sent to a bank without a person looking first.** To fight a dispute, the app sends
  the customer's bank, through Stripe: the customer's name and email address, since when they
  have an account, when they and the host
  joined and left the call, what they paid, the version of the terms they accepted (only once
  a published version exists), and any refund request with its answer. When the bank's reason is that the
  cardholder did not make or does not recognise the payment, and only then, it also says how
  many earlier payments of the same account Connect has no dispute on record for (when there
  are any). As built it sends no internet address and no device. Does the
  privacy policy say this clearly enough (payment terms draft, section 9.7, says only "we may
  give the bank our records")? Is anything in that list more than a bank should get?
- **A statement written by a machine.** The letter to the bank is put together by the app from
  its records and goes out in Connect's name, at once and for good. Who answers if a fact in it
  is wrong, and should a person see it first above some amount?
- **The host decides whether Connect gives in.** The host gets 24 hours to choose "give the
  money back" or "fight it"; no answer counts as "fight". Does that fit the role Connect wants
  (the host's agent for taking payment, section 9)? Must the host agreement say that silence
  means Connect answers the bank, and that giving in costs the host their share?
- **Taking a share back at Stripe.** When a dispute is lost after the host collected, the app
  tells the host, waits 14 days and then reverses the transfer at Stripe. The host's Stripe
  balance can go below zero; Stripe makes that up from later payments and, in some countries,
  by debiting the host's bank account. Is section 9.4 of the host agreement draft enough for
  that in each of the 33 countries? Are 14 days enough notice under the European rules for
  platforms (section 9 above)? What must the notice say? As built, the notice says which
  payment, that the bank decided for the customer, how the amount is worked out (the whole
  share, or the same part as the bank took of the charge), from which date Stripe is asked,
  that nothing is taken before, that the bank's fees are not charged to the host, and where to
  object. An objection is honoured by a person: the founder cancels the take-back. The app does
  not say where Stripe gets the money from beyond "your Stripe balance". If the bank later
  decides the other way after the amount was taken, the app does not give it back by itself:
  the founder and the host are told, and the founder sends it by hand. Is that enough?
- **A customer kept from paying.** While a chargeback is open the customer cannot start a new
  payment; if the bank decides for them after Connect sent proof that the call took place, it
  stays that way until the founder allows it again. May a customer be treated so for using a
  right their card gives them (in the United Kingdom also a right by law for credit cards)? The
  payment terms draft speaks only of a pause while the dispute is open.
- **Two sentences in the drafts that must change before they are published.** Payment terms
  9.7 must say what is built: while a chargeback is open the customer cannot start a new
  booking or payment, what they have already booked goes on, and after a dispute the bank
  decided for them although Connect had sent its record it stays so until Connect allows it
  again. Host agreement 9.1 must say that the host is asked to choose within 24 hours, that no
  answer means Connect sends its record to the bank, and that "give the money back" means the
  host's share of that payment is gone. The app's code did not change the drafts; the wording
  is the lawyer's.
- **How long things are kept.** The proof that was sent is kept with the dispute, and the
  messages Connect writes to a person are kept in the app ("Messages"). For how long may each be
  kept, and what happens to them when an account is closed?

## 17. Telling people about new terms (new, plan 46 part 2, 20 November 2026)

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

## 18. A higher top price for one host (new, plan 48)

From `plans/48-top-price-per-host.md`. Every host can charge up to $1,000 for 15 minutes. The
founder can let one host charge up to $2,500, and take that away again. This is built.

- **The agreement names no highest price.** The Host Agreement (6.1) says a host sets a price
  and names only the lowest one. Must it say that there is a highest price, that Connect can
  give one host a higher one, and that this is Connect's choice alone?
- **Connect lowers a host's price.** When the founder lowers or takes away a host's higher top
  price, the app sets the host's price down to the new limit at once and tells the host by
  email. Calls already booked keep their price. The agreement says the host chooses the price
  (the summary, and 6.1), and that hosts work for themselves. May Connect change a price this
  way, with what notice (the European rules for platforms, section 9 above, ask for notice of
  changes), and does it weaken the statement that the host is independent?
- **Treating hosts differently.** One host may charge more than another, by the founder's
  choice. Does that need a stated reason or stated criteria (again the European rules for
  platforms, which ask a platform to explain different treatment)?
- **Very large payments.** One call can now cost up to $60,000 (6 hours at $2,500), held on the
  customer's card before the call. Does a payment of that size bring duties that smaller ones
  do not: checks on where the money comes from, reports, a cooling-off right that is harder to
  give up (section 11 above), or a limit under consumer credit rules where the card is a credit
  card? Stripe does the payment checks today; is that enough?

## 19. Two end dates that are now built (new, plan 46 part 4, 20 November 2026)

- **Emails:** two years after an email was sent, the app removes its text, its subject, the
  address it went to, its extra headers, the note of an error and the sending service's number.
  Its key, which can hold the numbers of the people it was about, is replaced by one that names
  nobody. It keeps that an email of that kind was sent, and when. Is two years right, or should the proof
  that a legal notice was sent (new terms, a payment reminder, a decision about an account) be
  kept longer, with its text? Today the notice of new terms is emptied like any other email.
- **Counters of repeated login attempts** are kept by internet address and deleted seven days
  after the last attempt. Is an internet address personal information here, and is seven days
  right?
- **Login records** (with the internet address and the kind of browser) are deleted twelve
  months after they ran out. A login that is still used keeps moving its end forward, so the
  twelve months count from the last time it could be used. Is that long enough for looking into fraud, and short enough?
- Every other period in the Privacy Policy's table is still a proposal and nothing deletes those
  records: payments, what a person agreed to, reports and blocks, identity-check results,
  backups.

## 20. Taking money back from a host: the notice and the objection (new, plan 46 part 3a, 21 November 2026)

How it works since this change, for a share a host had collected before a bank dispute over it
was lost (and, once built, for a refund Connect gives after she collected):

- She is told in writing, in the app and by email: which payment, why, how the amount is worked
  out. **The 14 days count from the email's arrival** (the later of the moment it was
  handed to the sending service and the moment that service reported it as delivered), not
  from when the app wrote the debt down, **and nothing is taken unless that service has
  reported the email as delivered** and never as bounced. Otherwise the founder is told and can
  send the notice again.
- **She can press "I think this is wrong"** and write why. Nothing is taken then until the
  founder has decided: call it off, or answer her in writing and take it after all, no earlier
  than the first day named and no earlier than 3 days after that answer arrived. She cannot
  object a second time in the app; she can still write to support.

Questions:
- Is "handed to the sending service, and later reported as delivered" the right proof that she
  was told? A message is also on her Messages page in the app from the first moment.
- An objection sent by email stops the taking only once a person at Connect has put a hold on
  it; the notice says so and points to the button. Is that fair notice of how to object?
- Are 14 days, and 3 days after an answer, enough in each country hosts are in?
- When the notice cannot be delivered at all (an address that no longer works), may the money be
  taken after notice in the app alone? Today the app does not.
- Should the Host Agreement's section 9.4 describe the objection and the answer, and say that a
  second objection goes to support?

## 21. A refund by Connect after the host collected, and what she then owes (new, plan 46 part 3a, 21 November 2026)

How it works since this change, for a call's payment (for a contribution or a tip it is not built: see the end of this section):

- Once a host has collected her share, **only Connect can refund the customer**. The founder
  names one of the grounds the Host Agreement gives for deciding in the host's place (sections
  8.3 and 8.4) and adds a sentence; the host is told both. The customer is paid back from
  Connect's own money at once.
- **The host then owes what her share of that payment lost**, never more than was really sent
  to her. She is told in writing, and after 14 days Stripe is asked to take it back out of what
  it sent her, by the same rules as section 20 (the notice must have arrived; she can object;
  an answer gives 3 more days).
- **Only under a published Host Agreement she had accepted before the charge.** If the version
  in force when the customer's card was charged was a draft, or she accepted it later, the debt
  is written down and she is told, but the app never takes it. The founder can call it off
  (Connect carries it) or record that it was settled with her outside the app.
- The books say which it was: taken back through Stripe, paid back by her outside the app, or
  carried by Connect.
- **If the refund fails after all** (Stripe first confirms it, then the customer's bank sends it
  back), the host owes nothing: the app undoes its record and calls the take-back off. If she
  had already paid, the app does not send the money back by itself: she is told that Connect
  owes it to her, and the founder is told to send it.
- **If somebody at Connect reverses part of her transfer by hand at Stripe**, the app takes
  nothing more from that transfer until the founder has said what that reversal was for, so
  the same money is never taken twice. If it turns out that she paid twice, she is told that
  the money is owed back to her.
- In three cases the app finds that Connect owes a host money and does **not** send it by
  itself; it tells her and tells the founder to send it: money taken for a refund that then
  failed; a reversal by hand on top of a take-back that had ended; and a share that was sent
  smaller because of a refund that then failed.

Questions:
- Is asking Stripe to reverse part of a transfer, after 14 days' written notice, covered by the
  Host Agreement's 9.4 as drafted, and by Stripe's own agreement with the host, in each country
  hosts are in? Should 9.4 name it?
- Must the host be heard **before the refund** is given, and not only before the money is
  taken from her? Today she is told after the refund, and can object before the taking.
- Is "accepted before the customer's card was charged" the right test for whether the
  agreement covers this payment, or should it be the time the call was booked?
- A debt from before the agreements are published: can it be recovered at all, and how? Today
  the app only writes it down.
- The six grounds the founder can choose from are the app's own short wording of sections 8.3
  and 8.4. Do they match what those sections will say when published?
- When the host pays Connect back outside the app, what proof should be kept, and does such a
  payment need an invoice or a receipt?
- When money was taken from a host for a refund that then failed, within what time must
  Connect give it back, and does she get interest or anything else?
- The customer was told by email that a refund was on its way, and it then failed. Must
  Connect tell the customer, and within what time must the money reach them another way?

Added with the yearly statement's new columns (plan 46, part 3a, step 2b, 22 November 2026):

- A **contribution or a tip** refunded by Connect after the host collected is still paid by
  Connect itself: the host's share and Connect's fee stay as they were, and nothing is asked
  back from the host (only a call's payment is treated the new way). The draft Host Agreement
  (sections 6.5 and 8.5) says that a refund lowers the host's share and Connect's fee, so the
  app does not do what the draft describes for these two. Should the agreement say that Connect
  carries such a refund, or must the app change before the agreements are published? Such a
  refund can be large.
- The host's yearly summary now shows, apart from "Sent to you", what went back from her
  ("Taken back or paid back") and what Connect carried. It is a summary for her own records,
  not a tax form. Is that split the right one for her tax return in each country hosts are in?

## 22. Earnings a host has not collected for 12 months (new, plan 46 part 3b, 21 November 2026)

How it works since this change: when a host with an open account has not had a collection that
went through for more than 12 months (or never had one, and her oldest ready share is more than
12 months old), the app starts the collection for her. It is the same collection her own button
makes: to her own Stripe payout account, with the collection charge (25 cents; less when the
shares are very small), and nothing is sent that a bank dispute, a refund on its way or a
refund request holds back. She is told once, by email and in the app, what was sent; if a
transfer still has no clear answer 26 hours after the collection was accepted, she is told
what is known by then, with that part named as still being checked. If nothing can be sent (her payout account is not ready,
say), the app writes that down and tries again at its first daily round at least seven days
later, for as long as it lasts. A collection is never started for a closed account (the
founder's final collection is for it); one that was accepted while the account was open is
finished, and its message written, also if the account is closed afterwards.

- Is 12 months the right period (Host Agreement 7.7 as drafted says "[12]")?
- The app does this today whether or not a Host Agreement has been published and accepted. The
  money is the host's own and goes to her own account; the 25-cent charge is taken as with her
  own button. Is a charge on a collection she did not ask for all right before 7.7 is in force
  for her, or should the charge be waived for these?
- A host whose payout account never becomes ready keeps her earnings with Connect, and the app
  only keeps trying. The law on unclaimed property (in the United States, by state; elsewhere,
  its like) may ask for more: a notice to her, and after some years handing the money to the
  state. Nothing of that is built. From what amount and after how long does it apply to us?
- For a host abroad the email says that Stripe turns the dollars into her own money when it
  pays her bank, at Stripe's rate. She did not choose the day. Is that all right, or should she
  be warned before, with time to collect herself?
- No warning is sent before the 12 months are over. Should one be (30 days before, say)?

## 23. A new membership cancelled within 14 days (new, plan 46 part 3c, 26 November 2026)

How it works since this change: every member, wherever they live, can cancel a new membership
within 14 days of joining. The founder decided to give this to everyone, so that nobody is
asked for their country. The member presses "Cancel within 14 days" on their membership's page;
or writes to us, and the founder presses a button with the day the request arrived. The
membership ends at once. An amount that was only held is let go. If the month was paid, what
was not used goes back to the card and calls still to come are cancelled. Time that was really
used stays paid at the member price, and so does a call the member cancelled late or missed, if
it was already charged under the booking's terms. It is only for the first month of a member's
first membership with a host; after that month has ended, the founder settles a case by hand.

- The Payment Terms as drafted (12.3) give this right under the heading for the United Kingdom
  and Europe. The app now gives it to **everyone**, as a promise of ours. The first published
  version should say so. Does giving it to everyone create any duty elsewhere that we do not
  see (in the United States, say)?
- **Days are counted in UTC.** The member's button is open on the day of joining and the 14
  days after it, by the UTC calendar. Whose calendar should count (the member's own time
  zone?), and is "day of joining plus 14" the right way to count the period?
- "Joining" is taken as the moment the bank authorised the first month's amount. Is that the
  day the contract was concluded, or is it the moment the person ticked the box? (Someone who
  ticked the box and never finished the card step has paid nothing; the app has nothing to
  cancel for them.)
- **People who joined before this change** ticked the earlier sentence ("Where a 14-day right
  to cancel applies to you (in the United Kingdom and Europe) ... Time you booked or used in
  those days is paid for at the member price"), not the new one with "By joining you ask for
  your membership to start today". The button works for them too if they are still in their
  first 14 days, and their used time stays paid. Is that all right for those few?
- The button refuses for a month whose payment has a problem we must look at first (then the
  member is asked to write to us). Does such a refusal make the cancellation "not as easy as
  joining"?
- A call that has already begun when the member cancels is worked out as any call (what took
  place is paid for; a member who does not come can be charged under the booking's terms).
  Calls still to come are cancelled at no charge. Is that the right line?
- Time used is kept only because the person was told of the right and asked for the service to
  start at once. The sentence they tick before joining now ends: "By joining you ask for your
  membership to start today." It is one line of a list with one tick for the whole list. Is
  that an express request, or does it need a tick of its own?
- A call the member cancelled late or missed, and that was already charged, stays charged
  after they cancel. Is that "service supplied" that may be kept, or must it go back?
- For a request in writing: a call that takes place between the day the request arrived and
  the moment the founder presses the button stays paid for. Must everything after the request
  go back?
- The right is given once per member and host: not for a membership that was resumed, and not
  for a second membership with the same host. Is a new invitation after an ending a new
  contract with a new 14 days?
- We believe a newer European rule asks for a "withdraw from the contract" button on the
  website for contracts made online (Directive (EU) 2023/2673, applied from June 2026). This
  was not checked by a lawyer. Does the member's button meet it (its name, where it is, the
  confirmation the member gets), and does the model withdrawal form have to be offered too?
- The phone apps have no such button yet; a member there uses the website or writes to us.

## 24. "End call now": who pays what when a call is ended, and reports that lower a charge (new, plan 50, 26 November 2026)

What was built is in `plans/50-end-call-now.md`; proposed sentences for the four documents are in
`docs/legal/end-call-now-proposed-wording.md`. The founder's decisions: one button, "End call
now"; then "Report", "Block" or "Neither"; the host ends a booked call and the customer pays for
her minutes; the customer ends it and pays for his whole booked time; the customer ends it and
reports the host and pays only for the minutes; no person at Connect decides any of it. The
guard against repeated reports is the builder's choice, which the founder asked for.

- **The documents are behind the app.** The draft Terms (7.5), Payment Terms (8), Community Rules
  and Host Agreement (8.3) still say "End call and report" and "the money waits for our review".
  All four are drafts, marked "not in force yet". Is it acceptable to run the app like this until
  the new versions go in together with the other waiting changes, or must these four passages be
  corrected first?
- **Charging the whole booking when the customer ends the call.** He is charged for time that did
  not take place (the rest of the booking), because he ended a call the host had set time aside
  for. The app says so in the question before the press ("Your whole booked time is still
  charged") and he confirms. Is that enough for the charge to stand: under US consumer law, under
  the card networks' rules for a dispute ("service not received"), and for a customer in the UK
  or EU (where an unfair term, or a charge that is not a real estimate of the host's loss, can
  fail)? Must the rule also be shown when he books?
- **The same rule before the booked start.** A press in the five minutes before the start is
  charged as his cancelling at that moment would be (free, or the whole booking, by the host's
  cancelling rule). Is that the right reading, and do the documents need to say it?
- **Lowering a host's pay on a report nobody examines.** When the customer who ended the call
  reports the host before the money is taken, he is charged only for the minutes, automatically.
  The host is paid less because of an accusation that no person has read, is not told that she
  was reported, and has no step in the app to answer it. Calls are not recorded, so there is
  nothing to examine. What must the Host Agreement say for this to hold (the proposed wording
  says it plainly, and that the most it can cost her is the difference between the whole booking
  and the time she gave)? Does she need a way to object, and an answer within a stated time? Does
  the UK or EU platform-to-business law ask for a statement of reasons here?
- **Telling the customer that a report lowers the charge.** The screen after the press says: "If
  you report [name], this call is charged only for the time it lasted." It is said openly so that
  a person who was really treated badly does not believe they must pay for the whole booking. It
  also tells a dishonest customer how to pay less. Does saying it create any liability toward
  hosts, and is "a report must be true" in the Community Rules enough of an answer?
- **Treating a customer differently after several reports.** After 3 lowered charges among his
  last 5 booked calls, a further report does not lower the charge. His report is still read and
  the block still stands. He is told at once, by a message and an email, in words that accuse
  nobody. Is this a fair term? Must the Payment Terms state the numbers (the proposed wording
  does)? Is it "automated decision-making" with a legal or similarly significant effect for a
  customer in the UK or EU, so that he must be able to ask for a person to look at it? Could it
  be said to punish reporting, which the law protects in some places (for example a report about
  a child, or about harassment)? A report about "someone under 18" is treated like any other for
  the money: should it be?
- **A report that does not count.** A report about a host whom another person has also reported,
  from a call with her that took place, is not counted against the customer. That uses other
  people's reports about her, unexamined, to decide how he is treated later. It never changes
  what he pays for that call or what he is shown, so he learns nothing about those reports. Any
  problem?
- **What Connect now keeps.** On each call: who ended it, and for a customer's report after his
  own press, when it was made and what it did to the charge. The privacy policy and the retention
  schedule do not mention these. How long may they be kept, and must they be named?
- **The message to the founder.** "[Name] has ended a call and then reported the host 3 times
  among their last 5 calls." It is about a person, on the strength of reports nobody examined.
  Anything to watch in how it is worded or kept?
- **Bank disputes.** For a whole-booking charge the app's answer to the bank says that the
  customer ended the call with "End call now" after the app told him the whole booked time would
  still be charged, and that he confirmed. It claims nothing about the terms. Is that the right
  thing to send, and should it cite the Payment Terms once they say so?
- **A call ended with the old button** keeps its place on the founder's review list (the builder
  knows of none outside test data). Nothing to do unless such calls exist when the app goes live.

