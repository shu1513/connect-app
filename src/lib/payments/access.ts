/**
 * Who may see and act on a call and its payment. Always checked on the server.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { roleOnCall } from "@/lib/calls";
import { ownPaymentOf, paymentsOfCall } from "./own";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `payment` is the call's own payment. The payments of requests for more time are looked up with paymentsOfCall(). */
export type CallAccess = { call: Call; payment: Payment | null; role: "host" | "customer" };

/** The call and its own payment, but only if this person is its host or its customer. */
export async function callForParticipant(callId: string, userId: string): Promise<CallAccess | null> {
  if (!UUID.test(callId)) return null;
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!call) return null;
  const role = roleOnCall(call, userId);
  if (!role) return null;
  return { call, payment: await ownPaymentOf(call.id), role };
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
  return { call, payment: await ownPaymentOf(call.id), role: "admin" };
}

/**
 * The payment a refund form names, but only if it is one of that call's payments and this person
 * may refund it: the host of that very call, or the founder (with a full admin login). A call can
 * have several payments (its own, and one for each time more time was added), so the form says
 * which. A host can never reach a payment of somebody else's call by naming it with a call of their own.
 */
export async function paymentToRefund(input: { callId: string; paymentId: string; userId: string; adminLogin: boolean }): Promise<{ payment: Payment; decidedAs: "host" | "admin" } | "not_allowed" | "not_found"> {
  if (!UUID.test(input.callId) || !UUID.test(input.paymentId)) return "not_found";
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, input.callId));
  const decidedAs = call && call.hostId === input.userId ? "host" : input.adminLogin ? "admin" : null;
  if (!decidedAs) return "not_allowed";
  const payment = call ? (await paymentsOfCall(call.id)).find((p) => p.id === input.paymentId) : undefined;
  return payment ? { payment, decidedAs } : "not_found";
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
