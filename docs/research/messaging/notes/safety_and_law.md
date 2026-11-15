# Safety and legal requirements for adding private one-to-one text messaging to Connect (as of 14 Nov 2026)

Scope note: general research to brief a founder and their lawyer, not legal advice. Research was done with web search on 14 Nov 2026 (about 16 searches/fetches). Many findings come from search-result summaries of primary sources and law-firm alerts rather than full reads of the primary text. Items marked "lawyer must decide" need counsel. Items marked "[background, not re-verified this session]" come from general knowledge of statute text and should be checked against the current US Code before relying on them.

## 1. United States law for a provider of private messaging

### Takeaway
Once Connect hosts messages, it is an "electronic communication service" provider. That means it must report child sexual abuse material (CSAM), child sex trafficking and enticement of a minor to NCMEC's CyberTipline when it has actual knowledge of them, and keep reported material for one year. The law does not require proactive scanning. The Take It Down Act (in force for platforms since 19 May 2026) very likely applies to a user-generated-content service like Connect: it needs a 48-hour removal process for non-consensual intimate images. COPPA applies only if Connect gains "actual knowledge" of under-13 users. State app-store age laws are in flux. The Stored Communications Act limits disclosure of message content to others, and moderation access should rest on clear user consent in the terms and privacy policy.

### Cited Findings

