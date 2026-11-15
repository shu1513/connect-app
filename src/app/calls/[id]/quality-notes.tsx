"use client";

import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type Participant } from "livekit-client";
import { useEffect } from "react";
import { CONFIRM_EVERY_MS, NOTES_PER_BATCH, SEND_EVERY_MS } from "@/lib/quality/rules";

type Note = { about: "me" | "other"; grade: string; seenAt: number; seq: number };

/** Notes that could not be delivered are kept for the next try, up to this many. */
const KEEP_AT_MOST = 300;

/**
 * Notes the video service's grade for each person's connection, as this
 * browser sees it: when the person joins, at every change, and about twice a
 * minute in between ("still reporting"). Sends them in small batches in the
 * background. It shows nothing, and the call never waits for it.
 */
export function QualityNotes({ callId, serverNow }: { callId: string; serverNow: () => number }) {
  const room = useRoomContext();
  useEffect(() => {
    const url = `/api/calls/${callId}/quality`;
    // One id per connection of this person to the room; the notes are numbered within it.
    const connectionId = crypto.randomUUID();
    let seq = 0;
    let queue: Note[] = [];

    const note = (participant: Participant) => {
      if (queue.length >= KEEP_AT_MOST) queue.shift();
      queue.push({ about: participant.isLocal ? "me" : "other", grade: String(participant.connectionQuality), seenAt: serverNow(), seq: seq++ });
    };
    const noteEveryone = () => {
      if (room.state !== "connected") return;
      note(room.localParticipant);
      room.remoteParticipants.forEach((participant) => note(participant));
    };
    const onChange = (_quality: unknown, participant: Participant) => note(participant);

    const send = (leaving: boolean) => {
      if (queue.length === 0) return;
      const batch = queue.slice(0, NOTES_PER_BATCH);
      queue = queue.slice(batch.length);
      const body = JSON.stringify({ connectionId, notes: batch });
      // "keepalive" lets the last batch go out while the tab is closing.
      fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } })
        .then((response) => response.status < 500)
        .catch(() => false)
        .then((arrived) => {
          // Not delivered (a stumble in this person's own connection, most likely): try again with the next batch.
          // The server counts a note once however often it arrives.
          if (!arrived && !leaving) queue = [...batch, ...queue].slice(-KEEP_AT_MOST);
        });
    };

    room.on(RoomEvent.Connected, noteEveryone);
    room.on(RoomEvent.Reconnected, noteEveryone);
    room.on(RoomEvent.ParticipantConnected, note);
    room.on(RoomEvent.ConnectionQualityChanged, onChange);
    noteEveryone();
    const confirming = setInterval(noteEveryone, CONFIRM_EVERY_MS);
    const sending = setInterval(() => send(false), SEND_EVERY_MS);
    // On leaving, everything still waiting goes out, batch after batch: after a stretch of bad connection the
    // queue holds more than one batch, and those are the notes that matter most. (At most 300 short notes,
    // far below what a browser lets a closing page send.)
    const sendAll = () => {
      while (queue.length > 0) send(true);
    };
    const onHide = sendAll;
    window.addEventListener("pagehide", onHide);
    return () => {
      room.off(RoomEvent.Connected, noteEveryone);
      room.off(RoomEvent.Reconnected, noteEveryone);
      room.off(RoomEvent.ParticipantConnected, note);
      room.off(RoomEvent.ConnectionQualityChanged, onChange);
      clearInterval(confirming);
      clearInterval(sending);
      window.removeEventListener("pagehide", onHide);
      sendAll();
    };
  }, [room, callId, serverNow]);
  return null;
}
