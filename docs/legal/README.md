# The legal agreements: drafts

Written on 20 November 2026 by the builder, at the founder's request ("you will write the legal
agreement... this is just for me to see what's the best you can come up with"). **Nothing here
is in force, and none of it was written or checked by a lawyer.** The app's own pages (`/terms`,
`/privacy`, `/rules`) still show their placeholders. The open legal questions behind these
drafts are in `docs/for-the-lawyer.md`.

## 1. The documents

One set of terms for everyone, plus one more agreement for hosts. A person who is both a
customer and a host has accepted both; the Host Agreement only speaks about hosting, so the two
never clash.

| Document | Who | When | Accepted or shown | File |
|---|---|---|---|---|
| Terms of Service | Everyone | At sign-up; again for each new version | **Accepted** (by creating the account; see section 4) | `terms-of-service.md` |
| Payment Terms | Everyone | At sign-up, as part of the Terms; the key rules shown again at each payment | **Accepted** (the same act) | `payment-terms.md` |
| Community Rules | Everyone | At sign-up, as part of the Terms; linked from every call | **Accepted** (the same act) | `community-rules.md` |
| Host Agreement | Hosts only | When applying to host; again for each new version | **Accepted** (its own tick box) | `host-agreement.md` |
| Privacy Policy | Everyone | Linked at sign-up and in the footer | **Shown**, not accepted | `privacy-policy.md` |
| Copyright and Content Complaints Policy | Everyone, also people with no account | Footer | **Shown** (and part of the Terms) | `copyright-policy.md` |
| Identity Check Notice | Anyone about to take the ID check | On the page with the button that leads to Stripe | **Shown, and consented to** by pressing that button | `identity-check-notice.md` |

Why split this way:

- **The Payment Terms are their own document** because money rules change more often than the
  rest, and because a customer who wants to know "what will I be charged" should find it in one
  place.
- **The Privacy Policy is shown, not accepted.** In Europe and the United Kingdom a privacy
  policy is information the law makes us give. Asking people to "agree" to it adds nothing and
  can be held against us.
- **The Host Agreement is separate** because it holds what protects Connect most on the host's
  side (independent, not an employee; taxes; money owed back after a bank dispute) and a
  customer has no reason to read it.

## 2. The structure chosen: the host sells, Connect takes the payment

Every money clause follows from one choice: **the host is the one who sells the call to the
customer, and Connect is the host's agent for taking the payment** (Terms, section 5; Host
Agreement, section 5).

Why this one: it matches how the app already works (the host sets the price, the cancelling
rule and the refunds); it keeps Connect out of what is said on a call; it makes the money the
host's income and only the fee Connect's; and "agent of the payee" is the usual footing for a
marketplace that holds money without being a money-transmitting business.

What it does not do: to the bank and the card companies Connect still appears as the seller,
so bank disputes land on Connect first. The Host Agreement (section 9) lets Connect take that
money back from the host. Whether this structure holds in each country is the lawyer's first
question (`docs/for-the-lawyer.md`, sections 10 and 11).

## 3. "Maximum protection": what is in, and where it stops

In the Terms and the Host Agreement, written to stand out where the law rewards that:

- **The "big boy" clause** (Terms 16.4, Host Agreement 18.5, Payment Terms 11.1): each person
  confirms they are an adult making their own decision, on their own judgment, not relying on
  anything Connect said or did not say, and accepts the risk.
- **No promises** about the service or about any person (Terms 16).
- **A cap on what Connect can owe:** the fees Connect kept in 12 months, or US $100 (Terms 17).
- **Claims against the company only,** never against the founder, owners or staff in person
  (Terms 17.5).
- **The user pays for claims they cause** (Terms 18; Host Agreement 18.2).
- **Release** for disputes between users (Terms 19).
- **Arbitration one by one, no class actions, no jury,** with a rule for many claims at once
  (Terms 20, 21.2), and one year to bring a claim (Terms 21.3).
