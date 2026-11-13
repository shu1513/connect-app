# Plan: Module 8 — Ratings, search, contacts and host notes

**Status: final. Astra checked the first draft on 13 November 2026 (verdict: build with changes; 11 findings). Taken: a call can be rated only when its record is final and shows at least 2 minutes together (the draft's "both joined" could be two people who never overlapped, and its early opening on "room empty" was unsafe because a room can start again); admin test calls cannot be rated; the shown average moves only in steps of 3 ratings, and needs 3 different people, so one rating cannot be read off it; ratings given by an account the founder has closed stop counting; the giver, the receiver and the role always come from the server; search handles underscores, special characters, paused hosts and blocks inside the query; contacts and notes are checked in the shared server code, notes are one-way, and links never reveal a hidden profile. Not taken: storing eligibility separately, and holding ratings back when records change after the fact (machinery for very rare cases); a separate admin screen for removing ratings (closing the account does it). From module 5 on the builder decides after Astra's check and records the decisions in `docs/module-record.md`. Messaging, the fifth part of this module on the roadmap, is not in this plan: the founder asked for a separate research round first (the builder and Astra each research how to do it, then compare), so it follows as module 8b.**

Everything so far is about one call: finding a time, paying, talking. This module is about what is
around a call. After it, both people say how it went. Before it, a customer can find a host without
being handed a link. And each person can see who they have talked to, with the host able to keep a
private note about each customer.

Nothing here touches money, the call room or the booking rules.

## What this module must prove

1. After a call that really happened, each person can rate the other once, from 1 to 5 stars, and nobody can rate a call they were not in or that did not happen.
2. A rating cannot be used to hit back: neither person learns what the other gave, and a rating only starts to count once both have rated or the time to rate is over.
3. A host's average is shown on their page and in search; a customer's average is shown to a host who is deciding on their request. A single rating can never be read off an average.
4. A customer can find a host by name, by handle, or by a confirmed social media name, and never finds a host who is hidden, not approved, paused, closed, or blocked either way.
5. Each person can see the people they have had calls with. A host can keep a private note about a customer that nobody else can ever see.

## Decisions (with the builder's recommendation)

1. **Which calls can be rated, and when.**
   Decided: a call can be rated when its record is **final and complete and shows at least 2 minutes together** (the same record the charge is worked out from), it came from a real request or a "call now" (not the admin test page), it was not cancelled, and it was not ended with "End call and report" (that goes to the founder as a report, not into stars). Rating opens when the record is final, a few minutes after the booked end; until then the page says so. It stays open for **7 days** after the booked end. One rating per person per call (a rule in the database). A rating cannot be changed once given. Who gives it, who receives it and in which role are always taken from the call on the server; the browser sends only the call and the stars.

2. **What a rating is.**
   Recommended: **1 to 5 stars and nothing else.** No written review. Text needs moderating, invites arguments, and is not needed for the number to do its job. Someone with something serious to say has "Report", which a person reads.

3. **Who sees what (the Uber way the founder asked for).**
   Recommended: **nobody ever sees the rating one particular person gave them.** Each person sees only their own rating of the other ("You gave 5 stars"), and averages.
   - A rating starts to count toward an average only when **both people have rated that call, or the 7 days are over**. So nobody can wait to see what they got before deciding what to give. Nobody is shown whether the other person has rated yet.
   - An average is shown only once ratings from **at least 3 different people** count. Before that the page says "New".
   - The shown average **moves only in steps of 3 ratings**: with 3, 4 or 5 counted ratings it is the average of the first 3; with 6, 7 or 8, of the first 6. The number shown beside it is that same 3 or 6. So the average never changes because of one rating alone, and one person's rating cannot be worked out from it. (Astra's finding: "5.0 from 3" becoming "4.8 from 4" would have given the fourth rating away.)
   - Ratings given by an account the founder has closed do not count while it is closed.
   - A person has two separate averages: as a host (from customers) and as a customer (from hosts). A customer's average is shown only to that customer and to a host they have sent a request to.

4. **Where the averages appear.**
   Recommended: the host's average and number of ratings on their public page and in search results. The customer's average next to their name wherever a host answers them: the request page, the list of requests, and the live "Available now" panel. A person sees their own two averages on their account page.

5. **Search.**
   Decided: one search page, open to anyone like the host pages are. One box. It finds hosts whose **display name, handle, or confirmed social media name** contains what was typed (at least 2 characters, at most 50; capital letters, a leading @, spaces and underscores do not matter; characters that mean something special to the database are treated as plain text). Only confirmed social names count, since only those are proven. Up to 20 results, no total and no further pages: an exact match of a handle or social name first, then names that start with what was typed, then the rest, then by name. Each result shows the name, handle, price, average, and the confirmed social names.
   Never in the results: a host who is hidden, not approved, paused or closed, and, for someone who is logged in, a host they have blocked or who has blocked them. These rules are part of the search itself, applied before anything is ordered or cut to 20. (Blocking stops contact; it does not make a public page invisible to someone who logs out.)
   No browsing without typing, and no filters, in this module.

