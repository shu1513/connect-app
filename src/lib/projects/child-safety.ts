/**
 * The one place that knows the rule for the check against known pictures of child abuse
 * (plans/23, "Pictures of child abuse"; plans/24). The upload, the queue, the founder's "Show"
 * and the picture's address all ask here. If the rule changes, only this file changes.
 *
 * The rule, as the founder decided it (18 November 2026): pictures do not wait for the tool.
 * Before it is switched on, a picture is marked `not_set_up` and goes on to the everyday checkers.
 * From the moment the tool first answers correctly it counts as switched on, for good, whether or
 * not its settings are still there: every picture uploaded from then on waits for the tool's own
 * answer, and nothing gets round that. A picture that is suspected, by the founder or through a
 * report for "someone under 18", or that the tool matched, goes to no everyday checker at all.
 *
 * The tool itself (Image Intercept) needs an application that is not answered yet. Until Connect
 * has access there is no tool: `childTool` gives null. What is here is the rule around it, and it
 * is tried with a stand-in tool in the check script.
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProjectPicture } from "@/db/schema";

/** What the tool says about one picture. "unreachable" is no answer: the picture waits. */
export type ChildAnswer = "clear" | "match" | "unreachable";
/**
 * What the tool's own file must keep to. `ask` gives up by itself, with "unreachable", well inside
 * the two minutes for which the queue holds a picture (queue.ts): then a picture is never asked
 * about twice at the same time. The queue stops waiting after fifteen seconds and goes on with
 * other work, but an answer that comes later is still written, and a match always counts.
 */
export type ChildTool = { ask: (jpeg: Buffer) => Promise<ChildAnswer> };

/** The tool Connect has, or null. None yet: its file is added when access is granted. */
export function childTool(): ChildTool | null {
  return null;
}

type Marks = Pick<ProjectPicture, "childCheck" | "suspectedByFounder" | "suspectedByReport">;

/** Whether the tool has been switched on: it has answered correctly at least once. */
export async function childCheckOn(reader: Pick<typeof db, "select"> = db): Promise<boolean> {
  const [row] = await reader.select({ at: schema.siteSwitches.childCheckOnAt }).from(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1));
  return Boolean(row?.at);
}

/** Written the first time the tool gives a real answer. The first moment stays: it is never moved and never taken back. */
export async function switchChildCheckOn(now: Date): Promise<void> {
  await db
    .insert(schema.siteSwitches)
    .values({ id: 1, childCheckOnAt: now })
    .onConflictDoUpdate({ target: schema.siteSwitches.id, set: { childCheckOnAt: sql`coalesce(${schema.siteSwitches.childCheckOnAt}, ${now.toISOString()}::timestamptz)` } });
}

/** May pictures be uploaded at all? Yes, with or without the tool (the founder's decision). */
export const mayUpload = (): boolean => true;

/** How a new picture starts: waiting for the tool once it is switched on, and marked `not_set_up` before. */
export const startingChildCheck = (on: boolean): "waiting" | "not_set_up" => (on ? "waiting" : "not_set_up");

/** A picture the founder or a report holds as suspected, or that the tool matched. */
export const isSuspected = (picture: Marks): boolean => picture.suspectedByFounder || picture.suspectedByReport || picture.childCheck === "match";

/**
 * May this picture go to the everyday checkers, or be shown by the founder? Never when it is
 * suspected. Otherwise when the tool has said "clear", or was not switched on when it was uploaded.
 */
export function mayGoOn(picture: Marks): boolean {
  if (isSuspected(picture)) return false;
  return picture.childCheck === "clear" || picture.childCheck === "not_set_up";
}

/**
 * May this picture be handed to anyone at all? Not while the tool, switched on, has not answered
 * for it, and not once it matched. This comes before every other rule about who sees a picture.
 */
export const mayBeFetched = (picture: Marks): boolean => picture.childCheck !== "waiting" && picture.childCheck !== "match";
