import { useRef, useState } from "react";
import { Text } from "react-native";
import type { AppBooking, AppNoteSaved } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { isNoteSaved } from "@/lib/book-rules";
import { Button, Card, Field, Notice, Words } from "@/ui/pieces";
import { type, useColors } from "@/ui/theme";

/** From this many characters before the limit, the box says how much room is left. */
const SAY_ROOM_LEFT_FROM = 500;

type Note = NonNullable<NonNullable<AppBooking["host"]>["note"]>;

/**
 * A host's private notepad about one customer (plans/45-phone-apps/07-a-hosts-requests.md): one
 * note, kept from call to call, that only she ever sees. Whether she may keep it is decided on
 * the server.
 *
 * It answers in place, and what was typed is never lost over a refusal. The same notepad can be
 * open in several places: a save goes through only if the stored note is still the one this box
 * was showing, so the box sends that along. When the note was changed elsewhere meanwhile, the
 * box offers to take the stored note in, and until then keeps what was typed.
 */
export function NoteBox({ path, note }: { path: string; note: Note }) {
  const colors = useColors();
  /** The stored note as this box last knew it: what a save says it is replacing. */
  const [shown, setShown] = useState<string | null>(note.text);
  const [draft, setDraft] = useState(note.text ?? "");
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState<{ words: string; good: boolean } | null>(null);
  const busy = useRef(false);
  const left = note.max - draft.length;
  // The page reads the stored note again by itself. If it is no longer the one this box started from, a save from
  // here would be refused: say so, and offer to take the stored one in.
  const changedElsewhere = note.text !== shown;

  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setSaid(null);
    const answer = await ask<AppNoteSaved>(`${path}/note`, { body: { text: draft, shown } });
    if (answer.ok && isNoteSaved(answer.data)) {
      setShown(answer.data.text);
      setDraft(answer.data.text ?? "");
      setSaid({ words: answer.data.words, good: true });
    } else {
      // The server's own sentence (it ends with "nothing was saved, what you typed is still in the box").
      setSaid({ words: answer.ok ? UNREACHABLE : answer.message, good: false });
    }
    busy.current = false;
    setSaving(false);
  }

  return (
    <Card>
      <Field
        label={note.title}
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setSaid(null);
        }}
        editable={!saving}
        maxLength={note.max}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />
      <Words soft>{note.hint}</Words>
      {left <= SAY_ROOM_LEFT_FROM ? (
        <Text style={{ fontSize: type.small, lineHeight: 20, color: colors.soft }}>
          {Math.max(0, left)} {left === 1 ? "character" : "characters"} left.
        </Text>
      ) : null}
      {said ? said.good ? <Words soft>{said.words}</Words> : <Notice>{said.words}</Notice> : null}
      {changedElsewhere ? (
        <>
          <Notice>This note was changed somewhere else since this box was opened. What you typed here is still in the box.</Notice>
          <Button
            label="Show the note as it is stored now"
            kind="plain"
            onPress={() => {
              setShown(note.text);
              setDraft(note.text ?? "");
              setSaid(null);
            }}
          />
        </>
      ) : null}
      <Button label={note.save} kind="plain" busy={saving} onPress={() => void save()} />
    </Card>
  );
}
