# Plan 26: Projects, part three: the ask, and joining it up

**Status:** built, 19 November 2026 (see "What building this part added to this plan" at the
end). Written 18 November 2026 by the builder alone (no
helper agents), from the code as it was on `main` after pull request 41 and from plans 24 and 25,
which this part is built on top of. Astra checked it once: "ready with changes", three must-fix
points and three details, all worked in below (the list is at the end).

**The rulebook is `plans/23-projects.md`.** This plan builds its part three ("The three parts").
It states no rule of its own, and it adds no money rule: everything here reads what parts one and
two built. If building those parts changes something this plan relies on, this plan is updated
and the change checked before part three is built.

## For the founder: what this part is

Part three is the small one. It adds the two places where a customer meets a host's project
without looking for it:

- **the box after a call**, on the customer's page of that call's results;
- **the box on the host's page**, which part one already draws, now knowing whether the visitor
  contributes.

And it adds the check that walks the whole feature the way two real people would: a host who
starts a project, writes posts and collects, and a customer who has a call, sees the box,
contributes, cancels and stops.

When it is merged the feature is complete, and on for every host, as the rulebook says (choice
F). Whether it may go live is the rulebook's "Before this can go live".

**One pull request.**

## What it relies on (each read in the code by the builder)

- **Where a customer is after a call.** The call screen and the call's page link to
  `/calls/[id]/results` (`src/app/calls/[id]/call-room.tsx:383`, `page.tsx:81`). That page is
  where the rating is given, where a refund is asked for, and where "Book another call" already
  stands for a customer (`src/app/calls/[id]/results/page.tsx:203`).
- **What that page already knows** when it is drawn: who the viewer is in this call (`role`,
  `:54`); whether the call was cancelled or ended with "End call and report" (`call.cancelledAt`,
  `call.safetyEndedAt`); the call's record and whether it is final (`loadAttendance`, `:59`,
  `result.status`, `result.totals`); the refund request, if there is one (`requestViewOf`, `:80`);
  whether the host's page can be opened and whether either has blocked the other (`bookAgain`,
  `:114`, through `publicProfile` and `isBlockedEitherWay`).
- **"Book another call" is not the same question.** It asks whether the host's page is open,
  nobody is blocked, and the call was not ended with a report. The box asks more, so it gets a
  function of its own and does not borrow that answer.
- **An open host page says nothing about a pause:** `publicProfile` does not look at it
  (`src/lib/profiles/profiles.ts:237`). And the host's page can be opened by a member or an
  invited person even while it is hidden from everyone else (`src/app/h/[handle]/page.tsx:41`).
- **Reports** name the reporter and the reported person, whatever they were about
  (`src/db/schema.ts`, `reports`), so "has either reported the other" is one question to that
  table.
- **From part one:** `runningProjectOf(hostId)`, `projectsOnFor(hostId)`, and the box on
  `/h/[handle]` with the project's name and latest post.
- **From part two:** a person's contributions to a project and their payments, with their states;
  and `mayContribute(viewer, project)`, the one function that says whether this person may
  contribute to this project right now (plan 25, choice 4).
- **The journey check for memberships** (`scripts/membership-journey-check.ts`) signs real people
  up, fetches every page with that person's login, posts each form as the page drew it, pays with
  one of Stripe's test cards the way a browser would, and runs the waiting with a later clock. It
  needs the app running.

## The box after a call

**One function decides,** `askAfterCall` in `src/lib/projects/ask.ts`. The page hands it what it
has already loaded and draws the box only if it gets a project back. It gives nothing back unless
every one of these is true, each read from what is recorded, not guessed:

| The rulebook's condition | Read from |
| --- | --- |
| The viewer is the customer of this call | the page's `role` |
| The call took place | not cancelled; its record is final and complete; the two were in the room together for more than zero seconds. Nothing else about the call matters: a booked call, an "available now" call, a free call and one paid from a membership all count. A record that needs review does not. |
| It was not ended with "End call and report" | `call.safetyEndedAt` is empty |
| Neither has reported the other | no report, open or closed, about anything, with these two as reporter and reported in either direction. A report of one of her posts counts: it names her. |
| Neither has blocked the other | `isBlockedEitherWay` |
| The customer has not asked for a refund of that call | no refund request for this call, whatever became of it (also one that was declined or closed) |
| The host has a project that is running, and this customer could contribute to it | `runningProjectOf`; her page is open to everyone (`publicProfile`); and `mayContribute` says yes: neither is paused, nobody is blocked, the switch covers her, and she offers at least one kind |
| The customer does not already contribute to it | no monthly contribution of theirs to this project that is being set up or running, and no payment of theirs to it that was ever held or taken. So someone who gave once, someone who stopped a monthly contribution, and someone who was refunded are not asked again for the same project. The project's own page still lets them contribute. (This reading of "already contributes" is written into the rulebook with this plan.) |