- **Hosts are independent,** owe back money after a bank dispute, and handle their own taxes
  (Host Agreement 3, 9, 16).
- **The identity check is not a background check** (Terms 4.4); **no professional advice**
  (Terms 4.6); **no recording** (Terms 7.2).

Where it stops, said plainly:

- **A clause that reaches too far can be struck out, and can take its neighbours with it.**
  These drafts go to the edge that usually holds, not past it. That is why there is an opt-out
  from arbitration, a small-claims exception, and carve-outs for what the law never lets a
  company exclude (death or injury from our own negligence, fraud).
- **In the United Kingdom and Europe, consumer law overrides much of it** (Terms 22): no forced
  arbitration, no class waiver, a weaker cap, and the user's home courts.
- **A contract binds only the people who accepted it.** It does not bind a regulator, the
  police, a child's parents, or a tax office.
- **"Claims against the company only" needs a company.** Until one exists, the founder is the
  company.

## 4. How people accept, and the short sentences at each moment

**The founder's choice (20 November 2026): acceptance of the general terms is implicit, as on
ElectionsSimplified.** One sentence sits right beside the "Create an account" button, naming
and linking each document, and pressing the button is the yes. The version accepted is saved.
What makes this hold is that the sentence is at the button and the documents are linked there:
it may never move to the footer or shrink to a bare "Terms" link. As settled on that site, the
sentence names no single clause (no "arbitration" beside the button); the Terms carry their own
notice at the top.

Three things stay real tick boxes, on the builder's advice: **"I am 18 or older"** (age
matters far more here than on an elections site); **the Host Agreement** (the document that
protects Connect most, accepted by few people); and **every payment that repeats** (a
membership, a monthly contribution), because the renewal laws of US states ask for a separate,
clear yes. A tick is a little stronger in court than a sentence at the button; both are well
accepted when the sentence is where the person presses.

Sentences marked "today" are already in the app.

| Moment | Sentence |
|---|---|
| Sign-up, the box (today) | "I am 18 or older." |
| Sign-up, beside the button (to change: today it is a second tick box) | "By creating an account you agree to the Terms of Service, the Payment Terms and the Community Rules." Each name is a link. Under it: "Our Privacy Policy explains what we do with your information." |
| Applying to host, a box (new) | "I have read and accept the Host Agreement." |
| Saving a card for a call (today) | "I agree that Connect keeps my card for this call, holds up to $X on it when the host accepts, and charges it after the call... The card is removed once the call is over." |
| Booking a call inside 14 days, UK and Europe (new) | "I ask for this call to take place within 14 days of today. I understand that once it has taken place I can no longer cancel it under the 14-day rule." |
| Joining a membership (today, with one addition) | "I agree to this, and to my card being kept for the monthly payment and for extra time during a call with [host] that my membership time does not cover." Add: "It renews every month until I cancel." |
| A monthly contribution (today) | "I agree that Connect holds $X on my card today and every month, and takes it three days later each time, or sooner if my bank shortens the hold, until I cancel." |
| A tip (today, shown, no box) | The six sentences of `tipSentences` in `src/lib/contributions/tip-rules.ts`. |
| The identity check (to change) | The Identity Check Notice, shown above the button, and on the button: "I agree, continue to Stripe". |
| Uploading a photo (today, in other words) | "Before anyone sees your photo, our copy is checked by a checking service, without your name." |

## 5. The blanks

