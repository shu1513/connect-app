# Phone apps, part 15: a host's hours and rules

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).
Read again against the code on 27 November 2026, after pull request 123. One line of
`src/lib/booking/calendar.ts` changed, and it needs nothing from this part: when a host cuts
her hours, a membership that was paused or ended in the same moment (one of the two accounts
was paused, plans 52 and 53) is left exactly as it is. The app shows the choices the server
sends for each member, as decision 4 already says. It is read once more on the day it is
built.

## For the founder: what this is

The host's calendar settings from the app: the hours she is open each week, time off, the
shortest and longest call, the break after a call, how much notice she needs, how far ahead
people can book, her time zone, and which hours are for members only.

## What is there today (read in the code)

`src/app/host/calendar/` and `src/lib/booking/calendar.ts`, `rules.ts`:

- **Choices** (`saveChoices`): the shortest and the longest call (5 minutes to 6 hours, in
  5-minute steps, plan 15), the break after a call (her choice, never less than 2 minutes,
  plan 42), the notice, how far ahead, the time zone.
- **Weekly hours** (`addHours`, `editHours`, `removeHours`): per weekday, from and to, in her
  zone; a stretch past midnight is entered on two days; hours can be for members only.
- **Time off** (`addOff`, `removeOff`): from a date and time to a date and time, so it can be
  part of a day.
- **A list of the time her own bookings as a customer take** (`ownBookingsTakingTime`), with
  links.
- **Cutting hours that members rely on** (`cut/page.tsx`, `previewWeeklyHoursChange`,
  `saveCutAction`, `src/lib/membership/room.ts`): calls already booked stand. What the page
  shows is what the cut does to members' room and to invitations that would be withdrawn,
  and it asks her to choose for each member: keep, pause, or make a smaller offer. The form
  carries a mark of what was shown; if the picture has changed since, or a needed choice is
  missing, nothing is saved and it is shown again. A cut that touches nobody saves directly.

## Decisions (the builder's)

1. **The same functions, the same steps.** A cut that touches members shows the website's
   preview from the server, takes her choices, and sends them with the preview's mark; if the
   mark is stale the app shows the new preview and asks again. Nothing new is invented.
2. **Hours are typed with the phone's time picker and shown in the host's own zone** (the one
   saved on her calendar, not the phone's), with the zone named on the screen. A stretch past
   midnight is entered as on the website.
3. **Time off** with the phone's date and time pickers, from and to.
4. **Every list of choices comes from the server,** so a later change of the allowed values
   needs no new app version.
5. **While memberships are not fully on for the apps** (part 13's switch): the app does not
   let a change of hours quietly do something to members. Members-only hours are shown but
   cannot be changed from the app, and a cut that would need a choice about a member is
   refused with "this change affects your members; it cannot be made here right now". The
   same refusal meets a cut that would withdraw an open invitation (which today needs no
   choice and would happen silently), and making hours members-only. The server decides this
   inside the saving itself, so an invitation made between the preview and the press is
   protected too. Hours that touch no member and no invitation are changed freely.

## How it is tried

- `booking-check`, `member-calls-check` and `membership-check` unchanged and green.
- Check script for the app's addresses: each save and each refusal; a cut with a stale mark;
  a cut that needs choices without them; a cut that touches nobody; a stretch past midnight;
  time off for part of a day; a zone change; decision 5 in each position of the switch.
- App tests: showing hours in a zone other than the phone's.
- On the Android test phone, with pictures: adding and removing hours; time off; the shortest
  and longest call; a cut that touches a member, with its preview and choices.

## Keeping the 4.9%

No money moves here. Decision 5 keeps the calendar from becoming a side door to membership
changes while those are out of the apps.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *The preview's mark is not a ticket for having looked;* it says the picture is still the
   same. Described as it is; decision 1.
2. *The preview is about members, not about booked calls,* which stand. Corrected.
3. *Missing:* the choices per member, the shortest and longest call, the break's 2-minute
   floor, the list of her own bookings, time off for part of a day, a stretch past midnight.
   Added.
4. *With memberships out of the apps, an hours change must not touch members unseen.*
   Decision 5.
