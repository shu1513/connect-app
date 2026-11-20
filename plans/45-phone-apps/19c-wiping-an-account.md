# Phone apps, part 19c: deleting your own account (the wiping)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 19 and found its list of data far too short;
Astra's second check ("not ready") added more, and all of it is worked in (the list is at the
end). **The table below is the builder's version of a list only a lawyer can settle.** It is
built so that each line is a setting: what the lawyer changes does not need a rebuild. When
this part is merged, the three parts are complete and the founder can switch the button on.

## For the founder: what this is

The last third of deleting an account: the person's details are wiped, an email says it is
done, and what the law says must be kept is kept without their name where that is allowed.

## What is there today (read in the code)

Nothing wipes an account. The database (`src/db/schema.ts`, about 2,100 lines) holds personal
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
   a past call sees "a deleted account".
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
   | Ratings this person gave | they stop counting, as the ratings of a closed account already do, and are erased | Today each rater counts once, in whole groups of three, so nobody can tell who gave what; a kept rating tied to its call would point to its author. A host's shown average can therefore change a little when someone leaves |
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
   | A project, its posts and pictures | the name, description, posts and pictures erased (a picture held for a report is kept with it). If a contribution to it was ever paid, an empty shell of the project stays, because the money record must point to something | |
   | Contributions | paid ones kept as money records, with their agreement and date; unpaid attempts erased | |
   | The founder's record of actions on this account | keep | The founder's own accountability |

3. **When:** as soon as parts 19 and 19b are finished for this person, and **in any case no
   later than the time promised on the confirmation screen for everything that is not tied to
   a named open case** (an open dispute or refund request, money that could not be sent yet).
   What is tied to such a case is wiped when the case closes, and the case is written down
   with its reason. The promised time is a setting; the builder's choice is 30 days. The
   stores ask for "reasonably quick" and for the reasons for keeping anything to be told;
   neither names a number, so this is **for the lawyer**.
4. **An email, "Your Connect account has been deleted",** is sent after the wipe has
   succeeded. For that one message the address is held apart, used once, and then removed
   too. Both stores ask that the person is told when it is done.
5. **Outside companies** that hold copies are asked to remove theirs where they offer a way:
   Stripe (the ID check, the customer record), and the email and video services as far as
   their terms allow. What they keep under their own duties is named on the privacy page.
6. **The wipe is done by the helper, group by group, each written down when done,** and can
   be run again safely. A check counts, after a wipe, every place in the database where the
   person's name, email address or account number can still be found, and each one must be
   on the "keep" lines above.

## How it is tried

- `scripts/delete-account-check.ts` grows: an account with something in **every** group above
  (the script makes it), deleted and wiped; then, group by group, what is gone and what is
  left; the search of decision 6 finds nothing outside the "keep" lines; the old email
  address can sign up again as a new, empty account; two deletions get two different made-up
  addresses; the other person's view of old calls; after a rater is deleted nobody can work
  out what they gave, and the average follows today's rule for a closed account; an open
  refund request keeps its texts until it is closed and then loses them; a paid contribution
  still has its empty project to point to; the email arrives after the wipe; a wipe stopped
  halfway and run again.
- Every existing check script unchanged and green.

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
companies must be asked.

## Keeping the 4.9%

No purchase.
