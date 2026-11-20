# Plan 34: The languages a host speaks

**Status:** built, 19 November 2026 (pull request 57; see `docs/module-record.md`). Nothing in
the building changed a rule of this plan. Written 19 November 2026 by the builder alone (no helper agents),
from the code as it is on `main` after pull request 55, and from what the founder asked that day.
Astra checked it once ("ready with changes"); every point was read against the code by the
builder and is worked in below (the list is at the end).

## For the founder: what this is

A customer pays for a live video call. Before they pay, they should know which languages they
can talk to the host in. Since plan 27 a host can be based in 33 countries, so this is no longer
obvious.

After this change:

- **A host ticks the languages they can hold a call in**, from a fixed list, on the Hosting page.
- **Everyone sees them** on the host's page and in the search results, as one line:
  "Languages: English, Spanish".

It is a small change: one new piece of information on the host's profile, one list, one new part
of a form, and one line in three places.

## What the founder said (19 November 2026)

"Each host should have a language field right? so people know what language the host speaks?"

## Decisions (the builder's; the founder can change any of them)

1. **A fixed list, not free typing.** The host ticks boxes. That keeps spelling the same for
   everyone ("Spanish", never "español" or "spansh"), so the answers can be compared later.
2. **At least one, at most five.** A host must choose at least one language when they apply, and
   each time they save their profile. Five is enough for anyone, and keeps the line short.
3. **What a tick means** is said on the form: "Languages you can hold a call in." No levels
   ("fluent", "basic"): a customer needs a yes or a no.
4. **No "main language".** The languages are shown in the order of the list (A to Z), the same
   for every host.
5. **Hosts from before this change have none chosen.** Their page and their search result simply
   show no "Languages" line; nothing is guessed, and "English" is never assumed. Their Hosting
   page shows one sentence asking them to choose, and the next time they save their profile they
   must tick at least one. They are not hidden or blocked meanwhile.
6. **Changing languages does not send an approved profile for approval again.** For an approved
   profile only a new display name does that (so nobody can rename themselves into someone
   famous). A language is no such risk. The other rules stay exactly as they are: any save of a
   declined profile puts it back in the queue, and a suspended one stays suspended.
7. **The founder sees the languages** where host profiles are approved, beside the country.
8. **Two sign languages are in the list** (American and British). The calls are video calls, so
   a deaf host or customer can use them.
9. **A language that is not in the list:** the host can say so in their "about" text, and write
   to support to have it added. Adding one is one line in the list.
10. **A language taken out of the list later** is no longer shown for the hosts who had chosen
    it, and has no tick box any more, so it drops away the next time they save. A host whose
    only languages were taken out is treated like a host with none: no line, and the sentence
    asking them to choose.
11. **Old records do not get the languages.** A report about a host, and the record kept when
    the founder removes and reports a photo, each keep a copy of the host's name, handle and
    "about" text as they were. Languages say nothing about either case and are left out.

## The list (51 languages)

The languages of the 33 countries a host can be based in, the most spoken languages of the
world, and two sign languages:

American Sign Language, Arabic, Bengali, British Sign Language, Bulgarian, Cantonese, Catalan,
Croatian, Czech, Danish, Dutch, English, Estonian, Filipino, Finnish, French, German, Greek,
Hebrew, Hindi, Hungarian, Indonesian, Irish, Italian, Japanese, Korean, Latvian, Lithuanian,
Luxembourgish, Maltese, Mandarin Chinese, Norwegian, Persian, Polish, Portuguese, Punjabi,
Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swahili, Swedish, Tamil, Thai, Turkish,
Ukrainian, Urdu, Vietnamese, Welsh.

Names are in English, like the rest of the app. Each language is saved as its short
international code (`en`, `es`, `zh` for Mandarin, `yue` for Cantonese, `ase` and `bfi` for the
two sign languages), never as its name, so a name can be reworded later without touching any
host.

## What it relies on (each read in the code by the builder)

- **The profile.** One row per host in `host_profiles` (`src/db/schema.ts`). The country of
  plan 27 is the model for this change: a fixed list in a file of its own
  (`src/lib/profiles/countries.ts`), checked where it is written, and a plain column.
- **Two places write a profile:** `createHostProfile` (a person applies) and `updateHostProfile`
  (the host edits), both in `src/lib/profiles/profiles.ts`, both through `checkedDetails`. Their
  forms are in `src/app/host/page.tsx`, their actions in `src/app/host/actions.ts`
  (`createProfile`, `saveProfile`).
- **Re-approval** is decided in `updateHostProfile` from the display name alone
  (`profiles.ts:153`). The founder's approval names the display name and the "about" text it was
  looking at (`decideProfile`); languages are not part of that and stay out of it.
