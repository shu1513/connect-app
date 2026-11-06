/**
 * Testing tool: asks LiveKit who is in a call's room right now.
 *
 * Usage: npx tsx scripts/room-status.ts <call-id>
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { RoomServiceClient } from "livekit-server-sdk";

async function main() {
  const callId = process.argv[2];
  if (!callId) throw new Error("Give a call ID.");
  const { db, schema } = await import("../src/db");
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
  if (!call) throw new Error("Call not found.");

  const service = new RoomServiceClient(
    process.env.LIVEKIT_URL!.replace(/^ws/, "http"),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
  const rooms = await service.listRooms([call.roomName]);
  if (rooms.length === 0) {
    console.log("The room does not exist at LiveKit right now (nobody is connected).");
  } else {
    const people = await service.listParticipants(call.roomName);
    console.log(`People connected: ${people.length}`);
    for (const p of people) {
      const role = p.identity === call.hostId ? "host" : p.identity === call.customerId ? "customer" : "UNKNOWN";
      console.log(`- ${p.name} (${role}), tracks published: ${p.tracks.length}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