**CSAM / exploitation reporting (18 U.S.C. 2258A) and the REPORT Act**
- The REPORT Act (S. 474) was signed 7 May 2024 as Public Law 118-59 — [govinfo PLAW-118publ59](https://www.govinfo.gov/content/pkg/PLAW-118publ59/html/PLAW-118publ59.htm); [enrolled bill text](https://www.congress.gov/118/bills/s474/BILLS-118s474enr.htm)
- It raised the provider preservation period for CyberTipline report contents from 90 days to one year (2258A(h)(1)), and allows providers to keep material longer voluntarily to reduce online child sexual exploitation — [WSGR alert, 2024](https://wsgr.com/en/insights/new-minor-safety-obligations-for-online-services-report-act-expands-child-sexual-exploitation-reporting-requirements.html); [enrolled text](https://www.congress.gov/118/bills/s474/BILLS-118s474enr.htm)
- It added child sex trafficking (18 U.S.C. 1591) and enticement/coercion of a minor (18 U.S.C. 2422(b)) to the mandatory reporting categories — [WSGR alert, 2024](https://wsgr.com/en/insights/new-minor-safety-obligations-for-online-services-report-act-expands-child-sexual-exploitation-reporting-requirements.html); [Covington Inside Privacy](https://www.insideprivacy.com/?p=14863)
- NCMEC was authorised to issue guidelines (within 180 days) to help providers identify content that may indicate trafficking or enticement — [WSGR alert](https://wsgr.com/en/insights/new-minor-safety-obligations-for-online-services-report-act-expands-child-sexual-exploitation-reporting-requirements.html); [NCMEC blog "First line of defense" guidelines, 2024](https://cf.missingkids.org/blog/2024/first-line-of-defense-guidelines-to-help-online-platforms-detect-sexually-exploited-kids)
- Fines for knowing and wilful failure to report were raised, tiered by provider size; secondary summaries describe the range as rising from $150k–$300k to roughly $600k–$1M — [JD Supra summary of REPORT Act](https://production.jdsupra.com/legalnews/report-act-expands-online-service-7721843). [Background, not re-verified this session: the statute sets $850k first / $1M subsequent for providers with 100M+ monthly active users and $600k / $850k for smaller providers.]
- Commentators note that detecting trafficking or enticement in free text is far harder than hash-matching known CSAM, which may push providers toward closer monitoring of messages — [Tech Policy Press, 2024](https://techpolicy.press/child-safetyfocused-report-act-passes-us-senate)
- No duty to proactively scan: 2258A(f) states that nothing in the section requires a provider to monitor users or content, or to affirmatively search for violations — [18 U.S.C. 2258A, Cornell LII](https://www.law.cornell.edu/uscode/text/18/2258A) [background, not re-verified this session]
- 18 U.S.C. 2258B gives providers limited liability protection for good-faith reporting to NCMEC (not for intentional misconduct or recklessness) — [18 U.S.C. 2258B, Cornell LII](https://www.law.cornell.edu/uscode/text/18/2258B) [background, not re-verified this session]
- Scale of the problem: NCMEC received about 1.4 million online enticement reports in 2025 (more than 546,000 in 2024), including more than 80,000 sextortion reports; financially motivated sextortion reports exceeded 50,000 in 2025 (about 137 a day), up from 36,000+ in 2024. NCMEC links the rise partly to the REPORT Act's new enticement reporting duty — [NCMEC CyberTipline data](https://ncmec.org/cybertiplinedata); [NCMEC 2025 sextortion data, 2026](https://us.missingkids.org/blog/2026/ncmec-releases-new-sextortion-data-2025); [NCMEC Senate testimony, 9 Dec 2025](https://www.judiciary.senate.gov/imo/media/doc/57fece5a-a8d8-35e9-aac0-294cf4561020/2025-12-09_Testimony_Coffren.pdf)

**Take It Down Act (signed May 2025; platform duties effective 19 May 2026)**
- The FTC began enforcing Section 3 (notice-and-removal) on 19 May 2026 — [FTC press release, May 2026](https://www.ftc.gov/news-events/news/press-releases/2026/05/ftc-begins-enforcing-take-it-down-act)
- "Covered platform" = a public-facing website, online service, app or mobile app that "primarily provides" a forum for user-generated content, or that makes non-consensual intimate depictions available in the regular course of business. Excluded: email and broadband providers, and services that are mainly preselected, non-user-generated content where chat/comments are incidental — [Covington Inside Privacy, May 2026](https://www.insideprivacy.com/united-states/federal-trade-commission/the-take-it-down-acts-notice-and-removal-requirements-enter-into-effect/)
- FTC guidance lists "messaging" platforms among covered services; no source found states explicitly how the removal duty applies to content inside private one-to-one messages — [Covington Inside Privacy](https://www.insideprivacy.com/united-states/federal-trade-commission/the-take-it-down-acts-notice-and-removal-requirements-enter-into-effect/)
- Duties: provide a clear and conspicuous process for an identifiable individual (including minors) to request removal; remove within 48 hours of a valid request; make reasonable efforts to remove known identical copies. FTC recommends request IDs, status tracking, and telling the requester the outcome. Good-faith removal safe harbor applies — [Covington Inside Privacy](https://www.insideprivacy.com/united-states/federal-trade-commission/the-take-it-down-acts-notice-and-removal-requirements-enter-into-effect/); [Wiley alert, 2026](https://www.wiley.law/alert-May-19-Deadline-for-TAKE-IT-DOWN-Act-Compliance-Is-Your-Company-Prepared)
- Violations are treated as violations of an FTC rule, with civil penalties up to $53,088 per violation; FTC launched TakeItDown.ftc.gov for complaints and sent warning letters to large platforms (Meta, Discord, Snap, X and others) — [GRC Report, 2026](https://www.grcreport.com/post/ftc-begins-enforcing-take-it-down-act-as-platforms-face-48-hour-removal-mandate); [JD Supra on FTC warning letters](https://www.jdsupra.com/legalnews/ftc-sends-warning-letters-to-companies-1534409/)
- No court challenge to the platform provisions was found in these sources (absence of evidence, not confirmation).

**Section 230 and FOSTA-SESTA (brief)** [background, not re-verified this session]
- 47 U.S.C. 230(c)(1) generally shields a provider from being treated as the publisher of users' content; 230(c)(2) protects good-faith removal decisions. 230(e)(1) keeps federal criminal law in force, so 230 is no defence to 2258A duties — [47 U.S.C. 230, Cornell LII](https://www.law.cornell.edu/uscode/text/47/230)
- FOSTA-SESTA (2018) carved out of 230 civil claims and state criminal charges tied to sex trafficking (18 U.S.C. 1591) and created 18 U.S.C. 2421A (operating a service with intent to promote or facilitate prostitution). Relevant to a paid one-to-one creator service because a "private paid call" model is the kind of service where solicitation could occur — [18 U.S.C. 2421A, Cornell LII](https://www.law.cornell.edu/uscode/text/18/2421A)

**COPPA and the 2025 rule changes**
- Amended COPPA Rule published 22 April 2025, effective 23 June 2025; general compliance date 22 April 2026 (now passed) — [Federal Register, 22 Apr 2025](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)
- Coverage remains: services directed to under-13s, or operators with actual knowledge they collect personal information from a child under 13 — [Davis Polk update](https://www.davispolk.com/index%2Ephp/insights/client-update/ftc-prioritizes-coppa-enforcement-new-compliance-obligations-take-effect)
- Changes include new parental-consent methods and a required written information security program — [Hunton blog](https://www.hunton.com/privacy-and-cybersecurity-law-blog/ftc-publishes-final-coppa-rule-amendments); [Latham](https://www.lw.com/en/insights/ftc-publishes-updates-to-coppa-rule)

**State laws (2026)**
- Texas App Store Accountability Act (SB 2420): enjoined by a federal district court on 23 Dec 2025 (likely First Amendment violation); the Fifth Circuit stayed the injunction in late May 2026, letting it take effect. Developers must age-rate apps and in-app-purchase features and use app-store age signals; good-faith reliance safe harbor; enforced by the Texas AG under the DTPA. Litigation still pending — [MoFo update](https://www.mofo.com/resources/insights/251111-texas-targets-app-stores-with-new-accountability-law); [CCIA, 28 May 2026](https://ccianet.org/news/2026/05/appeals-court-pauses-injunction-on-texas-app-store-law-that-likely-violates-first-amendment/); [Troutman, Dec 2025](https://www.troutmanprivacy.com/2025/12/federal-district-court-grants-preliminary-injunction-of-texas-app-store-accountability-act/)
- Utah App Store Accountability Act: amended by HB 498; key duties delayed to 6 May 2027; enforcement now by private lawsuit rather than the state; CCIA's challenge voluntarily dismissed 21 April 2026; developer safe harbor for good-faith reliance on the app store's age category — [JD Supra, 2026](https://www.jdsupra.com/legalnews/challenge-to-utah-s-app-store-6173927/); [Reclaim The Net tracker](https://reclaimthenet.org/bill/utah-app-store-accountability-act); [Deseret News, 27 Apr 2026](https://www.deseret.com/politics/2026/04/27/apple-meta-google-drop-lawsuit-against-utah-app-store-verification-act-after-winning-lawsuit-against-similar-law-in-texas/)
- These app-store laws apply to apps distributed through app stores; Utah's amended law reportedly applies "regardless of how an application reaches the user" — [JD Supra](https://www.jdsupra.com/legalnews/challenge-to-utah-s-app-store-6173927/)

**Stored Communications Act (18 U.S.C. 2701–2713)**
- 2702(a) bars a public ECS provider from knowingly divulging message contents; 2702(b) exceptions include lawful consent of the sender or recipient, disclosures "necessarily incident to the rendition of the service or to the protection of the rights or property of the provider," reports to NCMEC under 2258A, and emergencies involving danger of death or serious injury — [18 U.S.C. 2702, govinfo](https://www.govinfo.gov/content/pkg/USCODE-2024-title18/html/USCODE-2024-title18-partI-chap121-sec2702.htm); [Cornell LII](https://www.law.cornell.edu/uscode/text/18/2702)
- No case or practitioner source was found directly holding that reading private messages for moderation fits the "rights or property" exception; providers in practice rely on consent obtained through terms of service and privacy policy — gap noted from search, see [Meta v. District of Columbia, D.C. 2023](https://law.justia.com/cases/district-of-columbia/court-of-appeals/2023/22-cv-0239.html) (consent exception, public posts only)
- Police requests [background, not re-verified this session]: under 18 U.S.C. 2703, basic subscriber records can be compelled by subpoena; message content generally requires a warrant (and after United States v. Warshak, 6th Cir. 2010, providers commonly insist on a warrant for content). 2703(f) lets police require preservation for 90 days (renewable) — [18 U.S.C. 2703, Cornell LII](https://www.law.cornell.edu/uscode/text/18/2703). Foreign police generally must use MLAT or a CLOUD Act agreement.

### Inferences
- Connect must register with NCMEC as an electronic service provider before launching messaging, and build a way to (a) file a CyberTipline report, (b) preserve the reported content plus account data for one year, and (c) restrict access to it. Text-only messaging still triggers reporting for enticement and trafficking, which are text-based harms.
- Because the REPORT Act made enticement mandatory to report, the realistic reporting volume for a text-only adult creator service comes from enticement/sextortion signals, not images.
- Take It Down almost certainly reaches Connect as a whole (it is a user-generated-content service). Text-only messaging lowers the practical exposure, but Connect should still publish the 48-hour removal process now, because hosts and customers may share intimate images by other means (e.g., profile photos, or later image messaging). Lawyer must decide whether one-to-one DMs are "published" content for TIDA purposes.
- COPPA: Connect is not directed to children; risk arises only if it gains actual knowledge (e.g., a report says "this user is 12"). A written process to close such accounts and delete data promptly is the main control. Lawyer must decide whether to add age assurance for customers who message.
- State privacy laws (e.g., CCPA/CPRA) mostly have revenue or user-count thresholds a pre-launch company under 10,000 users likely does not meet; not researched in depth this session (see Gaps).
- The privacy policy and terms should say plainly: messages are stored by Connect, are not end-to-end encrypted, may be reviewed by Connect staff when reported or flagged for safety, may be automatically scanned for safety signals, and may be disclosed to NCMEC or law enforcement as the law allows. This supports the SCA consent exception. Lawyer must draft.
- Law-enforcement response: publish a short law-enforcement guide and a dedicated email; require subpoena for subscriber data and warrant for content; honour 2703(f) preservation letters; allow emergency disclosure under 2702(b)(8)/(c)(4).

### Gaps
- Exact current 2258A penalty amounts and NCMEC's current trafficking/enticement guidelines were not read in full.
- No source directly addresses whether TIDA removal duties apply inside private DMs.
- California's Digital Age Assurance Act (AB 1043) obligations and dates were not found in searches; Louisiana/Alabama app-store laws not checked.
- State privacy-law thresholds and any state rules specifically on message content (e.g., California Invasion of Privacy Act claims over scanning) were not researched this session.

## 2. EU and UK duties if customers can be there

### Takeaway
There is no small-service exemption from the UK Online Safety Act; any user-to-user service with UK links must do an illegal-content risk assessment (and a children's access assessment) and apply proportionate measures. The EU Digital Services Act exempts micro and small enterprises from most "online platform" duties but not from baseline hosting duties (notice-and-action, statements of reasons). In the EU, private messaging is also covered by the ePrivacy Directive, which restricts scanning message content; a temporary derogation allowing voluntary CSAM detection lapsed in April 2026 and was revived until 3 April 2028, while the permanent "chat control" regulation is still in negotiation.

### Cited Findings

**UK Online Safety Act**
- No general exemption for small platforms; all in-scope services, large and small, must do a "suitable and sufficient" risk assessment — [Bristows "Safety Net" intro, Jan 2026](https://www.bristows.com/app/uploads/2026/01/The-Safety-Net-Intro1500441324.1.pdf); [Ofcom: why size and risk matter, 2024](https://ofcom.org.uk/news-centre/2024/why-size-and-risk-matter-in-our-approach-to-online-safety)
- In scope if the service has a "significant number" of UK users, targets the UK, or is accessible from the UK with a material risk of significant harm; "significant number" is undefined and providers should be able to explain their judgement — [Burges Salmon](https://www.burges-salmon.com/news-and-insight/legal-updates/technology-and-communications/online-safety-act-who-does-it-apply-to); [Bristows](https://inquisitiveminds.bristows.com/post/102k11s/my-organisation-runs-a-small-online-forum-is-it-in-scope-of-the-osa)
- The first illegal-content risk assessment deadline for existing services was 16 March 2025 — [Freeths, 2025](https://freeths.co.uk/insights-events/legal-articles/2025/implementation-of-the-online-safety-act-the-risk-assessment-phase-has-begun)
- Risk assessment covers 17–18 kinds of priority illegal content; for small services without boards, governance can mean reporting to a named senior manager; review at least annually — [Ofcom risk assessment guidance](https://ofcom.org.uk/online-safety/information-for-industry/guide-for-services/risk-assessments)
- Following Ofcom's Codes of Practice is a safe harbour route; a small low-risk service faces about 14 of 40-odd measures — [Ofcom codes page](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/codes-of-practice); [The Register, Jan 2025](https://www.theregister.com/2025/01/14/online_safety_act/)
- Ofcom applies the most robust measures to high-risk services even when small — [Ofcom children's codes page](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/quick-guide-to-childrens-safety-codes)
- 2026 updates: Ofcom updated risk guidance and profiles for new priority offences (serious self-harm, cyberflashing; statement 25 June 2026); amended codes in force 29 Sept 2026 / 2 Nov 2026; a duty to report CSEA content to the UK National Crime Agency came into force for user-to-user services on 7 April 2026 (reported in search summaries; not confirmed from primary text this session) — [Ofcom regulatory documents](https://www.ofcom.org.uk/online-safety/online-safety-regulatory-documents); [Ofcom statement on new priority offences](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/statement-new-priority-offences-serious-self-harm-and-cyberflashing/statement-new-priority-offences-serious-self-harm-and-cyberflashing.pdf); [Ofcom industry bulletin, Oct 2026](https://www.ofcom.org.uk/online-safety/protecting-children/online-safety-industry-bulletin-october-2026)

**EU Digital Services Act**
- Article 19 disapplies the online-platform section (Arts 20–28, except 24(3)) for micro and small enterprises — [DSA Art. 19, springlex](https://www.springlex.eu/en/packages/dsa/dsa-regulation/article-19/)
- Hosting providers of any size still owe notice-and-action (Art. 16) and statements of reasons (Art. 17) — [DSA obligations summary](https://dsa-obligations.pages.dev/) (secondary; check EUR-Lex)
- Whether one-to-one private messaging is "hosting" or "dissemination to the public" was not resolved by sources found. [Background, not re-verified: DSA Recital 14 says interpersonal communication services such as email or private messaging are not "dissemination to the public," so private messages alone would not make a service an online platform.]

**EU ePrivacy, GDPR, and chat control**
- Messaging services have been covered by the ePrivacy Directive (confidentiality of communications) since 21 Dec 2020 — [Lovguiden summary, 28 Jul 2026](https://www.lovguiden.dk/en/det-offentlige/eur-lex-lovgivning/2026-07-28-eu-forordning-tillader-midlertidigt-scanning-for-boerneseksualmisbrug-i-beskeder)
- The interim derogation permitting voluntary CSAM detection in private messages lapsed in early April 2026 after Parliament rejected an extension on 26 March 2026; it was revived by Regulation (EU) 2026/1881 of 24 July 2026, valid to 3 April 2028; it does not authorise breaking end-to-end encryption or client-side scanning — [eucrim](https://eucrim.eu/news/interim-rules-on-voluntary-csam-detection-reinstated-until-2028/); [Euronews, 23 Jul 2026](https://www.euronews.com/2026/07/23/eu-temporarily-extends-controversial-chat-scanning-regime-until-2028); sources differ slightly on lapse date (3 vs 4 April) — [EDRi](https://edri.org/our-work/the-chat-control-1-0-saga-big-tech-can-scan-our-private-messages-again-but-parliament-sent-a-strong-signal-against-mass-surveillance/)
- Permanent CSA Regulation ("chat control 2.0") is in trilogue; no confirmed outcome found after July 2026 — [Euronews explainer, 28 Jul 2026](https://www.euronews.com/my-europe/2026/07/28/why-is-chat-control-one-of-the-eus-biggest-digital-rights-fights)
- EDRi argues the derogation is not itself a GDPR legal basis; GDPR still applies to any scanning (advocacy position) — [EDRi](https://edri.org/our-work/temporary-eprivacy-derogation-companies-like-facebook-must-never-indiscriminately-scan-peoples-private-messages/)
- EDPB Guidelines 1/2024 on legitimate interest set a three-part test (legitimate interest, necessity, balancing) — [RPC summary](https://www.rpclegal.com/snapshots/data-protection/winter-2024/edpb-new-publications-on-the-eprivacy-directive-processors-and-legitimate-interests/)

### Inferences
- If Connect accepts UK users, it is very likely in scope (the service is accessible from the UK and private messaging between adults and possibly minors carries material risk). It would need a written illegal-content risk assessment and children's access assessment before launching messaging, a named responsible person, and the code measures that apply to a small service with direct messaging. Lawyer must decide whether UK links exist.
- For the EU, a micro enterprise offering one-to-one messaging plus host profiles needs at minimum: a notice-and-action channel, statements of reasons when it acts against users, a point of contact, and terms that explain moderation. Reviewing reported messages (the reporter is a party and consents to share) has a cleaner GDPR basis than automated scanning of all messages. Automated keyword scanning of EU users' private messages is legally uncertain under ePrivacy; lawyer must decide.
- Blocking EU/UK customers at launch, or blocking messaging for those regions, is a reasonable way to defer this work. No source in this session quantified how common geo-blocking is among small services (several small UK forums reportedly closed or geo-blocked after the OSA, but not verified here).

### Gaps
- Ofcom's "important dates" page and its rule for when a newly launched service must complete its assessment were not confirmed.
- No ICO guidance on moderating private messages was retrieved.
- No source quantified geo-blocking as a practice.

## 3. Retention of private messages

### Takeaway
The only hard US minimum found is preservation of CyberTipline-reported material for one year (2258A, as amended), plus 90-day (renewable) preservation when police send a 2703(f) letter. GDPR's storage-limitation principle forbids keeping EU users' data longer than needed, but no fixed maximum for messages was found. A defensible default is: keep messages while both accounts exist, delete a set period after account closure, and preserve reported conversations separately for at least one year.

### Cited Findings
- Reported material must be preserved for one year; longer voluntary retention is allowed to fight exploitation — [WSGR alert](https://wsgr.com/en/insights/new-minor-safety-obligations-for-online-services-report-act-expands-child-sexual-exploitation-reporting-requirements.html)
- 2703(f) preservation request: 90 days, renewable for another 90 — [18 U.S.C. 2703, Cornell LII](https://www.law.cornell.edu/uscode/text/18/2703) [background, not re-verified this session]
- New COPPA rule requires a written data retention policy and limits retention to what is reasonably necessary (if COPPA applies) — [Federal Register, 22 Apr 2025](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule) [retention detail from background knowledge of the rule]

### Inferences
- Default proposal for the founder and lawyer: keep messages while the conversation's accounts exist; delete within 30–90 days of account closure (with backups rolling off on their own schedule); when a conversation is reported, copy it into a locked evidence store kept at least one year, or longer if an NCMEC report or police preservation request is open; record every admin view in an audit log.
- Users of marketplaces generally expect their message history to remain visible to them; letting users "delete" a message only from their own view while the platform keeps a copy for safety should be disclosed in the privacy policy.

### Gaps
- Comparable services' published message retention periods (e.g., Etsy, Airbnb, Cameo, OnlyFans, Discord) were not researched this session.
- No survey data on user expectations was found.

## 4. Trust-and-safety practice and tools for small platforms

### Takeaway
Industry sources favour proportionate, risk-based controls; for a small text-only service the core is in-conversation reporting with message context, two-way blocking, limits on new accounts, and narrow, audited staff access. Free tools exist for image hash matching (Cloudflare) and signal sharing (Tech Coalition Lantern, by application); commercial classifiers such as Thorn's Safer are priced by custom quote and likely tens of thousands of dollars a year.

### Cited Findings
- DTSP framework: 35 best practices across product development, governance, enforcement, improvement and transparency; its "Safe Framework" is meant to tailor assessment proportionately to company size — [DTSP Best Practices (IGF 2023)](https://intgovforum.org/sites/default/files/webform/igf_2023_workshop_proposal_form/241904/DTSP_Best_Practices.pdf); [DTSP Safe Framework](https://dcmpx.remotevs.com/com/wpengine/dtsp/SL/wp-content/uploads/2021/12/DTSP_Safe_Framework.pdf)
- Ofcom's codes treat direct messaging as a risk feature with specific measures for child users (e.g., default settings preventing strangers from messaging children); the most robust measures apply to high-risk services even when small — [Ofcom codes](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/codes-of-practice); [Ofcom summary of decisions](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/summary-of-our-decisions.pdf)
- Cloudflare's CSAM Scanning Tool is free on all plans; since Sept 2025 Cloudflare reports hash matches to NCMEC as third-party reports, so customers no longer need their own NCMEC credentials; now available to non-US companies — [Cloudflare blog update](https://blog.cloudflare.com/a-simpler-path-to-a-safer-internet-an-update-to-our-csam-scanning-tool/); [Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/index.md)
- Thorn Safer: pricing by custom quote (AWS Marketplace); third-party Vendr data shows $50,000–$80,616 per year for Thorn purchases (median $51,540, five purchases; not Safer-specific). Safer Predict (launched July 2024) adds text detection trained on child-exploitation conversations; Thorn says partners range from small platforms to the largest — [Vendr](https://www.vendr.com/marketplace/thorn); [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-unzbqt3w6pqbg); [Thorn press release](https://www.thorn.org/press-releases/thorn-launches-safer-predict-a-proactive-ai-detection-solution-to-scale-child-safety-on-content-hosting-platforms/)
- Tech Coalition Lantern (cross-platform signal sharing on child exploitation) is free to join for eligible companies that meet participation criteria — [Tech Coalition Lantern report 2023](https://technologycoalition.org/news/tech-coalition-release-its-first-lantern-transparency-report-and-2023-annual-report/); Tech Coalition's 2026 "Initiate" hackathon aimed at lowering barriers to child-safety tooling for smaller companies — [Tech Coalition](https://technologycoalition.org/news/initiate-2026-a-child-safety-tooling-hackathon/)

### Inferences
- Day-one minimum for Connect's text messaging (synthesised from the above plus legal duties): report button inside the conversation that attaches the recent messages; block that stops messages both ways and hides the blocker; messaging only between people with a booking (or a host opt-in), which removes most stranger contact; rate limits and stricter limits for new or unverified customer accounts; links shown as plain text or warned about; text only; a short keyword list that flags (not blocks) age mentions, requests to move off-platform, payment handles (Cash App, crypto wallets, gift cards), and sexual solicitation; admin access only to reported or flagged conversations, with an audit log; NCMEC ESP registration and a written escalation procedure; a Take It Down removal form.
- For text-only, hash matching is not needed at launch; it becomes important if image messages are added (Cloudflare's free tool is a cheap first step if Connect is on Cloudflare).

### Gaps
- No TSPA curriculum content, Thorn or NCMEC guidance specific to small messaging services, or price for text classifiers (e.g., Hive, OpenAI moderation, Google Perspective) was retrieved.
- PhotoDNA availability terms for small companies not confirmed.

## 5. Specific risks of creator-fan private messaging

### Takeaway
The leading documented risks are enticement and financially motivated sextortion (sharply rising in NCMEC data), off-platform payment scams and impersonation, and harassment of creators. Comparable platforms responded with phone verification for messaging, default blocking of messages from strangers, and limits on new accounts.

### Cited Findings
- Financial sextortion reports to NCMEC rose from 36,000+ (2024) to 50,000+ (2025); more than three dozen US teenage boys have died by suicide after financial sextortion — [NCMEC 2025 sextortion data](https://us.missingkids.org/blog/2026/ncmec-releases-new-sextortion-data-2025); [NCMEC CyberTipline data](https://ncmec.org/cybertiplinedata)
- Twitch, after reports of predators targeting children (2022), strengthened safety: phone verification requirements and tools to stop strangers whispering (DMing) users — [PC Gamer, Nov 2022](https://pcgamer.com/twitch-strengthens-methods-to-combat-child-predators); [The Star / Bloomberg, 23 Nov 2022](https://thestar.com.my/tech/tech-news/2022/11/23/amazons-twitch-makes-changes-to-addresschild-predation-on-platform)
- Twitch has required a verified phone number to send whispers since 2021 and offers "Block Whispers from Strangers" (reportedly default for newer accounts) — [third-party guide, lower reliability](https://screenwiseapp.com/agents/the-twitch-safety-playbook-locking-down-chat-whispers-and-sp?view=human)

### Inferences
- On Connect, the customer, not the host, is the likely unverified party. Main risks: a minor posing as an adult customer and being solicited by a host (host-side abuse); customers harassing or doxxing hosts; scammers impersonating hosts or Connect staff to move payment off-platform; and sextortion of either side. Messaging only tied to bookings, plus off-platform-payment flags, address most of these cheaply.

### Gaps
- Documented incidents on directly comparable paid creator-fan platforms (Cameo, OnlyFans, Fansly, Patreon messaging) and their responses were not found in this session's searches.

## 6. What is commonly over-built at this stage

### Takeaway
No source directly listed "what to defer"; the following are inferences from the proportionality principles in Ofcom and DTSP guidance and from the legal minimums above.

### Cited Findings
- Ofcom and DTSP both frame duties as proportionate to size and risk; small low-risk services face a subset of code measures — [Ofcom: why size and risk matter](https://ofcom.org.uk/news-centre/2024/why-size-and-risk-matter-in-our-approach-to-online-safety); [DTSP Safe Framework](https://dcmpx.remotevs.com/com/wpengine/dtsp/SL/wp-content/uploads/2021/12/DTSP_Safe_Framework.pdf)
- No US law requires proactive scanning — [18 U.S.C. 2258A(f), Cornell LII](https://www.law.cornell.edu/uscode/text/18/2258A) [background, not re-verified]

### Inferences
- Reasonable to defer: paid ML classifiers (Safer, Hive), image hash matching (until images are allowed), end-to-end encryption (which would also block report-based review), transparency reports, appeals workflows beyond a simple email, multi-language moderation, Lantern membership, and full DSA/OSA compliance programmes if EU/UK are geo-blocked.
- Not reasonable to defer: NCMEC registration and reporting procedure, one-year preservation of reported content, in-conversation reporting and two-way blocking, Take It Down removal process, clear privacy-policy disclosure of message review, audited admin access, and a law-enforcement contact.

### Gaps
- No published source specifically on over-building T&S at pre-launch startups was found.
