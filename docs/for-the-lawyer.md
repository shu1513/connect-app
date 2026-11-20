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
- **The phone apps** (new, plan 39; not built). The privacy page must also cover what an app
  adds: the phone's address for notifications, what a notification shows on a locked screen,
  and the camera and microphone on the phone. Both stores ask for a form saying what the app
  collects; it has to match the privacy page.
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