6. **Contacts.**
   Decided: a page "People you have talked to", worked out from calls that are over, were not cancelled, did not come from the admin test page, and that both people joined. Nothing new is stored for it. One line per person, whichever role each had: their name, how many calls, when the last one was, and a link to their host page only if that page is public right now (so a hidden or unapproved page is never revealed). People blocked either way, and closed accounts, are not listed. A person's email is never shown.

7. **Host notes.**
   Decided: on the contacts page, and on a request from that customer, a host can write and edit one private note per customer (up to 1,000 characters, plain text). Only that host can ever read it: not the customer, not other hosts, and there is no admin screen for it. It is shown to the host again when that customer asks for a call. The rule is one-way and lives in the shared server code: a note can be written only by someone about a person who was their customer in a call, or who really sent them a request (not a request abandoned at the card step, not a test call). While either has blocked the other, or the customer's account is closed, the note is kept but cannot be read or changed.

8. **Reminding people to rate.**
   Recommended: no email. The results page a person lands on after a call asks them to rate, and the home page lists calls still waiting for their rating. An email can be added with the notifications if too few people rate.

## Decisions already made (carried over)

- Hosts and customers are roles on a call, not kinds of account. One account can have both averages.
- Nothing is deleted when an account is closed; its ratings keep counting, and it no longer appears in search or contacts links.
- The founder's emergency switches, payments, the call room and the booking rules are untouched.

## How it works

**After a call.** Both people land on the call's results page. At the top: "How was your call with Hana?" and five stars. One click and a "Send" button. Afterwards it says "You gave 5 stars. Hana will not see what you gave." The home page shows "Rate your call with Hana" until it is done or the 7 days are over.

**On a host's page.** Under the name: "4.8 from 23 ratings", or "New" below three.

**For a host answering a request.** Next to the customer's name: "4.9 from 12 ratings as a customer", or "New". Below it, the host's own private note about them, if there is one.

**Search.** A box on the home page and at `/search`. Typing "hana" or "@hana_host" or her Instagram name finds her.

**Contacts.** "People you have talked to": a list. For a host, each customer has a note box.

## What gets built, in order (small steps, each checked before the next)

1. **The rules as plain logic, tested on their own:** when a call can be rated; when a rating counts; when an average is shown; how a search query is cleaned and results ordered.
2. **Tables:** ratings (call, who rated, who was rated and in which role, stars); host notes (host, customer, text). One rating per person per call is a rule in the database.
3. **Ratings:** giving one; the averages; the results page; the home page prompt; the averages on the host's page, the request pages and the live panel; the account page.
4. **Search:** the query, the page, the box on the home page, the average and matched social name in results.
5. **Contacts and host notes:** the page, the note on a request.
6. **Journeys, README, the module record.**

## What we store

- **Ratings:** which call, who gave it, who received it, the role they received it in (host or customer), the stars, when. At most one per call per giver.
- **Host notes:** the host, the customer, the text, when it was last changed. One per pair.
- Nothing for search or contacts: both are read from what exists.

## How we test it

- **Automatic tests** for the plain rules in step 1.
- **A script of real journeys** (`scripts/ratings-check.ts`) against the local database: a call both joined can be rated by each once and not twice; a stranger cannot rate it; a cancelled call, a call only one person joined, and a call ended with "End call and report" cannot be rated; not before the call is over, not after 7 days; a rating does not count until the other person rates or the 7 days pass; an average appears only from 3 counted ratings; host and customer averages are separate; search by name, handle, social name, with @ and capitals, and never a hidden, pending, paused, closed or blocked host; an unconfirmed social name does not match; contacts lists only people from calls that happened and hides blocked ones; a note can be written only by a host about their own customer, and nobody else can read it.
- **All earlier journeys and tests still pass.**
- **In a browser:** rate a call from both sides; search; write a note.

## Not in this module

- Messaging (module 8b, after its research round).
- Written reviews, replies to ratings, changing a rating, a screen for the founder to remove one rating (closing an abusive account already stops its ratings counting), detecting two accounts that rate each other up.
- Browsing hosts without searching, filters, sorting by price or rating, "available now" in search.
- An email asking people to rate.
- Customers keeping notes about hosts.

## What the automatic checks cannot test

- Whether people actually rate, and whether "New" below three ratings feels right. That needs real use.
- Search quality on a large number of hosts. With many hosts the search will need a proper index; with few it does not.

## Before launch

- A limit on how often one visitor can search (the app has no general rate limiter yet; search is the first page where a logged-out visitor makes the database work).
