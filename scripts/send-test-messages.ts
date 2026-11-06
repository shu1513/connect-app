/**
 * Testing tool: pretends to be LiveKit and sends a realistic series of signed
 * "connected" / "disconnected" messages for one call to the app on this computer.
 * Lets us check the attendance log and the results page without two phones.
 *
 * Usage: npx tsx scripts/send-test-messages.ts <call-id> [app-address]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AccessToken } from "livekit-server-sdk";

async function main() {
  const callId = process.argv[2];
  const appUrl = process.argv[3] ?? "http://localhost:3000";
  if (!callId) throw new Error("Give a call ID.");

  const { db, schema } = await import("../src/db");
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!call) throw new Error("Call not found.");

  const start = Math.floor(call.startsAt.getTime() / 1000);
  const end = Math.floor(call.endsAt.getTime() / 1000);
  if (end - start < 600) throw new Error("This script needs a call of at least 10 minutes.");
  const room = { sid: "RM_test", name: call.roomName };
  const message = (event: string, identity: string, sid: string, at: number) => ({
    id: `EV_${randomUUID()}`,
    event,
    room,
    participant: { sid, identity },
    createdAt: String(at),
  });

  // Host 10s late and leaves 30s early. Customer 70s late, drops for 30s, stays 20s past the end.
  const hostJoin = message("participant_joined", call.hostId, "PA_host_1", start + 10);
  const messages = [
    message("room_started", "", "", start + 9),
    hostJoin,
    message("participant_joined", call.customerId, "PA_cust_1", start + 70),
    message("participant_left", call.customerId, "PA_cust_1", start + 400),
    message("participant_joined", call.customerId, "PA_cust_2", start + 430),
    message("participant_left", call.hostId, "PA_host_1", end - 30),
    message("participant_left", call.customerId, "PA_cust_2", end + 20),
    hostJoin, // the same message again: must be ignored
  ];
  // Deliver out of order on purpose.
  messages.reverse();

  for (const m of messages) {
    const body = JSON.stringify(m);
    const signer = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    signer.sha256 = createHash("sha256").update(body).digest("base64");
    const response = await fetch(`${appUrl}/api/livekit/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/webhook+json", Authorization: await signer.toJwt() },
      body,
    });
    console.log(`${m.event.padEnd(20)} -> ${response.status} ${await response.text()}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
