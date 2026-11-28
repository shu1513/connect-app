# Phone apps, part 17: contacts, invitations, and the Following page

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).
Brought up to date on 27 November 2026, after the website changed (that list is at the end
too).

## For the founder: what this is

Two lists. **Contacts:** the people a person has had calls with, in both roles. A host has her
private note on each customer and can invite them to become a member; a customer has a way
to book again. **Following:** the hosts a person follows, and what they want to be told.

## What is there today (read in the code)

- `src/app/contacts/page.tsx` (`contactsOf` in `src/lib/people/contacts.ts`): for each person
  the number of calls, the last call, and, for a host they called, a link to book again; the
  host's note (`saveNoteAction`, a limit on length, and a guard so that an older copy of the
  note open elsewhere does not overwrite a newer one); invite and take back
  (`inviteAction`, `takeBackInviteAction`, `invitingFor`). The invited person answers on the
  host's page (part 13).
- `src/app/following/page.tsx` (`followedHosts`, `followEmailsOf`): for each host whether she
  is available now, the next call with her and its link, unfollow, and the choices per host:
  "tell me when she is available", with from and to as whole hours in the follower's own
  zone, and the diary choice. While emails to followers are switched off for everyone
  (they are, until the founder sets a postal address, plan 31) the page shows neither those
  email choices nor a notice. The notice "switched off" is for a person who has switched
  such emails off for their own account while they are on for everyone.
- `askOnlineAction` is the question on the page after a call (part 10).
- **"Write to [name]"** (plan 49; `src/components/write-to.tsx`): on Contacts a host has this
  button beside each person who was her customer, while messages are switched on. A
  customer has no such button there: a customer writes around a call.

## Decisions (the builder's)

1. **Contacts,** for both roles, on the same functions, with the same guard against an older
   copy of a note. The note is folded in the list and open on one contact's screen.
   Invitations are shown and can be made only while memberships are fully on for the apps
   (part 13's switch).
2. **Following:** the list with what the website shows, unfollow, and the choice "tell me
   when she is available" with its hours. "Call now" beside a host who is available follows
   the apps' "available now" switch.
3. **The diary choice is not shown and never sent.** The app's address hands the saving
   function only the fields the app has, so the choice made on the website stays as it was;
   and the list is sent without that field.
4. **A host's note is hers alone:** sent only to her, never to the customer, and in no answer
   for anyone else.
5. **"Write to [name]" for a host's past customers** opens that conversation in the app's
   Messages (part 17b). It is built with whichever of the two parts comes second (part 17b,
   decision 20): until part 17b exists the app's answer has no such field. Whether the
   button is there for one contact is the server's answer, as on the website.

## How it is tried

- `follow-check`, `follow-emails-check`, `ratings-check` unchanged and green.
- Check script: contacts in both roles; a note saved and read back only by its host; a note
  too long; an older copy not overwriting a newer one; an invitation in each position of the
  membership switch; choices saved from the app leave the diary choice untouched, and the
  list holds no diary field; once part 17b exists, "Write to" is in a host's answer for a
  past customer, absent for someone she only called as a customer, and absent for everyone
  while messages are switched off.
- On the Android test phone, with pictures: both lists, a note, an invitation, the hours,
  unfollow.

## Keeping the 4.9%

An invitation leads to a membership (part 13, behind its switch). Nothing about projects.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *Saving the website's way would erase the diary choice, and the list carries it.*
   Decision 3.
2. *Contacts is for both roles,* with the count, the last call and "book again", and the
   guard for notes. Decision 1.
3. *Following shows more:* available now, the next call, the hours, the notice that emails
   are off. Decision 2.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. `src/lib/people/contacts.ts`
and the Following page have not changed. What changed in this plan:

1. *A host can write to a past customer from Contacts* (plan 49). "What is there today",
   decision 5, the check script.

This plan is read against the code once more on the day it is built.