| Blank | What goes there | Recommendation |
|---|---|---|
| [COMPANY NAME], [TYPE OF COMPANY], [STATE OR COUNTRY], [ADDRESS] | The company that runs Connect | Form it before the first real user. Without it there is nobody for these agreements to be with but the founder. |
| [STATE], [COUNTY] | Whose law applies and where a court case is held | The state where the company is based. |
| [ARBITRATION PROVIDER] | Who runs arbitrations | One of the two large providers in the United States, the American Arbitration Association or National Arbitration and Mediation. Each wants the clause sent to it before it is used. |
| [SUPPORT EMAIL], [LEGAL EMAIL], [PRIVACY EMAIL], [HOST COMPLAINTS EMAIL], [COPYRIGHT EMAIL], [EU CONTACT EMAIL] | Addresses that someone really reads | They can all lead to one inbox at first. Today the app's support address is a placeholder. |
| [COPYRIGHT AGENT NAME] | The person registered with the US Copyright Office | The founder; registration costs a few dollars and is needed for the protection to apply. |
| [EU REPRESENTATIVE], [UK REPRESENTATIVE], [EU LEGAL REPRESENTATIVE], [MEDIATOR 1], [MEDIATOR 2] | Named people or firms in Europe and the United Kingdom | Paid services offer this. Needed only if hosts or customers there are let in. |
| [VIDEO PROVIDER], [EMAIL PROVIDER], [HOSTING PROVIDER], [DATABASE PROVIDER] | The companies that run parts of the site | LiveKit and Resend today; the others when the site is put online. |
| The [PERIOD]s in the Privacy Policy, section 7 | How long each kind of record is kept | The proposals in the table there; a lawyer and an accountant should confirm them. |
| [12] months in the Host Agreement, 7.7 | When uncollected earnings are sent without being asked | 12 months. |
| [EFFECTIVE DATE], [DISTRICT] | | |

## 6. Decisions for the founder

1. **The United States only at first, or the 33 countries from day one?** A large part of
   these documents exists only because of the United Kingdom and Europe (Terms 22, Payment
   Terms 12, Host Agreement 17.5 to 17.7, representatives, the privacy transfers). Starting with
   the United States alone would make launch much simpler. The founder's wish so far is the 33
   countries.
2. **Arbitration with an opt-out** (drafted) or the courts only.
3. **The cap:** US $100 or the fees of 12 months, whichever is more (drafted). A lower cap is
   more likely to be struck out.
4. **The 14-day rule in the United Kingdom and Europe:** the draft says a booked call is a
   leisure service with a set date, to which the rule does not apply, with a fallback if a court
   disagrees. The cautious alternative is to let customers there cancel free within 14 days
   whatever the host's rule.
5. **Hosts say whether they host as a business or as a private person,** and the page shows it
   (Terms 22.7). European law asks marketplaces for this. The app does not ask it today.
6. **How long records are kept** (Privacy Policy, section 7).

## 7. Where the app would have to change for these texts to be true

Most important first.

