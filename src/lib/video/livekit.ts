/**
 * The only file that talks to LiveKit. It does three things:
 *   1. hands out entry passes,
 *   2. closes rooms,
 *   3. translates LiveKit's messages into our own plain shape.
 *
 * Swapping to another video service means rewriting this file (and the call
 * screen), not the time calculation.
 */
import { AccessToken, RoomServiceClient, WebhookReceiver } from "livekit-server-sdk";

export const VIDEO_PROVIDER = "livekit";

/** Entry passes are short-lived so that a removed person cannot come back with an old one. */
const ENTRY_PASS_LIFETIME = "10m";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Check .env.local.`);
  return value;
}

/** The address browsers connect to (starts with wss://). */
export function videoServerUrl(): string {
  return env("LIVEKIT_URL");
}

function roomService(): RoomServiceClient {
  const httpUrl = videoServerUrl().replace(/^ws/, "http");
  return new RoomServiceClient(httpUrl, env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"));
}

/**
 * Creates an entry pass for one person and one room.
 * The person's identity is their account ID: one person, one connection per call.
 */
export async function createEntryPass(input: {
  roomName: string;
  userId: string;
  displayName: string;
}): Promise<string> {
  const token = new AccessToken(env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"), {
    identity: input.userId,
    name: input.displayName,
    ttl: ENTRY_PASS_LIFETIME,
  });
  token.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,
    canSubscribe: true,
  });
  return token.toJwt();
}

export type VideoEvent = {
  provider: typeof VIDEO_PROVIDER;
  /** LiveKit's unique ID for this message. */
  id: string;
  /** LiveKit's event name, e.g. "participant_joined". */
  type: string;
  roomName: string | null;
  roomSessionId: string | null;
  participantIdentity: string | null;
  participantSessionId: string | null;
  /** LiveKit's own time on the message. */
  time: Date;
};

/**
 * Checks that a message really came from LiveKit and translates it.
 * Throws if the signature does not match.
 */
export async function readVideoEvent(rawBody: string, authHeader: string | null): Promise<VideoEvent> {
  const receiver = new WebhookReceiver(env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"));
  const event = await receiver.receive(rawBody, authHeader ?? undefined);
  return {
    provider: VIDEO_PROVIDER,
    id: event.id,
    type: event.event,
    roomName: event.room?.name || null,
    roomSessionId: event.room?.sid || null,
    participantIdentity: event.participant?.identity || null,
    participantSessionId: event.participant?.sid || null,
    time: new Date(Number(event.createdAt) * 1000),
  };
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string })?.code === "not_found";
}

/** Whether the room exists at LiveKit right now (it only exists while someone is connected). */
export async function roomExists(roomName: string): Promise<boolean> {
  const rooms = await roomService().listRooms([roomName]);
  return rooms.length > 0;
}

/**
 * Closes a room: removes both people and cancels their entry passes (this works
 * even for someone who is not connected right now), deletes the room, then
 * checks it is gone. Returns true only when LiveKit confirms nobody is left.
 *
 * Throws if cancelling an entry pass fails, so the caller tries again instead
 * of recording the room as closed.
 */
export async function closeRoom(roomName: string, userIds: string[]): Promise<boolean> {
  const service = roomService();
  const cutoff = BigInt(Math.floor(Date.now() / 1000));

  // With an explicit cutoff LiveKit answers "success" even when the person or
  // the room is already gone, so any error here is a real failure.
  for (const userId of userIds) {
    await service.removeParticipant(roomName, userId, { revokeTokenTs: cutoff });
  }
  try {
    await service.deleteRoom(roomName);
  } catch (error) {
    if (!isNotFound(error)) throw error; // "not found" just means it was already gone
  }

  return !(await roomExists(roomName));
}
