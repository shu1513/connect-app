# Phone apps, part 19b: deleting your own account (the wiping)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 19 and found its list of data far too short.
**The table below is the builder's first version of a list only a lawyer can settle.** It is
built so that each line is a setting: what the lawyer changes does not need a rebuild.

## For the founder: what this is

The second half of deleting an account: once calls and money are settled (part 19), the
person's details are wiped, a last email says so, and what the law says must be kept is kept
without their name where that is allowed.

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
   point to. The name becomes "A deleted account", the email address becomes a made-up one
   that belongs to nobody (so the real address can sign up again one day), and every other
   field of the row is emptied. The other person of a past call sees "a deleted account".
2. **One table decides, group by group:** *erase* (the rows or the fields are removed),
   *strip* (the record stays, without anything that says who), or *keep* (for a stated reason
   and time).

   | Group | What happens | Why |
   | --- | --- | --- |
   | Sign-ins: sessions with their device and network address, the password, the two-step secret and backup codes, outside sign-ins (Google), one-time links, the counters against too many tries | erase | Nothing needs them |
   | The profile: name, photo and earlier photos, "about", handle, country, languages, price, social accounts with their codes and history, tries at taking a photo | erase (a photo the founder locked for a report is kept with that report) | |
   | The calendar: hours, time off, choices, "available now" | erase | |
   | Follows in both directions; suggestions made, seen, opened, hidden, in both directions | erase | |
   | Notes: what she wrote about customers; what hosts wrote about this person | erase | A note about a person is that person's data too |
   | The phones' notification addresses and anything waiting to be sent to them | erase | |
   | Emails written to this person | erase the text; keep that one was sent, its kind and date, for a year | Proof a notice was given |
   | Emails to other people that name this person | strip the name from the stored text | |
   | "Do not email this address" | keep the address in a form that cannot be read back, only matched | So a deleted person is not emailed again by mistake |
   | Requests and bookings that never became a paid call, with the note the customer wrote and the card references | erase | |
   | Calls that were paid, and every money record: payments, holds, refunds, collections, the books, disputes | keep, stripped of free text; the note a customer wrote when booking is erased | Tax and disputes; time for the lawyer to name |
   | Calls that were free or cancelled without money | strip | So the other person's history still makes sense |
   | Ratings given and received | keep the number, without who gave it | A host's average must not change because someone left |
   | Time in calls, connection grades, connection checks | erase after the refund time is over (the helper already clears them on its own schedule) | Evidence for refunds only |
   | Refund requests and answers | keep the amounts; texts erased (already after a year; at once on deletion) | |
   | Reports made *by* this person | keep, stripped of who made them, while the report matters | The reported person's file |
   | Reports *about* this person, pauses, blocks made *against* them, what the founder decided | keep | Safety; whether Connect may use them to recognise a returning person is the lawyer's question |
   | Blocks this person made | erase | |
   | The ID check: the name on the ID, the result | erase the name; keep "passed, on this date" only if the lawyer says a host's age check must be provable; ask Stripe to remove its copy | |
   | Stripe: the customer record and saved cards; the payout account | cards and the customer record removed at Stripe; the payout account is closed at Stripe once nothing is owed | |
   | Raw copies of what Stripe and LiveKit sent | erase after the time needed to settle money (a setting) | They repeat personal details |
   | Memberships, months, agreements, invitations | paid months kept as money records; invitations never accepted erased; the agreement kept, with its date, while the money records are | |
   | A project, its posts and pictures; contributions | the project, posts and pictures erased (a picture held for a report is kept with it); contributions that were paid kept as money records | |
   | The founder's record of actions on this account | keep | The founder's own accountability |

3. **When:** as soon as part 19's steps are all finished, and never later than the time
   promised on the confirmation screen, unless money is still being settled; then everything
   that does not need to wait is wiped at the promised time and the rest when the money is
   done. The promised time is a setting; the builder's choice is 30 days (**for the lawyer**).
4. **A last email, "Your Connect account has been deleted",** is sent just before the address
   is wiped. Both stores ask that the person is told when it is done.
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
  address can sign up again as a new, empty account; the other person's view of old calls; a
  host's average rating unchanged; the last email; a wipe stopped halfway and run again.
- Every existing check script unchanged and green.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

The whole table: which lines must be erased, which may be kept, for how long each; the 30
days; whether reports and pauses may be used to recognise a returning person; what outside
companies must be asked.

## Keeping the 4.9%

No purchase.