1. **The pages themselves.** `/terms`, `/privacy` and `/rules` show placeholders
   (`src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, `src/lib/terms.ts`). New pages are
   needed for the Payment Terms, the Host Agreement and the Copyright Policy.
2. **Proof of acceptance.** Today one tick covers rules, terms and privacy, only the latest
   version is kept, and the form does not say which version was shown
   (`src/app/welcome/actions.ts`). Needed: a history of every acceptance (person, document,
   version, moment), the Privacy Policy taken out of the tick, and the text of every version
   kept.
3. **A tick box for the Host Agreement** when applying to host. Nothing a host accepts today is
   about hosting.
4. **Real addresses.** The support address falls back to `support@connect.example`
   (`src/lib/terms.ts`). The policies promise an answer within 14 days, a way to opt out of
   arbitration, and a way for people with no account to send a notice.
5. **Thirty days' notice of new terms by email** before people are asked to accept them
   (Terms 23.2). Today a new version is simply shown at the next login.
6. **Closing your own account and deleting your details** (Terms 24.1, Privacy Policy 9.2).
   Today only the founder can close an account, and nothing is deleted. Planned in plans 39 and
   45.
7. **The periods in the Privacy Policy, section 7.** The code deletes connection grades (60
   days), suggestion history (90 days), refund texts (1 year) and login emails. Nothing else has
   an end date.
8. **Business or private host** (decision 5), asked when applying and shown on the page.
9. **The 14-day box** for customers in the United Kingdom and Europe, and a way for support to
   pay back a call or a membership cancelled under that rule (Payment Terms 12).
10. **Reasons in the email that suspends a host's page** (Host Agreement 17.4). Today it gives
    none (`src/lib/profiles/decision-email.ts`).
11. **Tax details from hosts and the yearly reports** (Host Agreement 16.2). The code has
    nothing about tax.
12. **Refunds by Connect in the host's place** for the cases in Payment Terms 9.5, also after
    the host has collected. Today that case is "write to support" with no tool behind it.
13. **"It renews every month until I cancel"** added to the membership tick box
    (`src/lib/membership/wording.ts`), with a new wording version.
14. **Sending uncollected earnings after 12 months** (Host Agreement 7.7), if that is wanted.

## 8. Astra's drafts, and where they differ from these

Astra (GPT 6.2 Astra, effort high) wrote its own full set from the same code, without seeing
these. Its text is kept whole in `astra-drafts.md`. **The two agree on the frame:** the host
sells and Connect takes the payment for the host; one master agreement with a separate host
agreement; the privacy policy shown and not accepted; arbitration with a 30-day opt-out; the
same cap (US $100 or 12 months). Taken from Astra into these drafts: the wider recording ban
(transcripts, streaming, hidden listeners, AI note-takers) and the sentence that nobody is
stopped from telling the police or a lawyer; the court option for claims of sexual assault or
harassment, which US federal law requires; a way out to court for a claim that waits too long in
a mass arbitration (without it the whole rule is at risk); "not a bank"; no pressure on
customers to add time or tip; what data a host can get; the written statement before money is
taken back from a host; the Identity Check Notice; three corrections of fact (a late
cancellation costs nothing when the card was not yet held; time before the booked start does
not count; added time is paid wholly from membership time or wholly by card, never split).

Where Astra is more generous to users than these drafts, and the founder asked for the most
protection, the stricter version was kept. These are the founder's to choose:

| Point | These drafts | Astra's drafts |
|---|---|---|
| Refunds after the host has collected | The host decides; Connect steps in for named cases | Connect always handles it and pays first, then recovers from the host |
| The 14-day rule (UK, Europe) | A booked call is a leisure service with a set date, so the rule does not apply; a fallback if a court disagrees | The rule applies; the customer is asked to request an early start |
| Contributions and tips (UK, Europe) | No 14-day right; free to cancel until the money is taken | A promised right to take one back within 14 days |
| Where a US customer may sue | Only in the company's home county, or small claims | Also where the customer lives |
| Hosts | Say whether they host as a business or as a private person | Must all host as a business, with their legal name and address shown at checkout |
| Tips | The customer pays the payment fee on top (as built) | Connect pays the fee, or tips stay off where the fee is not clearly allowed |
| The cap for UK and European consumers | Applies as far as the law allows | Does not apply at all |
| A host's notes about customers | Each side answers for its own use | A full data-processing clause: Connect stores the notes on the host's instructions |
| An ID check without the face comparison | "Write to us and we tell you whether another way is available" | A promised human-assisted alternative |

Astra also wrote two short notices that are folded into other documents here: cookies (Privacy
Policy, section 12) and requests from authorities (Copyright Policy, section 7).

## 9. What was checked, and what was not

Each rule about money, time and data in these drafts was taken from the code or from the pages
that show it to customers today (the booking pages, `src/lib/payments/rules.ts`,
`src/lib/payments/pricing.ts`, the membership, contribution and tip wording, the privacy page).
Three statements describe the app as it would have to be, not as it is: they are items 5, 6 and
8 of the list above. The law itself was written from the builder's knowledge and not looked up
again for this draft: the statute names, the 48-hour rule for intimate pictures, the 14-day
rule and its exception, and the notice periods all need a lawyer's eye.