While the call's record is not final yet (the first minutes after a call), there is no box. It
appears when the page is opened or refreshed after that, like the rating.

**What it shows.** A box under the rating: "*Name* is working on *project*", the first 200
characters of the description, and "See the project", which leads to the diary and its
"Contribute" part. No amount, no button that pays, no pop-up. Nothing is written when the page is
drawn, and nothing remembers that the box was shown.

**Who never sees it:** the host, the founder looking at a call, and anyone for whom one condition
fails. For them the page is exactly as it is today.

## The box on the host's page

Part one draws it for everyone: the project's name, the first lines of the latest post, "Read the
diary". It is drawn only when the host's page is open to everyone. A member or an invited person
who can open a hidden host page does not see the project there; part one's rule for that is not
loosened.

Part three adds one line, for a signed-in visitor:

- they contribute monthly: "You contribute $X a month", with a link to their contribution;
- they began and did not finish the card step: "Finish contributing", with the same link;
- neither, and `mayContribute` says yes: "Contribute", leading to the diary's "Contribute" part;
- otherwise nothing. The diary stays readable.

The diary page shows the same line in its "Contribute" part, so the two never disagree: both ask
one function, `contributionOf(viewer, project)`.

## The check of the whole journey

`scripts/project-journey-check.ts`, built like the membership journey check, with its own copies
of that script's small helpers (the existing script is not changed). Real: sign-up, every page
and every button, the payments at Stripe's test mode, the emails written. Pretended: the host's
approval, that the two had a call (written with a final record), the picture checkers
(stand-ins), and the waiting (run with a later clock by the helper's own functions; the clock is
set from each hold's own end at Stripe, since a real hold has a real end).

Collecting moves real test money, so it needs a real test payout account at Stripe, not only a
"ready" mark in the database. The script does that step the way the membership checks do theirs
when run with `--payouts`, and without that it says so and skips the step.

It walks, as a host and as a contributor:

1. The host starts a project and writes two posts, one with a picture. The stand-in checker
   passes it; a visitor who is not signed in can read the diary and fetch the picture.
2. A customer who had a call opens the call's results and sees the box. It is not there for a
   call that was cancelled, one ended with a report, one with a refund request, and for the host.
3. On the host's page the customer sees "Contribute". They contribute once. The page says what
   the rulebook asks. The hold is placed; the email is written; "Your account" lists it; the box
   is gone from the call's results.
4. They cancel while it is held: "nothing was charged". The box stays gone, since they have
   contributed before.
5. They contribute monthly, with the box ticked. The host's page now says "You contribute $X a
   month". Three days later the money is taken. The host sees her contributor and the share in
   her earnings, not yet ready.
6. Seven days later she collects it together with a call's share.
7. A month later the next payment is held and taken without anyone pressing anything.
8. The host refunds part of the second month before collecting it.
9. The customer stops. Nothing more is held a month later.
10. A second customer contributes; the host ends the project while that payment is held. It is
    let go, the contributor is told, the diary says "This project has ended".
11. The founder's page shows the project, what it received and the payments; the founder hides a
    post and holds a share back.
12. A second host has a running project of her own. The switch is turned off: nobody can
    contribute to it, she cannot write, the box after a call and the "Contribute" line are gone,
    and her diary stays readable. The script puts the switch back as it found it and removes
    everything it made.

Beside the journey, a few short cases the journey does not reach:

- a paused host, and a hidden host page opened by a member: no box after a call and no
  "Contribute" line;
- a report about the person that was closed: no box, and no "Contribute" line either, because
  such a report also blocks;
- a report about one of her posts that was closed: no box after a call, since the customer
  reported her. The "Contribute" line on her page stays, because a report of a post does not
  block and that line follows `mayContribute` alone.
And one search through the code of the two pages, as the membership check does: neither imports
anything that writes or asks Stripe.

## Changes to existing code

| Place | Change |
| --- | --- |
| `src/app/calls/[id]/results/page.tsx` | Asks `askAfterCall` and draws the box, for a customer only. Nothing else on the page changes. |
| `src/app/h/[handle]/page.tsx` | The project's box gains the visitor's own line. |
| `src/lib/projects/ask.ts` (new) | `askAfterCall`, `contributionOf`. Reading only. |
| `docs/module-record.md` | The record of the whole feature: what was recommended, decided and built, what the reviewers found, how it was checked, and what is still open. |

## How it is checked

- **Tests of `askAfterCall`:** one for each condition failing alone, and one with all true, for
  each kind of call.
- **`scripts/project-journey-check.ts`**, as above.
- **Every earlier check script,** part one's and part two's included, once more on the finished
  code.
- **In the browser:** the two boxes on a phone-sized and a wide window, signed in as a customer
  after a call, as the host, and signed out.
- Astra reviews the pull request, then CodeRabbit.

## Done when

- The box appears exactly when the rulebook's conditions hold, and leads to the project.
- The journey check passes from a host's first post to the switch.
- Every earlier check script passes on the finished code.
- The record in `docs/module-record.md` is written.

## Astra's check (18 November 2026): "ready with changes"

| Astra's point | What was done |
| --- | --- |
| An open host page does not mean the host is not paused, and the visitor's line checked only login, ownership and blocks. | Both boxes ask part two's `mayContribute`. |
| A hidden host page can be opened by a member; that must not show the project. | The project's box keeps part one's rule: only when the page is open to everyone. |
| The journey's last step tested the switch on a project that had already ended, and never looked at the visitor's line. | Step 12 uses a second, running project; steps 3 and 5 read the line. |
| Which calls count, and what became of a refund request or a report. | Said in the table: every kind of call; any request or report, whatever became of it. |
| "Already contributes" was open to two readings. | Said in the table and added to the rulebook; "Finish contributing" for an unfinished card step. |
| Collecting in the journey needs a real test payout account, and the pretended clock must follow each hold's real end. | Said under "The check of the whole journey". |

## What building this part added to this plan (19 November 2026)

Nothing here changes a rule. It is what the code made exact.

- **Names.** Part two built `mayContribute` as `whyNotContribute` (it gives the reason, or
  nothing when the person may). This part asks that.
- **Where the deciding is.** The plain rule, `mayAsk`, is in `src/lib/projects/rules.ts`, where
  it can be tested without a database: one test for each condition failing alone, and one with
  all of them true. `askAfterCall` in `ask.ts` only gathers the facts for it. The kind of call
  is not one of those facts, so there is nothing to test "for each kind of call": the rule
  cannot tell them apart.
- **"Final".** The call's record counts as final when the charge would count it so: the time
  for late messages is over, the room is confirmed closed, and the record is complete.
- **No amounts, no box.** A project whose host suggests no amount takes no contributions
  (plan 25), so the customer could not contribute, and there is no box after a call.
- **The visitor's line.** `contributionOf` answers two things: whether the visitor could
  contribute now, and their own contribution if it gets a line. "You contribute $X a month" is
  shown as long as that contribution runs, also while the founder's switch is off for the host.
  "Finish contributing" is shown only while contributing is possible and that card step can
  still be finished: its payment waits for a card and its 30 minutes are not over. (After that
  the contribution's own page asks the bank what became of it; the line would lead to a page
  with nothing to finish.) In the diary, someone who already contributes every month, or whose
  monthly contribution is still being set up, sees "Contribute once" and no second monthly
  form, which would only be refused. So `src/app/h/[handle]/project/diary.tsx` changed too.
- **The journey.** As planned, with these things made exact:
  - Collecting is its step 6 and runs only with `--payouts`. It is not walked through the
    pages: the paid call that is collected with the contribution's share is made by the app's
    functions, like the paid call in the membership check, and the collection is started by the
    function behind "Collect earnings" with a later clock, since the button always collects at
    the real moment.
  - The "Your earnings" part of the Hosting page is drawn only for a host with a payout account,
    which the journey's host has during step 6 only. Elsewhere the script reads her earnings
    from the function that part is drawn from.
  - The founder's steps (the founder's page, hiding a post, holding a share back, and saving the
    switch on the founder's page) run when the test admin's login is set up, and are skipped
    with a note when it is not. The switch is then set directly.
  - The call "ended with a report" is a call with that mark on it and no report written, and the
    refund request is written straight in: a real report would also block, and then the other
    calls of the same two people could not show that the box is still there for them.
