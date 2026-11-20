# Tax forms for hosts: what Connect itself has to send

Researched on 20 November 2026 by the builder, from the pages of the tax offices and of Stripe
named at the end. The builder is not a tax adviser; this is what those pages say, with what is
still unsure marked as such. The founder asked: "hosts are responsible for reporting their own
tax earning. (we don't need to provide 1099 right?)"

## The short answer

- **A host owes tax on what she earns whether or not she gets a form.** That part is right, and
  the Host Agreement says it (section 16).
- **But a form is not the host's duty, it is the payer's.** In the United States the company
  that takes the customers' money and pays the hosts has to send a yearly form to the bigger
  hosts and to the tax office. That company is Connect.
- **How many hosts it concerns in the United States: few.** With the structure the agreements
  use (the host sells, Connect takes the payment), the form is the 1099-K, and it is due only
  for a host with **more than $20,000 and more than 200 payments** in a calendar year.
- **In the European Union it concerns every host, from the first euro.** This is the finding
  that matters most for launch.

## The United States

**Which form.** There are two possible forms, and the structure decides which.

| How the law sees Connect | Form | Due for a host with |
|---|---|---|
| A marketplace that takes customers' payments and settles them to the people who sold (a "third party settlement organization") | 1099-K | More than $20,000 **and** more than 200 payments in the year |
| A business paying people for services given to it | 1099-NEC | $2,000 or more in the year (it was $600 until the end of 2025) |

The agreements say the host sells the call and Connect takes the payment for her. That is the
first row. The tax office's own rule is that a payment that could go on both forms goes on the
1099-K only. So the structure chosen for legal reasons is also the lighter one for tax: a host
earning $5,000 a year gets no federal form under the first row and would get one under the
second.

**The threshold.** A law of 2025 (the "One Big Beautiful Bill") put the 1099-K threshold back
to more than $20,000 and more than 200 payments, after years in which it was meant to fall to
$600. The tax office's instructions for 2026 say the same.

**Who sends it when Stripe is used.** Stripe's pages say: Stripe sends the 1099-K itself only
where Stripe sets the prices; where the platform does, "the platform is responsible for filing
any relevant 1099 forms". Connect sets its own fees and pays hosts through accounts of the kind
Stripe calls Express, for which Stripe says the platform files and may use Stripe's own tool:
Stripe asks the hosts for their tax details, shows which are missing, and files the forms from
the Stripe dashboard in January when the platform presses the button.

**States.** Some states ask for a 1099-K at a much lower amount for hosts who live there. The
pages found name Massachusetts, Maryland and Virginia at $600, New Jersey at $1,000, and (with
sources that disagree) Vermont, the District of Columbia and Illinois. **Not checked on the
states' own pages.**

**A host who gives no tax number.** For a host who passes the threshold and has not given a
taxpayer number, the payer has to hold back 24% of what it pays her and send it to the tax
office ("backup withholding"). So the number must be collected before a host gets near the
threshold. Stripe's tool is what collects it.

**Hosts outside the United States.** No 1099 is due for a host who is not a US person, as long
as Connect holds her signed statement that she is not (form W-8BEN, or a substitute the tax
office accepts). Without it, the tax office's rules can treat her as a US person who gave no
number. Whether Stripe's sign-up for hosts abroad collects that statement was **not found**.

## The European Union (the rule called DAC7)

- It reaches platforms **outside** the EU that have sellers living **in** the EU. Such a
  platform registers in one EU country of its choice and reports there.
- It covers "personal services": work done by a person at a user's request, online or not. A
  paid video call fits that description.
- **There is no smallest amount for services.** The well-known limit (fewer than 30 sales and
  no more than 2,000 euros) is for the sale of goods only. A host in the EU who earns 20 euros
  in a year is reportable.
- Each year by 31 January the platform reports, for every such host: who she is, her tax
  number, her address, her bank account, what she was paid in each quarter, and the fees kept.
  It has to collect and check those details ("due diligence") and tell the host what it
  reported.
- A platform is let off only if its own country reports the same things and swaps them with the
  EU. **Not checked** whether the United States counts; the builder's understanding is that it
  does not.
- Stripe has a product for this ("Platform Tax Reporting"). When this was written it was in
  private preview, and Stripe's own pages disagreed on whether Poland was covered.

## The United Kingdom

The UK has the same kind of rule, with reports due by 31 January. Its own page says it applies
to platform operators that are resident, incorporated or managed in a country that has adopted
the rules. Whether a company in the United States with hosts in the UK has to register with the
UK tax office was **not settled** by the pages found: one adviser's page says it may. This needs
an answer before UK hosts are let in.

## What this means for Connect

1. **Nothing to build now.** The details are collected and the forms sent with Stripe's tools,
   which are switched on in the company's own Stripe account. (Plan 46, "Not built here".)
2. **One more reason to think about starting in the United States only.** There, a form is due
   for a handful of big hosts once a year. With hosts in the EU, Connect has to register in an
   EU country and report every host from her first call (decision 1 in `docs/legal/README.md`).
3. **Keep the structure.** "The host sells, Connect takes the payment" is what makes the form
   the 1099-K with its high threshold.
4. **Before the first US host gets near $20,000:** Stripe's tax reporting switched on, so that
   her tax number is on file.

## Where this was read (20 November 2026)

- US tax office: [Understanding your Form 1099-K](https://www.irs.gov/businesses/understanding-your-form-1099-k); [Instructions for Form 1099-K](https://www.irs.gov/instructions/i1099k); [Publication 1099 (2026)](https://www.irs.gov/publications/p1099); [Instructions for Forms 1099-MISC and 1099-NEC](https://www.irs.gov/pub/irs-pdf/i1099mec.pdf); [Form 1099-K questions for third party filers](https://www.irs.gov/newsroom/form-1099-k-faqs-third-party-filers-of-form-1099-k); [Publication 515 (2026)](https://www.irs.gov/publications/p515); [Taxpayer Advocate on payment apps](https://www.taxpayeradvocate.irs.gov/news/tax-tips/use-caution-when-using-cash-payment-apps/2025/12/)
- Stripe: [US tax reporting for Connect platforms](https://docs.stripe.com/connect/tax-reporting); [1099 forms where platforms control pricing](https://support.stripe.com/questions/1099-tax-forms-eligibility-for-stripe-connected-accounts-where-platforms-control-pricing); [1099-K forms for platforms and marketplaces](https://support.stripe.com/questions/intro-to-1099-k-tax-forms-for-platforms-and-marketplaces); [Tax form settings](https://docs.stripe.com/connect/tax-form-settings); [Platform tax reporting](https://docs.stripe.com/connect/platform-tax-reporting)
- States (not the states' own pages): [Thomson Reuters on state reporting](https://tax.thomsonreuters.com/blog/state-tax-information-reporting-what-changed-in-2025-and-what-to-expect-for-2026/); [RSM on the new thresholds](https://rsmus.com/insights/services/business-tax/irs-updates-obbba-new-reporting-thresholds.html)
- European Union: [Dutch tax office, information for platform operators](https://www.belastingdienst.nl/wps/wcm/connect/en/business/content/information-for-platform-operators-dac7); [Irish tax office, registration](https://revenue.ie:443/en/companies-and-charities/international-tax/aeoi/dac7/registration.aspx); [BDO on the January 2026 deadline](https://www.bdo.nl/en-gb/insights/dac7-deadline-31-january-2026-key-actions-for-eu-and-noneu-platform-operators-tale-intsco-itls); [Taylor Wessing on the EU and UK rules](https://www.taylorwessing.com/de/insights-and-events/insights/2023/08/oecd-model-reporting-rules-for-digital-platforms-dac7-eu-and-uk-implementation)
- United Kingdom: [Reporting rules for digital platforms](https://www.gov.uk/government/publications/reporting-rules-for-digital-platforms/reporting-rules-for-digital-platforms); [Selling goods or services on a digital platform](https://www.gov.uk/guidance/selling-goods-or-services-on-a-digital-platform)
