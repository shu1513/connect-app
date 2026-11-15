# Messaging: the two research rounds compared

14 November 2026. Two separate studies were done, as the founder asked: one by the builder
(`our-research.md` in this folder, with its notes in `notes/`), and one by
Astra, working on its own from the code and the web. Neither saw the other's work. This page sets
them side by side and says what the builder recommends.

## Where both agree

| Topic | Both say |
| --- | --- |
| Build or rent | **Build it ourselves** in the app's own database. A rented chat service costs roughly $280 to $500 a month at 10,000 users and repeats what the app already has (accounts, blocking, reporting, the admin screen). It would not do any of the hard parts (the rules, the safety duties). |
| LiveKit's own chat | Cannot do this job. It only reaches people who are in a call at that moment and stores nothing. |
| How screens stay up to date | The way the app already does it: the page asks the server every few seconds while the conversation is open. Faster methods can come later if ever needed. |
| What it is for | Arranging a call and a short follow-up. Not a free way to reach a host, and not a product to sell. |
| No cold messages | Nobody can message a stranger. Hosts cannot message customers out of the blue or write to all their contacts. |
| After the call | The conversation stays open for **7 days**, then can only be read until the next booking. |
| What a message can be | Text only, up to about 2,000 characters. No photos, files, link previews, typing dots, editing, search, or paid messages in the first version. |
| Safety | A report button on messages that saves the conversation; blocking stops messages both ways; an admin can read a conversation only through a report, and every look is logged. No end-to-end encryption, because reports could not be reviewed. |
| Email | One email for a batch of missed messages, with a link and **without** the message text. |
| The law (United States) | Once we know of child sexual exploitation, including an adult trying to entice a minor by text, we must report it to the national hotline (NCMEC) and keep the evidence for a year. The law does not require us to scan every message. A lawyer must confirm our duties and the privacy wording. |

## Where they differ, and what the builder recommends

| Topic | Builder's research | Astra's research | Recommended |
| --- | --- | --- | --- |
| When the conversation opens | When the customer **sends** a request (the request's note is the first message; the host can reply before deciding). | Only when the host has **accepted**. Before that, the note that requests already carry is enough; sending a request is too cheap a way to reach a host. | **Astra's: on acceptance.** It is simpler and safer, and the note already exists. A host who needs to ask something can accept and then ask; cancelling before the start is free for a host. "Reply before accepting" can be added later. |
| ID check to message | Not required. | **Both people must have passed the ID check** before they can write, at $1.50 per customer. A written channel that stays open for days is more exposure than one call. | **Founder's decision.** The builder leans to *not* adding it: a customer can already have a private video call without an ID check (decided in the safety module), and written messages are stored and reportable, which a call is not. Hosts who want it already have the "verified customers only" switch. |
| Contact details and links | Allow them; **warn** the sender and flag the message for the founder to look at. | **Refuse** messages with web addresses, emails, phone numbers or payment names, with an explanation. | **Warn, never refuse, and no review queue.** Both studies say filters are easy to get round, and the two people can swap details out loud on the call anyway. Refusing all links would stop a customer sending a link to what they want to talk about. A review queue is work for one founder with little gain. Links are shown as plain text. |
| How long messages are kept | While both accounts exist; deleted 30 to 90 days after an account closes. | Deleted **12 months after sending**. Reported conversations follow their own, longer rule. | **Astra's: 12 months**, to be confirmed by the lawyer. Conversations are short by design, and keeping less is safer. |
| The "missed message" email | After 10 to 15 minutes. | After **5 minutes**; at most one an hour and three a day; its own on/off choice, separate from reminders. | **Astra's.** Messages here are often about timing ("I'm running late"), so sooner is better. |
| A "Seen" label | Show it (it costs nothing). | Leave it out. | **Leave it out.** A host should not feel watched for reading and not answering. |
| Customers in the UK and EU | Consider switching messaging off for them at launch: UK law has no exemption for small services. | Not covered. | **A lawyer question for the whole app, not for messaging.** Private video calls between users are already covered by the same UK law, with or without messages. Nothing to build now; it goes on the launch list. |

## Things only one study raised, all taken

- From Astra: limits on sending (about 10 a minute, 100 a day, and 5 in a row without an answer), an
  emergency switch that stops all sending (next to the two the founder already has), the written
  rules must mention messages and be accepted again, a cancelled call closes the conversation at
  once, and the whole thing is about one to two times the size of module 8.
- From the builder's research: a paid service worth knowing if we ever outgrow our own (Stream,
  free up to 1,000 users), and the launch paperwork: register with NCMEC and write a one-page
  procedure, a contact address for the police, a step for closing the account of anyone found to be
  under 13, and a lawyer's view on the 2025 law about removing intimate images (the "Take It Down
  Act") even though messages are text only.

## Decisions for the founder

1. **When can the two people start writing to each other?** Recommended: once the host has accepted
   the call.
2. **Must a customer pass the ID check before messaging?** Recommended: no, the same rule as for
   the call itself. Astra recommends yes ($1.50 per customer, paid by the company).
3. **How long does the conversation stay open after the call?** Recommended: 7 days.

Everything else above the builder will decide in the plan, as with earlier modules.

## What was decided (14 November 2026)

The founder decided to **leave messaging out of the first version**. The note that already travels
with a request stays as it is, and a customer would not have needed the ID check to message. The
question of 7 days or open for good was left open. If messaging is built later, this page is the
starting point. The decision is recorded in `docs/module-record.md`.
