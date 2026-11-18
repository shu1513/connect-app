"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  addTimeOff,
  addWeeklyHours,
  CalendarError,
  calendarOf,
  changeWeeklyHours,
  mayKeepMemberHours,
  previewWeeklyHoursChange,
  removeTimeOff,
  saveCalendarChoices,
  type HoursChange,
  type MemberChoice,
} from "@/lib/booking/calendar";
import { hostMinutes } from "@/lib/membership/room";
import { lengthRange } from "@/lib/booking/rules";
import { withNotice } from "@/lib/notice";
import { requireActiveUser } from "@/lib/session";

function back(text: string): never {
  redirect(withNotice("/host/calendar", text));
}

function problem(error: unknown): string {
  if (error instanceof CalendarError) return error.message;
  console.error("[calendar] action failed", error);
  return "Something went wrong. Please reload the page to see what was saved, and try again.";
}

export async function saveChoices(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    await calendarOf(user.id, user.timeZone);
    // Both ends are checked before the list between them is made.
    const lengths = lengthRange(Number(formData.get("shortest")), Number(formData.get("longest")));
    if (!lengths) throw new CalendarError("Choose your shortest and your longest call from the lists. The shortest cannot be longer than the longest.");
    await saveCalendarChoices(user.id, {
      timeZone: String(formData.get("timeZone") ?? ""),
      lengths,
      noticeHours: Number(formData.get("noticeHours")),
      horizonWeeks: Number(formData.get("horizonWeeks")),
      breakMinutes: Number(formData.get("breakMinutes")),
    });
    notice = "Your calendar settings were saved. They apply to requests made from now on.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function addHours(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    const membersOnly = formData.get("membersOnly") === "on";
    // The same rule the page shows the tick by. A tick that cannot be kept is refused, never saved as hours for everyone.
    if (membersOnly && !(await mayKeepMemberHours(user.id))) throw new CalendarError("Hours for members only can be added once you can offer a membership. Nothing was added.");
    await addWeeklyHours(user.id, { weekday: Number(formData.get("weekday")), from: String(formData.get("from") ?? ""), to: String(formData.get("to") ?? ""), membersOnly });
    notice = membersOnly ? "Those hours were added, for your members only." : "Those hours were added.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function removeHours(formData: FormData) {
  const user = await requireActiveUser();
  const id = String(formData.get("id") ?? "");
  // A removal that leaves less than the host's members need goes through the step where she decides about them.
  await saveOrAsk(user.id, { remove: id }, "Those hours were removed. Calls already booked in them still happen.");
}

export async function addOff(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    const calendar = await calendarOf(user.id, user.timeZone);
    await addTimeOff(user.id, calendar.timeZone, { from: String(formData.get("from") ?? ""), to: String(formData.get("to") ?? "") }, new Date());
    notice = "Your time off was added. Calls already booked in it still happen; cancel them yourself if you need to.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function removeOff(formData: FormData) {
  const user = await requireActiveUser();
  let notice = "That time off was removed.";
  try {
    await removeTimeOff(user.id, String(formData.get("id") ?? ""));
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

// ---------------------------------------------------------------------------
// Changing a stretch in one go, and the step for a cut in hours (memberships)
// ---------------------------------------------------------------------------

/** The change a form describes: a stretch removed, a stretch replaced by another, never a removal first and an addition later. */
function changeFrom(formData: FormData): HoursChange {
  const remove = String(formData.get("remove") ?? "");
  const hasNew = formData.get("weekday") !== null && String(formData.get("from") ?? "") !== "";
  return {
    ...(remove ? { remove } : {}),
    ...(hasNew ? { add: { weekday: Number(formData.get("weekday")), from: String(formData.get("from") ?? ""), to: String(formData.get("to") ?? ""), membersOnly: formData.get("membersOnly") === "on" } } : {}),
  };
}

/** The address of the step in which the host decides about her members, carrying the change it is about. Nothing is saved by opening it. */
function cutPath(change: HoursChange): string {
  const query = new URLSearchParams();
  if (change.remove) query.set("remove", change.remove);
  if (change.add) {
    query.set("weekday", String(change.add.weekday));
    query.set("from", change.add.from);
    query.set("to", change.add.to);
    if (change.add.membersOnly) query.set("membersOnly", "on");
  }
  return `/host/calendar/cut?${query.toString()}`;
}

/**
 * Saves a change of weekly hours, or, when it would leave less than the host's members need for
 * their next months, sends her to the step where she chooses for each of them. The library
 * decides again when it saves; this only chooses the page.
 */
async function saveOrAsk(userId: string, change: HoursChange, saved: string): Promise<never> {
  let to: string;
  try {
    if (change.add?.membersOnly && !(await mayKeepMemberHours(userId))) throw new CalendarError("Hours for members only can be kept once you can offer a membership. Nothing was changed.");
    const before = await hostMinutes(db, userId);
    const cut = await previewWeeklyHoursChange(userId, change);
    // The step is shown whenever a cut would touch someone: members who no longer fit, or invitations that would be taken back.
    const shrinks = cut.hoursAfter < before;
    if (shrinks && (cut.needed > cut.hoursAfter || cut.invitationsTakenBack.length > 0)) to = cutPath(change);
    else {
      // A cut that touches nobody is saved with the mark of what was just worked out, every member kept. If anything
      // changed in between (hours removed in another tab, a new invitation), nothing is saved and she looks again: so no
      // invitation is ever taken back, and no member left without room, that she was not shown first.
      await changeWeeklyHours(userId, change, shrinks ? { mark: cut.mark, members: cut.members.map((member) => ({ membershipId: member.membershipId, choice: "keep" as const })) } : undefined);
      to = withNotice("/host/calendar", saved);
    }
  } catch (error) {
    to = withNotice("/host/calendar", problem(error));
  }
  redirect(to);
}

/** "Edit" on a stretch: its day, start, end and the "Members only" tick, sent as one replacement. */
export async function editHours(formData: FormData) {
  const user = await requireActiveUser();
  const change = changeFrom(formData);
  if (!change.remove || !change.add) back("Those hours could not be changed. Please look at your calendar again.");
  await saveOrAsk(user.id, change, "Those hours were changed. Calls already booked in the old hours still happen.");
}

/**
 * The step for a cut in hours: the new hours and the host's choice for each member, saved together.
 * The form carries the change, the mark of what the page showed, and one choice per member. If
 * anything changed meanwhile, nothing is saved and the step is shown again as things stand now.
 */
export async function saveCutAction(formData: FormData) {
  const user = await requireActiveUser();
  const change = changeFrom(formData);
  const members: MemberChoice[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("choice:")) continue;
    const membershipId = key.slice("choice:".length);
    const choice = value === "less" || value === "pause" ? value : "keep";
    members.push({ membershipId, choice, ...(choice === "less" ? { minutes: Number(formData.get(`minutes:${membershipId}`)) } : {}) });
  }
  let to: string;
  try {
    // This step is only for a stretch that is removed or changed, and it keeps the same rule for "Members only" as the calendar page.
    if (!change.remove) throw new CalendarError("Those hours could not be changed. Please look at your calendar again.");
    if (change.add?.membersOnly && !(await mayKeepMemberHours(user.id))) throw new CalendarError("Hours for members only can be kept once you can offer a membership. Nothing was changed.");
    await changeWeeklyHours(user.id, change, { mark: String(formData.get("mark") ?? ""), members });
    to = withNotice("/host/calendar", "Your hours were changed, and your members were told what you chose for them. Months that have started go on as they are.");
  } catch (error) {
    to = withNotice(cutPath(change), problem(error));
  }
  redirect(to);
}