- **Three readers show a host to other people:**
  - `publicProfile` (`profiles.ts:242`) for the host's page `/h/[handle]`. It reads only the
    columns that are public, by name.
  - `hostForMember` (`src/lib/membership/access.ts:34`, with its type `HostForMember` at `:16`),
    which opens a hidden page for a member or an invited person. `hostForMemberByHandle` only
    passes on what it gives, and the page builds on that (`src/app/h/[handle]/page.tsx:51-57`).
  - `searchHosts` (`src/lib/profiles/search.ts`) for the search results
    (`src/app/search/page.tsx`).
- **The founder's page** (`src/app/admin/people/page.tsx:128` and `:236`) shows the country of
  each host; the languages go beside it.
- **Check scripts that go through the two writers** and so must now pass languages:
  `scripts/accounts-check.ts` (the shared `details` and five more calls of `createHostProfile`,
  three of `updateHostProfile`), `scripts/abroad-check.ts:111`, `scripts/journey-check.ts:195`,
  `scripts/photo-check.ts:826`, `scripts/membership-check.ts:1049`. Nothing else in `src/` or
  `scripts/` calls them. Fifteen scripts also write hosts straight into the database: they need
  no change, because the database itself fills in "none" for a row written without languages,
  and such a host is treated like a host from before this change.
- **Two places keep a copy of a profile as it was:** a report (`src/lib/safety/reports.ts:100`)
  and a photo the founder removed and reported (`src/lib/profiles/photo.ts:457`). Each names the
  fields it copies, so neither changes by itself (decision 11).

## The changes

| Place | Change |
| --- | --- |
| `src/lib/profiles/languages.ts` (new) | The list: each language's code and English name, A to Z. `MAX_LANGUAGES = 5`. One function takes what a form sent and gives back the chosen codes, without doubles and in the list's order, or a problem the host can read (none chosen, more than five, something that is not in the list). One function turns saved codes into names for a page, leaving out a code that is no longer in the list. No database, no network. |
| `src/db/schema.ts`, one migration | `host_profiles.languages`: a list of codes (`text[]`), never missing, with "none" as the database's own default, which stays. So every host there is today, and every row written later without languages, has an empty list. Like the country, the database only makes sure it is there; that the codes are in the list is checked where a profile is written. |
| `src/lib/profiles/profiles.ts` | `createHostProfile` and `updateHostProfile` take `languages` and check them with the function above before anything is written. The status rule in `updateHostProfile` is not touched. `PublicProfile` gains `languages`, and `publicProfile` reads that one more column. |
| `src/lib/membership/access.ts` | `HostForMember` gains `languages`, and `hostForMember` reads and returns them, so a member who opens a hidden page sees the same line. Who may open such a page does not change. |
| `src/lib/profiles/search.ts` | `SearchResult` gains `languages`; the query reads the column. Who is found, and in which order, does not change. |
| `src/app/host/page.tsx`, `src/app/host/actions.ts` | In both forms (apply, edit): a group of tick boxes, plain HTML with no script, folded away so the form stays short on a phone. The line it is folded behind is fixed, "Languages you can hold a call in (choose 1 to 5)": without script it could not follow the ticks. In the edit form the host's saved languages are ticked, and named in plain text above the group ("Saved: English, Spanish"). No single box is marked as required (that would ask for all of them); the group is checked on the server, and a problem comes back as the page's usual notice. For a host with no language that is still in the list: one sentence above the form asking them to choose. The actions pass every ticked box on (`formData.getAll`, as the project form already does). |
| `src/app/h/[handle]/page.tsx` | "Languages: English, Spanish" under the name, when at least one of the host's languages is in the list. |
| `src/app/search/page.tsx` | The same line in each result, under the same condition. |
| `src/app/admin/people/page.tsx` | The languages beside the country, in both places a host is listed. |
| The check scripts named above | Pass `languages: ["en"]` where they call the two writers. |
| `docs/module-record.md` | The record of this change. |

**Not touched:** payments, calls, the calendar, memberships' rules, emails, the ID check. No
email is sent about languages.

## What is left out, on purpose

- **Searching or filtering by language** ("hosts who speak Spanish"). Search today finds a host
  by name only, shows at most 20, and shows nothing when nothing is typed; there is no list of
  hosts to browse. The way the languages are saved allows a filter later, but how browsing by
  language should work is a decision of its own.
- **Levels** (native, fluent, basic) and a **main language**.
- **The customer's language**, and matching customers to hosts by it.
- **Language names in their own language** ("Español"). The whole app is in English.
- **The line on other pages** (the booking page, "Following", "People you have talked to"). The
  host's page and the search results are where a customer decides.
- **A database rule for the codes.** One place writes them and checks them, as for the country.

## The order of work

Small steps, each checked before the next:

1. The list with its unit tests, and the migration.
2. The two writers take languages, together with everything that calls them: the tick boxes in
   both forms, the two actions and the check scripts. One step, so there is never a moment when
   languages are required and a host has no way to give them.
