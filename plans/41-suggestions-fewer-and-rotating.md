# Plan 41: Suggested hosts: fewer, rotating, and no ceiling

**Status:** built with this plan, 19 November 2026 (see `docs/module-record.md`). Written by the
builder alone, from the code as it is on `main` after pull request 65, and from what the founder
said that day. It changes three things in the suggested hosts of `plans/37-suggested-hosts.md`;
everything else there stays.

## For the founder: what this is

Three changes to the "Suggested hosts" row on the home page, all three from your own remarks:

1. **Fewer at once.** The row shows three hosts. "Show more" opens the other three.
2. **It rotates.** A host whose card you saw on two different days without opening it rests for
   two weeks. A host whose page you opened from the row comes back, every time you do.
3. **No ceiling.** More people behind a host always means more points. Until now seven people
   and seventy counted the same.

## What the founder said (19 November 2026)

"if more people follow the same host and also another person, if 10, instead of the 3, that
suggestion from 10 comes before the 3 right? also maybe not too many suggestions, this way the
home page is not noisy and overwhelming. and also we periodically rotate the suggestions since
once the customers saw these suggestions, the customer probably don't want to see the same
suggestions (unless he checked out or clicked on one of those suggestions, then we can pop that
suggestion up one more time".

Told that the points stop at seven people: "why? why even a ceiling".

About interest: "this happens each time if someone shows interest, so if the host's profile shows
up to the customer's homepage a second time, and the customer showed interest again, then the
host should show up again next time."

And, shown the three changes: "Yes, build them".

## Decisions

The founder's: fewer suggestions at once; resting what was seen; interest brings a host back
every time; no ceiling. The numbers and the rest are the builder's, and each is one number in
`src/lib/suggestions/rules.ts`.

1. **Three are shown, six are made.** A day's suggestions are still up to six. The row shows
   places 1 to 3; "Show 3 more" opens places 4 to 6. Place 3 is one of the two kept places, so a
   host who has been shown less is always among the first three.
2. **A card behind "Show more" is not seen until it is opened.** So hosts in places 4 to 6 do
   not rest because of cards nobody looked at.
3. **Resting.** A host rests for a person when that person saw the host's card on **two
   different days** without opening the host's page, and those days are no more than **fourteen
   days** back. A resting host is not suggested to that person. When the older sighting is more
   than fourteen days back, the host can be suggested again. So the rest lasts about two weeks;
   it is counted from the sightings, not from a fixed date.
4. **Interest.** Opening the host's page from the row is interest. Only sightings after the day
   of the last opening count toward resting, so a host the person keeps opening stays free to be
   suggested, and a host they stop opening rests after two more sightings. "Free to be suggested"
   is not a promise of a place: the host still has to be among the day's six by their points and
   open times, like anyone.
5. **What "opening" is.** Pressing the host's name on the card, also with the middle button for
   a new tab. It is written on that day's line for that card, once. A person who opens a card
   has seen it, so it is marked as seen too.
6. **A thin row is filled.** If fewer than three fresh hosts fit, resting hosts fill the row up
   to three, the ones with the most points first. They never take a kept place. With few hosts
   in the first weeks, this keeps the row from emptying.
7. **Following, booking and the X stay as they are.** A host the person follows or has a call
   with is no stranger and leaves the row for good; the X hides a host for good.
8. **No ceiling on the points from people.** Nothing below three people, as before. Nine points
   at three people, and six more each time the number doubles: 6 people 15, 12 people 21, 24
   people 27, 48 people 33. So ten always come before seven. Each further person adds a little
   less, which keeps one very popular host from taking over: a host needs about ten times as many
   people behind them to make up for another host being available now.
9. **The explanation under the row** says the new rules in two more sentences.

## A correction to what the founder was told

The builder had said that with the new rule "a host with a hundred still cannot bury a good host
who is free right now". That was too strong. With these numbers a hundred people are worth about
39 points and "available now" 20. What is true: being available now is worth as much as ten
times the people, and two of the six places are kept for hosts shown less, whatever the points.

## What it relies on (each read in the code by the builder)

- The day's suggestions and their lines: `suggestion_days` and `suggestion_shows`
  (`src/db/schema.ts`), made by `makeSuggestions` and read by `todaysSuggestions`
  (`src/lib/suggestions/suggestions.ts`). Each line already says when its card was seen.
- A card is marked as seen when at least half of it is on the screen
  (`src/components/suggestions-watch.tsx`). A card inside a closed "Show more" is not drawn, so
  it is not seen.
- The points from people: `peoplePoints` in `src/lib/suggestions/rules.ts`, until now 3 for each
  person up to 20.

## The changes

- **The database** (`drizzle/0046_suggestion_opened.sql`): one new column on `suggestion_shows`,
  `opened_at`. It is deleted with its line after 90 days, like the rest.
- `src/lib/suggestions/rules.ts`: `peoplePoints` without a ceiling; `rests`, plain logic with
  tests; the numbers (3 shown, 2 days, 14 days). The rule's version goes to 3.
- `src/lib/suggestions/suggestions.ts`: when a day is made, the person's own lines of the last
  fourteen days say who rests; resting hosts are left out, and fill the row only when it would
  have fewer than three. `markOpened` writes an opening.
- `src/app/suggestions/actions.ts`: the action for an opening. It takes a day and one number,
  and can only touch the person's own line.
- `src/components/suggested-hosts.tsx`, `src/components/suggestions-watch.tsx`: three cards and
  "Show more"; the host's name on a card tells the server when it is pressed.
- `scripts/suggestions-check.ts`: resting, interest, the two weeks, the filled row, openings,
  and the row with "Show more".
- `plans/37-suggested-hosts.md`: a note at the decisions this changes. `docs/for-the-lawyer.md`:
  that openings are now recorded. `docs/module-record.md`: what was built.

## How it will be checked

- Tests of the plain rules: the points at 3, 6, 12, 24 people and that they always grow; resting
  after two sightings; not from cards that were never seen; back after an opening, every time;
  the fourteen days to the day.
- `scripts/suggestions-check.ts` against the local database and the running app.
- In a browser: three cards and "Show more"; pressing a host's name is written down; the cards
  behind "Show more" are not marked as seen until it is opened.

## Limits to know about

- **Without a ceiling, made-up accounts can push a host further than before.** Seventy accounts
  that count give about 36 points; the old ceiling was 20. Two things stand against it: nothing
  counts below three people, and an account counts only once it is three days old. It makes
  this slower and more work, not impossible. The order of a person's row also still says a
  little about how many people share their hosts with a host, as before, without saying who.
- **Filling a thin row can bring a resting host back before its two weeks are over.** That is
  what filling is for: with few hosts, a row of resting hosts is better than an empty row.
- **The open time is looked up for a limited number of hosts,** as in plan 37: up to 30 fresh
  ones, and when the row has to be filled, up to 10 resting ones more (so up to 40 in all, where
  plan 37 said 30). With many hosts, a fresh host outside the 30 can be missed while a resting
  one fills the row, and an available resting host outside the 10 can be missed. Not a problem
  with few hosts; the same later step as in plan 37 solves it (keeping each host's next open
  time in the database).
- **An opening is written when the name is pressed.** If the browser is closed or the page
  reloaded in that instant, it can be lost; the next press counts.

## Not built

- Resting by anything but the person's own sightings (for example by how often a host is shown
  to everyone).
