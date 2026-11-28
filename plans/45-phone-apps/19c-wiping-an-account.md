# Phone apps, part 19c: deleting your own account (the wiping)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 19 and found its list of data far too short;
Astra's second check ("not ready") added more, and all of it is worked in (the list is at the
end). **The table below is the builder's version of a list only a lawyer can settle.** It is
built so that each line is a setting: what the lawyer changes does not need a rebuild. When
this part is merged, the three parts are complete and the founder can switch the button on.
Brought up to date on 27 November 2026, after the website changed: eleven lines were added
to the table and two changed, some of them after Astra's check (the lists are at the end). It goes to Astra again, with parts 19 and 19b, before it
is built.

## For the founder: what this is

The last third of deleting an account: the person's details are wiped, an email says it is
done, and what the law says must be kept is kept without their name where that is allowed.

## What is there today (read in the code)

Nothing wipes an account. *(As it is on 27 November: still true, but there is now a clean-up
by age to build beside, `src/lib/retention.ts`: emails are emptied two years after they were
sent, sign-in records deleted twelve months after they ran out, messages between two people
deleted twelve months after they were sent. The database file has about 2,850 lines.)* The
database (`src/db/schema.ts`, about 2,100 lines when this was written) holds personal
details in many more places than the profile: sign-ins with the device and network address
they came from; the two-step secret; every email ever written to the person, **and emails to
other people that name them**; the note a customer wrote when booking; ratings given and
received; reports and their snapshots; the name from an ID check; connection grades; cards'
references at Stripe; raw copies of what Stripe and LiveKit sent; follows, suggestions shown
and hidden; memberships, invitations and agreements; a project, its posts and pictures;
contributions. Almost every record points to the person's row, and the email address must be
there and must be the only one of its kind. The helper already removes the texts of refund
requests after a year.

## Decisions (the builder's)

1. **The person's row stays, emptied.** Records that must be kept still need something to
   point to. The name becomes "A deleted account"; the email address becomes a made-up one,
   different for every deletion, that no email can reach (so the real address can sign up
   again one day); passwords, sign-ins and one-time links are removed; every other field is
   emptied, or given a harmless value where the database insists on one. The other person of
   a past call sees "a deleted account". **Two fields of the row are never emptied:** the
   mark that the account is closed, and the mark "deleted by its owner" with its date (part
   19, decision 2). They are what keeps every gate shut, what stops the founder's "reopen",
   and what makes the ratings count this person as someone who left. *(Added after Astra's
   second check.)* **A pause that was on the account stays as a mark too** (when it was
   paused), because part 19 promises that deleting lifts no pause; its typed reason is
   moved off the row into the record kept with "Reports about this person, pauses" in the
   table, for as long as that line allows. After a wipe the row shows: closed, deleted by
   its owner, paused or not, and nothing else of the person. *(Added after the third.)*