3. The three readers, then the line on the host's page, in search, and on the founder's page,
   and the sentence for a host with none.
4. The checks below.

## How it is checked

- **Unit tests** (`languages.test.ts`): every code is small letters and appears once; every name
  appears once; the list is A to Z by name; English is in it. The checking function: nothing
  chosen is refused; six are refused; an unknown code is refused, also beside good ones; doubles
  are folded; exactly five are accepted; the answer is in the list's order whatever order came
  in. The naming function skips a code that is not in the list, and gives nothing when none is
  left.
- **`scripts/accounts-check.ts`**, new checks beside the ones for the country. Each refusal is
  checked by its own words, not only as "some refusal" (the script's helper accepts any):
  - applying with no language, with six, and with a made-up one is refused, and no profile is
    written;
  - applying with two saves exactly those two, in the list's order;
  - saving the profile with other languages changes them, and an approved profile stays
    approved;
  - saving with none, with six, or with a made-up one is refused, and what was saved stays;
  - `publicProfile` and `searchHosts` give the languages of an approved host;
  - a host written straight into the database without languages is still found and shown, with
    an empty list. (This shows the database's default for a new row. That the rows from before
    the change got it is read once in the local database after the migration has run.)
- **`scripts/membership-check.ts`**, one check beside "a hidden page stays closed to the
  public" (`:1917`): the member who can open the hidden page gets the host's languages, and the
  public reader still gives nothing.
- **Every earlier check script** that calls the two writers, once more on the finished code
  (`accounts-check`, `journey-check`, `photo-check`, `abroad-check`, `membership-check`), in a
  time slot when no other session is using the shared test database.
- **Lint, typecheck, unit tests, build.**
- **In the browser,** phone-sized and wide: apply as a host with two languages, sending the form
  with the group folded shut again; the line on the host's page and in search; change them on
  the Hosting page; send with none ticked and read the notice; a host with none sees the
  sentence asking them to choose and no line on their public page; the founder's page shows
  them.
- Astra reviews the code, then CodeRabbit, as for every change.

## Done when

- A person cannot apply as a host, or save their host profile, without one to five languages
  from the list.
- A host's languages are on their page, in their search result and on the founder's page.
- A host from before this change is shown as before, with no "Languages" line, and is asked on
  the Hosting page to choose.
- Changing languages does not send an approved profile back for approval.
- Every check above passes, and the record in `docs/module-record.md` is written.

## What only the founder can settle

- **The list.** Which languages are in it (51 above), and whether the two sign languages belong.
- **Whether it must be filled in.** This plan makes it required. The other way is to leave it
  optional and only nudge hosts; then some pages would never say.

## Working beside other changes

Two other changes are open on their own branches: the host's photo from TikTok (it holds plan
number 33, which is why this is plan 34) and the emails to followers. Each has made a migration
numbered 0041. This change takes the next free migration number when it is built, and whichever
is merged later brings `main` in first and makes its migration again. All share one local test
database, so no two run check scripts at the same time. The TikTok change may also touch
`src/lib/profiles/profiles.ts` and `src/app/host/page.tsx`; this change adds to them in small,
separate places.

## Astra's check (19 November 2026): "ready with changes"

Astra read the plan against the code, without running anything. The builder read each point in
the code before taking it.

| Astra's point | What was done |
| --- | --- |
| **Had to change.** One caller of `updateHostProfile` was missing: `scripts/membership-check.ts:1049`. Without languages it would not compile, and its price checks would meet the language rule first. | Named under "What it relies on", in the changes, and in the scripts run again. |
| **Had to change.** A folded line that "names what is chosen" cannot follow new ticks without script, so it would mislead. | The line is fixed text; the saved languages are named above the group as "Saved: …". |
| The membership reader is `hostForMember` and its type; `hostForMemberByHandle` only passes it on. | Named so. |
| "Only a new name sends it back" holds for an approved profile; a declined one goes back on any save, a suspended one stays. | Decision 6 says so. |
| The database's default must stay, for rows written later without languages: many more scripts than four write hosts directly. | Said in the changes; the count is corrected to fifteen. |
| No box may be marked required (that asks for all); check the group on the server. The forms belong in the same step as the writers. | Both taken. |
| A host whose only languages were taken out of the list would get an empty "Languages:" line and no nudge. | Decision 10, and the condition on the line. |
| Two places keep a copy of a profile (a report, a locked photo) and would not gain the languages. | Decision 11: left out, on purpose. |
| More checks: exactly five; a refused save leaves what was saved; the hidden page for a member; refusals by their own words; sending the form folded; a new row shows the default, not the old rows. | All taken. |
| Do not promise that filtering later is "a small step": search shows nothing without typed text and at most 20. | The promise is gone; "left out" says why it is a decision of its own. |

Astra asked for nothing to be added beyond this, and said a separate table, a list of languages
in the database, or an index are not needed now. None is in the plan.