- Telling a person that a host is resting, or a way to bring a resting host back by hand.
- Counting anything but pressing the host's name as interest (for example how long a page was
  looked at).

## Still open

- **For the founder:** the numbers (three shown, two days, two weeks, six points per doubling)
  are starting values.
- **For the lawyer** (`docs/for-the-lawyer.md`, section 4): the app now records that a person
  opened a suggested host's page from the row. Plan 37 had said no clicks are recorded.

## Astra's check (19 November 2026)

Plan and code together, one round: "ready with changes". Each point was read against the code by
the builder.

| # | What Astra found | What was done |
|---|---|---|
| 1 | Interest could be lost: an opening was counted on the day of the card, not on the day of the press, so a card from an older day pressed later did not answer the sightings in between; and the link kept "already told" when the page moved on to another day. | Taken: the day of the press counts, also for a card older than two weeks; the link starts afresh for each day and place. |
| 2 | When resting hosts filled a row, the third could be the one seen the least instead of the one with the most points. | Taken: fillers are simply the most points first. |
| 3 | A press of the right mouse button counted as an opening. | Taken: only the middle button, beside a normal press. |
| 4 | Some checks proved less than their labels said. | Taken: "Show more" is checked to start closed; a row of only resting hosts and a late press of an older card are checked. What only a browser does was tried by hand. |
| 5 | The limits of the look-ups and softer words for "rests" and "comes back". | Taken: under "Limits to know about" and in decisions 3 and 4. |
| 6 | Rounding made 894 and 895 people worth the same. | Taken: the points are not rounded. |

Astra found the day arithmetic sound, the press reaching the server through the navigation in
this version of the framework, the closed "Show more" not counted as seen, and nothing that lets
one person learn about another through resting or openings.
