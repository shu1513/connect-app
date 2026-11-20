# The legal agreements: drafts

Written on 20 November 2026 by the builder, at the founder's request ("you will write the legal
agreement... this is just for me to see what's the best you can come up with"). **Nothing here
is in force, and none of it was written or checked by a lawyer.** The open legal questions
behind these drafts are in `docs/for-the-lawyer.md`.

**Where the texts are now.** Since plan 46, part 1, the seven documents live in the app:
`src/legal/documents/<name>/<version>.ts`, one file for each version, listed in
`src/legal/versions.ts`. The site shows them at `/terms`, `/payment-terms`, `/rules`,
`/host-agreement`, `/privacy`, `/copyright` and `/identity-notice`, each marked "Draft. Not in
force yet." A version that has been merged is never edited: a change is a new version. This
folder keeps the map (this file) and Astra's own drafts.

## 1. The documents

One set of terms for everyone, plus one more agreement for hosts. A person who is both a
customer and a host has accepted both; the Host Agreement only speaks about hosting, so the two
never clash.

| Document | Who | When | Accepted or shown | File |
|---|---|---|---|---|
| Terms of Service | Everyone | At sign-up; again for each new version | **Accepted** (by creating the account; see section 4) | `src/legal/documents/terms-of-service/` |
| Payment Terms | Everyone | At sign-up, as part of the Terms; the key rules shown again at each payment | **Accepted** (the same act) | `src/legal/documents/payment-terms/` |
| Community Rules | Everyone | At sign-up, as part of the Terms; linked from every call | **Accepted** (the same act) | `src/legal/documents/community-rules/` |
| Host Agreement | Hosts only | When applying to host; again for each new version | **Accepted** (its own tick box) | `src/legal/documents/host-agreement/` |
| Privacy Policy | Everyone | Linked at sign-up and in the footer | **Shown**, not accepted | `src/legal/documents/privacy-policy/` |
| Copyright and Content Complaints Policy | Everyone, also people with no account | Footer | **Shown** (and part of the Terms) | `src/legal/documents/copyright-policy/` |
| Identity Check Notice | Anyone about to take the ID check | On the page with the button that leads to Stripe | **Shown, and consented to** by pressing that button | `src/legal/documents/identity-check-notice/` |

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
ElectionsSimplified.** One sentence sits right beside the button of the last step of sign-up
(an account already exists before that step, so the words are "By finishing sign-up..."),
naming and linking each document, and pressing the button is the yes. The version accepted is saved.
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
| The last step of sign-up, beside the button (built, plan 46) | "By finishing sign-up you agree to the Terms of Service, the Payment Terms and the Community Rules." Each name is a link to that exact version. Under it: "Our Privacy Policy explains what we do with your information." A person asked again after a change reads "By pressing the button you agree to the updated..." |
| Applying to host, a box (built, plan 46) | "I have read and accept the Host Agreement." |
| Saving a card for a call (today) | "I agree that Connect keeps my card for this call, holds up to $X on it when the host accepts, and charges it after the call... The card is removed once the call is over." |
| Booking a call inside 14 days, UK and Europe (new) | "I ask for this call to take place within 14 days of today. I understand that once it has taken place I can no longer cancel it under the 14-day rule." |
| Joining a membership (today, with one addition) | "I agree to this, and to my card being kept for the monthly payment and for extra time during a call with [host] that my membership time does not cover." Add: "It renews every month until I cancel." |
| A monthly contribution (today) | "I agree that Connect holds $X on my card today and every month, and takes it three days later each time, or sooner if my bank shortens the hold, until I cancel." |
| A tip (today, shown, no box) | The six sentences of `tipSentences` in `src/lib/contributions/tip-rules.ts`. |
| The identity check (built, plan 46) | The Identity Check Notice, shown in full above the button, and on the button: "I agree, continue to Stripe". |
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

## 7. Where the app had to change for these texts to be true

The 14 points, and where each stands. The plan is `plans/46-agreements-live.md`.

| | Change | Where it stands |
|---|---|---|
| 1 | The pages themselves | **Built** (plan 46, part 1): seven pages, every version kept. |
| 2 | Proof of acceptance | **Built** (part 1): one line for each person, document and version, never changed; the privacy policy is shown, not accepted. |
| 3 | A tick box for the Host Agreement | **Built** (part 1), with a box on the Hosting page for hosts from before. |
| 4 | Real addresses | The support address is a setting (`SUPPORT_EMAIL`); the others are written into the first published version. Someone has to read the inbox. |
| 5 | Thirty days' notice of new terms by email | **Built** (part 2): one email to everyone a coming version concerns, a note on the pages, and a line in the health report when the 30 days were not kept. |
| 6 | Closing your own account and deleting your details | Plan 45, parts 19 to 19c (the phone-apps work). Until then: "write to us", and the founder closes the account. |
| 7 | End dates for records | Plan 46, part 4, for emails and login records. The other periods of the privacy policy are proposals and are **not built**. |
| 8 | Business or private host | **Built** (part 1): asked when applying, shown on the host's page and where a call is asked for. |
| 9 | The 14-day sentence | **Built** (pull request 80). The founder's tool for a new membership cancelled within 14 days is plan 46, part 3. |
| 10 | Reasons when a host's page is declined or suspended | **Built** (part 1): saved, emailed and shown; closing an account takes a reason too. |
| 11 | Tax details from hosts and the yearly reports | No code: Stripe's tools on the company's own Stripe account. See `docs/research/tax-forms-for-hosts.md`. A yearly statement a host can download is **built** (plan 46, part 5); it is a summary, not a tax form. |
| 12 | Refunds by Connect in the host's place, also after she collected | Plan 46, part 3. |
| 13 | "It renews every month until I cancel" | **Built** (pull request 80). |
| 14 | Sending earnings not collected for 12 months | Plan 46, part 3. |

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
Two statements still describe the app as it would have to be, not as it is: thirty days' notice
of new terms (point 5) and the periods for keeping records (point 7). The law itself was written from the builder's knowledge and not looked up
again for this draft: the statute names, the 48-hour rule for intimate pictures, the 14-day
rule and its exception, and the notice periods all need a lawyer's eye.
