# Phone apps, part 13b: memberships, the host's side

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 13.

## For the founder: what this is

A host sets her membership offer, sees her members, and looks after them, from the app.

## What is there today (read in the code)

`src/app/host/membership/`, `membership.tsx` and `membership-actions.ts`:

- **The offer** (`offerOfHost`): the monthly amount and the talk time it buys, how many
  members she takes, her offer on or off. **Changing it shows first what the change does**
  (`previewOfferChange`): to members who are paying now, and what each is then offered.
  Saving is `saveMembershipAction`.
- **Her members:** each one's state, time left this month; pausing a member and undoing it
  (`pauseMemberAction`, `undoPauseAction`), ending a membership (`endMemberAction`), taking
  back an offer made to a member (`takeBackOfferAction`), in its two forms.
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

## How it is tried

- `membership-check` and `membership-journey-check` unchanged and green.
- Check script: the offer saved with its preview; a preview that changed before saving; pause
  and undo; end; take back an offer both ways; every address in each position of the switch.
- On the Android test phone, with pictures: the offer, the preview, the members' list, each
  action.

## Keeping the 4.9%

As part 13: behind the switch, in all three positions.
