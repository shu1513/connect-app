# Phone apps, part 13b: memberships, the host's side

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 13. Brought up to date on 27 November 2026,
after the website changed (the list is at the end).

## For the founder: what this is

A host sets her membership offer, sees her members, and looks after them, from the app.

## What is there today (read in the code)

`src/app/host/membership/`, `membership.tsx` and `membership-actions.ts`:

- **The offer** (`offerOfHost`): her price for 15 minutes and the minutes a month includes,
  her offer on or off. How many members she can take is worked out from her hours and what
  she has already promised. **Changing it shows first what the change does**
  (`previewOfferChange`): whose price will fall, which invitations end, and who keeps the
  terms they have. Saving is `saveMembershipAction`.
- **Her members:** each one's state, time left this month; pausing a member and undoing it
  (`pauseMemberAction`, `undoPauseAction`), ending a membership (`endMemberAction`), taking
  back an offer made to a member (`takeBackOfferAction`), in its two forms.
- **A membership paused with an account** (plans 53 and 55): when her account or a member's
  is paused, a membership with a member in it is paused, not ended, and stays in her list
  with the reason "paused with one of the two accounts". She is told by email, never which
  account or why. This is not her own "pause a member", and she cannot undo it: the member
  resumes themselves, if and when that is possible (part 13 says when).
- **Her list holds no ended memberships** (`membersOfHost` leaves them out). So a membership
  cancelled within 14 days (plan 46, part 3c), like any other that ended, is simply no
  longer in her list; she learns of it from the email every ending sends her.
- **After she has collected a member's call, she cannot give its time back** (plan 50, part
  2): only Connect can, from the founder's pages. She then owes her share back, which is
  part 16b's screen.
- **Inviting** a customer is on the Contacts page (part 17).
- Cutting weekly hours that members rely on is part of the calendar (part 15).

## Decisions (the builder's)

1. **The website's screens, on the same functions,** with the preview before a changed offer
   is saved, exactly as the website shows it.
2. **The apps' switch:** in the position *off* and in *on, but nothing is bought in the app*,
   the host's membership screens are not in the app, and their addresses refuse. (A host who
   changed her price from the app would be changing what members buy.) Her members' booked
   calls stay in her calls. The app does not say where else to go.
3. **Money actions ask once more** (ending a membership gives time or money back), in the
   website's words.
4. **Each member's state is shown with the server's sentence,** "paused with one of the two
   accounts" among them. For a membership paused with an account the app offers no "undo
   pause": the server sends which actions each member's row has, and the app draws only
   those. The app's list is the website's list: it adds no history of ended memberships.
5. **A host whose own account is paused** sees what part 18 lets a paused account see, and
   no more: none of this part's actions answer her.

## How it is tried

- `membership-check` and `membership-journey-check` unchanged and green.
- Check script: the offer saved with its preview; a preview that changed before saving; pause
  and undo; end; take back an offer both ways; a member paused with an account (in the list,
  with its sentence, and "undo pause" refused for it); a member who cancelled within 14 days
  (gone from the list, as on the website); every action refused for a host whose account is
  paused; every
  address in each position of the switch.
- On the Android test phone, with pictures: the offer, the preview, the members' list, each
  action.

## Keeping the 4.9%

As part 13: behind the switch, in all three positions.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *A paused account pauses its memberships* (plans 53 and 55). "What is there today",
   decisions 4 and 5, the check script.
2. *A member can cancel within 14 days* (plan 46, part 3c). Such a membership leaves her
   list like any that ended. (The first version of this list said it stays there with its
   reason; Astra's check showed that her list holds no ended memberships.)
3. *After collection only Connect gives a member's time back* (plan 50, part 2). Said here;
   the refusal is part 10b's, the debt is part 16b's.

This plan is read against the code once more on the day it is built.
