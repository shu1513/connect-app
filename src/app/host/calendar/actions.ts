"use server";

import { redirect } from "next/navigation";
import { addTimeOff, addWeeklyHours, CalendarError, calendarOf, removeTimeOff, removeWeeklyHours, saveCalendarChoices } from "@/lib/booking/calendar";
import { withNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";

function back(text: string): never {
  redirect(withNotice("/host/calendar", text));
}

function problem(error: unknown): string {
  if (error instanceof CalendarError) return error.message;
  console.error("[calendar] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

export async function saveChoices(formData: FormData) {
  const user = await requireUser();
  let notice: string;
  try {
    await calendarOf(user.id, user.timeZone);
    await saveCalendarChoices(user.id, {
      timeZone: String(formData.get("timeZone") ?? ""),
      lengths: formData.getAll("lengths").map(Number),
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
  const user = await requireUser();
  let notice: string;
  try {
    await addWeeklyHours(user.id, { weekday: Number(formData.get("weekday")), from: String(formData.get("from") ?? ""), to: String(formData.get("to") ?? "") });
    notice = "Those hours were added.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function removeHours(formData: FormData) {
  const user = await requireUser();
  await removeWeeklyHours(user.id, String(formData.get("id") ?? ""));
  back("Those hours were removed. Calls already booked in them still happen.");
}

export async function addOff(formData: FormData) {
  const user = await requireUser();
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
  const user = await requireUser();
  await removeTimeOff(user.id, String(formData.get("id") ?? ""));
  back("That time off was removed.");
}
