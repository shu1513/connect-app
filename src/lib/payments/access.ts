/**
 * Who may see and act on a call and its payment. Always checked on the server.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { roleOnCall } from "@/lib/calls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CallAccess = { call: Call; payment: Payment | null; role: "host" | "customer" };

/** The call and its payment, but only if this person is its host or its customer. */
export async function callForParticipant(callId: string, userId: string): Promise<CallAccess | null> {
  if (!UUID.test(callId)) return null;
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!call) return null;
  const role = roleOnCall(call, userId);
  if (!role) return null;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
  return { call, payment: payment ?? null, role };
}

/** Like callForParticipant, but an admin may also look at any call (to review it). */
export async function callForViewer(
  callId: string,
  userId: string,
  /** Whether this is a full admin login (second step included). Only then may a non-participant look. */
  adminLogin: boolean,
): Promise<{ call: Call; payment: Payment | null; role: "host" | "customer" | "admin" } | null> {
  const access = await callForParticipant(callId, userId);
  if (access) return access;
  if (!UUID.test(callId) || !adminLogin) return null;
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!call) return null;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
  return { call, payment: payment ?? null, role: "admin" };
}

export async function isAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select().from(schema.admins).where(eq(schema.admins.userId, userId));
  return Boolean(row);
}

/** "$13.33" */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