2. **One table decides, group by group:** *erase* (the rows or the fields are removed),
   *strip* (the record stays, without anything that says who), or *keep* (for a stated reason
   and time).

   | Group | What happens | Why |
   | --- | --- | --- |
   | Sign-ins: sessions with their device and network address, the password, the two-step secret and backup codes, outside sign-ins (Google), one-time links, the counters against too many tries | erase | Nothing needs them |
   | The profile: name, photo and earlier photos, "about", handle, country, languages, price, social accounts with their codes and history, tries at taking a photo | erase (a photo the founder locked for a report is kept with that report) | |
   | The calendar: hours, time off, choices, "available now", and the times kept busy for requests and calls that are gone | erase | |
   | A host's settings: the cancellation rule, "verified customers only", her membership offers, tries at checking a social account's bio, attempts at proving an account by signing in | erase | |
   | The founder's lists that name this host (memberships or projects "for these hosts only") | the name is taken off the lists | |
   | Follows in both directions; suggestions made, seen, opened, hidden, in both directions | erase | |
   | Notes: what she wrote about customers; what hosts wrote about this person | erase | A note about a person is that person's data too |
   | The phones' notification addresses and anything waiting to be sent to them | erase | |
   | Emails written to this person | erase the address, subject, text and the technical details kept with them; keep that one was sent, its kind and date, for a year | Proof a notice was given |
   | Emails to other people that name or quote this person (a refund note, a link to their page) | erase the stored text; keep that one was sent, its kind and date | Taking out a name alone would leave the quoted words |
   | "Do not email this address" | keep the address in a form that cannot be read back, only matched | So a deleted person is not emailed again by mistake |
   | Requests and bookings that never became a paid call, with the note the customer wrote and the card references | erase | |
   | Calls that were paid, added time, and every money record: payments, holds, refunds, collections, the books, disputes, the records of cards used (references only, never numbers) | keep, stripped of free text; the note a customer wrote when booking is erased | Tax and disputes; time for the lawyer to name |
   | Calls that were free or cancelled without money | strip | So the other person's history still makes sense |
   | Ratings this person gave | they stop counting, as the ratings of a closed account already do. **The stars are erased, but the place stays:** an empty marker remains where the rating stood, pointing at the emptied account. *(Changed after Astra's check.)* | Ratings count in fixed groups (the first five people, then three at a time, the most recent fifty or so), and a group with a closed rater in it is left out whole. Taking the row away would move later people into earlier groups and could give one person's stars away. An empty marker keeps every group where it was. A host's shown average can change a little when someone leaves |
   | Ratings this person received | erase | |
   | Time in calls, connection grades | erase when the time for a refund is over | Evidence for refunds only |
   | Connection checks | nothing to do: they are removed after 24 hours already | |
   | Refund requests and answers | keep the amounts; the texts and the connection record are erased at once, **unless a request or a bank dispute about that call is still open: then those are kept until it is closed, and only those** | An open case still needs its evidence |
   | Reports made *by* this person | keep, stripped of who made them, while the report matters | The reported person's file |
   | Reports *about* this person, pauses, blocks made *against* them, what the founder decided and noted | keep for a time the lawyer names (the builder's first value: 3 years) | Safety; whether Connect may use them to recognise a returning person is the lawyer's question |
   | Blocks this person made | erase | |
   | The ID check: the name on the ID, the result | erase the name; keep "passed, on this date" only if the lawyer says a host's age check must be provable; ask Stripe to remove its copy | |
   | Stripe: the customer record and saved cards; the payout account | cards and the customer record removed at Stripe; the payout account is closed at Stripe when Stripe allows it (part 19b) | |
   | Raw copies of what Stripe and LiveKit sent | erase after the time needed to settle money (a setting) | They repeat personal details |
   | Memberships, months, agreements, invitations | paid months kept as money records; invitations never accepted erased; the agreement kept, with its date, while the money records are | |
   | A project, its posts and pictures | the name, description, posts and pictures erased (a picture held for a report is kept with it). If a contribution to it was ever paid, or an attempt at one is not yet settled at Stripe, an empty shell of the project stays, because the money record must point to something; while a bank dispute over such a payment is open, what its proof needs is set aside first (decision 3b) | |
   | Contributions | paid ones kept as money records, with their agreement and date; an unpaid attempt is erased **only once its outcome at Stripe is settled** (an attempt given up here can still have been charged there). *(Changed after Astra's check.)* | |
   | The founder's record of actions on this account | keep | The founder's own accountability |
   | *Added 27 November.* Messages between a host and a customer (plan 49): the conversations, what this person wrote, their switch for one host | the conversation is closed at the lock, and from that moment the other person sees "a deleted account" in place of the name (the reader looks names up, so the name is hidden there at once, before the wipe); this person's own messages are erased with the wipe; the other person keeps what they wrote themselves until the twelve months every message has | What someone wrote is theirs. Whether the other person may keep reading it is **for the lawyer**; the builder's first value is no |
   | *Added.* Messages kept for a report (`report_conversations`) | keep with that report, for as long as the report is kept | The report's evidence |
   | *Added.* Messages "From Connect" to this person | as "Emails written to this person" above: the text is erased, that one was sent stays | |
   | *Added.* The record that a notice email arrived (plan 46, part 3a), and what ties a delivery report to its email | keep with the fact that the email was sent. **While a debt of hers is open, also everything its deadlines hang on:** the notices still to be sent, and the email service's number for each one, without which a delivery or a bounce cannot be matched | A deadline was counted from it, and the next one will be |
   | *Added.* Acceptances of the legal documents: which document, which version, when | keep while the money records are kept | Proof of what was agreed; time for the lawyer to name |
   | *Added.* Money a host owes back, what was taken by hand, the helper's own tries to collect for her | keep as money records. **An open one is a named open case** (decision 3), and her email address is kept for it alone until it is over (part 19b, decision 8) | Tax, and a debt that is not finished |
   | *Added.* A request to cancel a membership within 14 days | finished first (part 19, decision 6a); then kept with that membership's money records | |
   | *Added.* Tips given and received | paid ones kept as money records, like contributions; an unpaid attempt erased only once its outcome at Stripe is settled | |
   | *Added.* A refund or a pay-back to a card that is owed, on its way or stuck | keep, with what is needed to finish it, until it is paid or a person has closed it. A named open case | Money that is someone's |
   | *Added.* Request keys that were used (the customer, the key, the time), among them the record that a key made **no** booking | erase with the wipe: the account can never send anything again (its lock is permanent, decision 1), so nothing is left that a kept key could stop | They name the customer. They exist so that a request sent late cannot be made twice, or made after it was found not to exist |
   | *Added.* A warning about ratings, a pause the app made, the date of a "fresh start" | keep with "Reports about this person, pauses" above | Safety |

3. **When:** as soon as parts 19 and 19b are finished for this person, and **in any case no
   later than the time promised on the confirmation screen for everything that is not tied to
   a named open case** (an open dispute or refund request, money that could not be sent yet).
   What is tied to such a case is wiped when the case closes, and the case is written down
   with its reason. The promised time is a setting; the builder's choice is 30 days. The
   stores ask for "reasonably quick" and for the reasons for keeping anything to be told;
   neither names a number, so this is **for the lawyer**.
   *Added 27 November:* money a host owes back, a refund or pay-back that is not finished,
   and a 14-day request that a rule stops are named open cases too (parts 19 and 19b).
3b. **What is kept for an open case is decided case by case, and set aside before anything
   it is made from is wiped** *(added 27 November, after Astra's check)*. The table erases
   names, time in calls and refund texts on different days, but the proof Connect sends a
   bank is put together from exactly those (`src/lib/disputes/evidence.ts`). So for each
   kind of open case the least that is needed is listed (**for every bank dispute, whatever was paid for:** the customer's real name, email
   address and the day the account was opened, the host's name, what each had accepted of
   the legal documents, and the customer's earlier payments that were not disputed; **and
   then by kind:** for a call, the time in the call, the refund request and its answer; for
   a membership month, the agreement and the month's own facts; for a contribution or a
   tip, the payment's facts and the project's name or the call it belonged to; and in each
   case what was already sent to the bank, as the proof for each kind is built
   today in `src/lib/disputes/evidence.ts`; a debt: the notices, her objection, our answer,
   her address), copied into the
   case before the wipe touches its sources, and erased when the case closes. **Copies that
   live elsewhere are covered by the same closing:** what was sent to the bank, the texts of
   an objection and its answer, words quoted in a report, and messages written to *other*
   people that name this person (one of the team's own messages holds a customer's name and
   email address). So are subjects and links that still identify someone, and the address
   kept for the last email of decision 4.
3a. **Coming back with the same email address** *(added 27 November; rewritten after Astra's
   check; open, for the founder and the lawyer)*. Decision 1 lets the real address sign up
   again as a new, empty account. Four different things would be shed by that, and they
   are not alike:
   - **A stop on new payments** (plan 47): while a bank dispute of theirs is open, and after
     one they won against Connect's proof. It stops only new agreements to pay; the first
     ends with the dispute, the second can be lifted by the founder.
   - **A pause of the account.** It stops booking, hosting and joining calls, pauses
     memberships, and is lifted by a person on the team.
   - **A block another person made against them.** It stands between two accounts, so a new
     account with the same address is outside it. This one is not Connect's restriction but
     another person's wish not to be reached, and is asked about on its own.
   - **Histories that count toward a rule:** reports and low ratings toward a pause by the
     app (plan 52), and a customer's recent calls toward the guard of "End call now" (plan
     51). Both start again from nothing under a new account.
   Whether any of these may follow a person to a new account, in what form, and how each
   would be lifted there, is asked for each one by itself. The first version of this
   decision proposed that such an account simply begins paused; that would have turned a
   stop on payments into something much wider, and is withdrawn. **Nothing is built before
   the founder and the lawyer have answered,** and until then a returning address gets a
   new, empty account, as decision 1 says.
4. **An email, "Your Connect account has been deleted",** is sent after the wipe has
   succeeded. For that one message the address is held apart, used once, and then removed
   too. Both stores ask that the person is told when it is done.
5. **Emails still waiting to be sent are dealt with before their text is erased.** An email
   to another person that names the deleted one (a call was cancelled, a request ended) is a
   notice that person needs. So the wipe waits until each such email has been sent, or has
   been given up on by the sender's own rules, and only then erases its text. No email ever
   goes out with its text already removed. Emails waiting for the deleted person themselves
   are cancelled, except the last one of decision 4 **and everything that belongs to an
   open case** (a debt's notice, our answer to an objection, what a bank dispute still has
   to tell them): those are sent, to the address kept for that case. **That includes the last notice of a
   case:** it is queued in the same step that closes the case, so a wipe that looked only
   for "open" cases would find the case closed and cancel its closing notice. The address
   goes when that notice has been sent, or given up on by the sender's own rules. The clean-up by age
   leaves the same things alone while the case is open; in particular it does not clear
   the email service's number of a notice whose delivery a deadline hangs on
   (`src/lib/retention.ts` clears it today after two years).
6. **The yearly clean-up of refund texts is put right on the way.** Today it clears the texts
   of every refund request older than a year, one that is still open included, and a check
   script expects that. An open request, or one whose bank dispute is open, must keep its
   texts until it is closed, on the website as well; the clean-up and its check are changed
   to say so.
7. **Outside companies** that hold copies are asked to remove theirs where they offer a way:
   Stripe (the ID check, the customer record), and the email and video services as far as
   their terms allow. What they keep under their own duties is named on the privacy page.
8. **The wipe is done by the helper, group by group, each written down when done,** and can
   be run again safely. A check counts, after a wipe, every place in the database where the
   person's name, email address or account number can still be found, and each one must be
   on the "keep" lines above.

## How it is tried

- `scripts/delete-account-check.ts` grows: an account with something in **every** group above
  (the script makes it), deleted and wiped; then, group by group, what is gone and what is
  left; the search of decision 8 finds nothing outside the "keep" lines; an email to another
  person that was still waiting is sent whole before its text is erased, and none is sent
  with its text removed; a refund request older than a year that is still open keeps its
  texts, and loses them when it is closed; the old email
  address can sign up again as a new, empty account; two deletions get two different made-up
  addresses; the other person's view of old calls; after a rater is deleted nobody can work
  out what they gave, and the average follows today's rule for a closed account; an open
  refund request keeps its texts until it is closed and then loses them; a paid contribution
  still has its empty project to point to; the email arrives after the wipe; a wipe stopped
  halfway and run again; a person's own messages are gone and the other person's stay, a
  message kept for a report is still with that report; a host's open debt keeps her address
  until it is over and not a day longer; the acceptances are still there; the clean-up by
  age (`runRetention`) neither brings back nor trips over anything a wipe removed; a host's
  average before and after one of her raters is wiped, with that rater in the first group
  of five, in a later group of three, and at the edge of the most recent fifty (no other
  person's stars can be worked out from the change); a bank dispute opened before the wipe
  can still be answered with full proof after it, and that proof is gone once the dispute
  is closed; a delivery report that arrives after the wipe still finds its notice; an
  unpaid attempt that Stripe charged after all is still there to be put right; after the
  wipe the account is still closed and still marked as deleted, the founder's "reopen"
  refuses it, and its ratings still count as a leaver's; an account that was paused when it
  was deleted is still marked paused after the wipe, with its typed reason gone from the
  row and present in the kept record; a debt settled a minute before the wipe still gets
  its closing notice; a bank dispute over a membership month, and one over a contribution,
  answered after the customer was wiped, carry the customer's real name and not "a deleted
  account"; a debt's notice that was waiting
  at the wipe is sent to the kept address, and its delivery report still starts the 14
  days; a bank dispute over a membership month, and one over a contribution, opened before
  the wipe, can each be answered with full proof after it.
- Every existing check script green, and unchanged **but for one line that is meant to
  change:** `refunds-check` today expects the texts of a refund request that is still open
  to be gone after a year. Decision 6 says they must stay until the request is closed. That
  line is turned round, and a second one checks that they go once it is closed.

## Astra's second check (20 November 2026): "not ready", now worked in

1. *The made-up address must be different each time, and sign-ins must go.* Decision 1.
2. *A paid contribution needs its project to exist.* The table: an empty shell stays.
3. *An open refund request or dispute still needs its evidence.* The table and decision 3.
4. *"A host's average must not change" was a promise the rating rules cannot keep,* and a
   kept rating would point to its author. The table follows today's rule instead.
5. *Lines that were missing:* busy times, added time, a host's settings and offers, bio-check
   and sign-in attempts, the founder's lists of named hosts, card records, unpaid
   contribution attempts, the rest of what an email row holds, quoted words in other people's
   emails. Added. Connection checks already remove themselves.
6. *The email must come after the wipe, and 30 days is not something the stores bless.*
   Decisions 3 and 4.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

The whole table: which lines must be erased, which may be kept, for how long each; the 30
days; whether reports and pauses may be used to recognise a returning person; what outside
companies must be asked. *Added 27 November:* the same question for each of the four things
of decision 3a (a stop on new payments while a bank dispute is open or after one the
customer won, a pause, another person's block, and the histories that count toward a
rule); whether the other person of a conversation may keep reading
what a deleted person wrote; how long acceptances of the legal documents are kept.

## Keeping the 4.9%

No purchase.

## Brought up to date (27 November 2026)

Read again against the database as it is on `main` after pull request 123. Since this was
written the database gained, among others, these tables: acceptances of the legal documents,
messages "From Connect", bank disputes, money a host owes back and what was taken by hand,
the helper's own collection tries, conversations and their messages, messages kept for a
report, and request keys that were used. What changed in this plan:

1. *Eleven lines were added to the table,* each marked "Added", two of them after Astra's
   check; and two older lines were changed (ratings given, contributions).
2. *A host's open debt is a named open case* that keeps her email address. Decision 3.
3. *Coming back with the same address would shed a pause or a stop on payments.* Decision 3a,
   open, for the lawyer.
4. *A clean-up by age exists now.* "What is there today" and the check script.

The table was the builder's version of a list only a lawyer can settle, and it still is. It
goes to Astra with parts 19 and 19b before any of them is built.

## Astra's check of this update (27 November 2026): "not ready", worked in

1. *Erasing a rating moves the groups and can give another person's stars away.* The table's
   line for ratings given: the stars go, the place stays.
2. *Wiping a notice's delivery record would break a debt's deadline.* The table, and
   decision 3b.
3. *The table could wipe the very things an open case's proof is made from, while copies
   stayed elsewhere.* Decision 3b.
4. *An unpaid attempt can have been charged outside.* The lines for contributions and tips.
5. *A refund that is not finished is someone's money.* A line of its own.
6. *Request keys name the customer.* A line of its own.
7. *"Begins paused" would have turned a stop on payments into a pause.* Decision 3a,
   rewritten and left open.
8. *When does the other person of a conversation stop seeing the name?* The table: at the
   lock.

## Astra's second check (27 November 2026): "not ready", worked in

1. *Decision 5 cancelled the very notices an open debt needs, and the clean-up by age would
   clear what ties a delivery to its notice.* Decision 5.
2. *The wipe would have emptied the lock itself.* Decision 1: two fields stay.
3. *The proof for a dispute differs by what was paid for.* Decision 3b names each kind; the
   project's line in the table.
4. *Another person's block, and an open bank dispute, were missing from the question about
   coming back.* Decision 3a.
5. *A request key is a record against a repeat, not a guard of something unsettled.* Its line.

## Astra's third check (27 November 2026): "not ready", worked in

1. *The proof for every kind of dispute needs the people's real details, not only a call's.*
   Decision 3b.
2. *A case's closing notice is queued after the case closes, and would have been cancelled.*
   Decision 5.
3. *What becomes of a pause on a deleted account* was said three ways. Decision 1.
4. *"Every existing check unchanged" contradicted decision 6.* "How it is tried" names the one
   line that changes.
5. *The question about coming back has four things in it, not three,* and the lawyer is asked
   about all four.
