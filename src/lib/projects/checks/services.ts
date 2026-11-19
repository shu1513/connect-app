/**
 * The outside checking services, for everything that asks them about a picture: the diary's queue
 * (../queue.ts) and a host's photo (plans/29). Who is asked in which order, and what the answers
 * mean for the picture, is `askInOrder` in order.ts. Here is what goes around it and is the same
 * for every asker: the list of services, their turns, and what each answer means for the service
 * itself.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { adminUrl, tellFounders } from "../picture-steps";
import { azureChecker } from "./azure";
import { openAiChecker } from "./openai";
import type { Asked, ServiceTurn } from "./order";
import { sightengineChecker } from "./sightengine";
import type { Answer, Checker } from "./types";

const checkers = schema.pictureCheckers;

/** A service that was out is not asked again for this long. */
export const COOL_MS = 5 * 60_000;
const DAY_MS = 24 * 3_600_000;

/** The outside services, in their order. */
export const services = (): Checker[] => [openAiChecker(), azureChecker(), sightengineChecker()];

/** A checker that fails in any way, at once or later, is a fault for this picture, never the end of the work around it. */
export async function safely(check: () => Promise<Answer>): Promise<Answer> {
  try {
    return await check();
  } catch (error) {
    return { kind: "fault", detail: `the checker failed: ${error instanceof Error ? error.message : "error"}`.slice(0, 220) };
  }
}

/** The turns of these services for one picture, for `askInOrder`. */
export async function turnsFor(asked: Checker[], bytes: Buffer, now: () => Date): Promise<ServiceTurn[]> {
  const rows = await db.select().from(checkers);
  return asked.map((service) => {
    const row = rows.find((line) => line.service === service.name);
    // Whether its five minutes are running is read when its turn comes, not now: an earlier service may take a while
    // to answer, and someone else may have written something about this one in that time.
    const cooling = async () => {
      const [line] = await db.select({ outUntil: checkers.outUntil }).from(checkers).where(eq(checkers.service, service.name));
      return Boolean(line?.outUntil && line.outUntil > now());
    };
    return { name: service.name, cooling, worked: Boolean(service.keyMark) && row?.lastGoodKey === service.keyMark, check: () => safely(() => service.check(bytes)) };
  });
}

/**
 * What each service's answer means for the service itself. Its last answer says how it stands: a
 * complete, valid answer is remembered with the key that gave it; "out" starts its five minutes;
 * a fault is written down, ends any five minutes that were running (a fault is never waited out:
 * the service is asked again for the next picture), and the founder is emailed at once and then
 * at most once a day.
 */
export async function recordAnswers(asked: Checker[], answers: Asked[], at: Date): Promise<void> {
  for (const { name, answer } of answers) {
    const service = asked.find((one) => one.name === name);
    if (!service) continue; // Connect's own checker has no line: when it fails, the picture's own line says so.
    await db.transaction(async (tx) => {
      await tx.insert(checkers).values({ service: name }).onConflictDoNothing();
      const [row] = await tx.select().from(checkers).where(eq(checkers.service, name)).for("update");
      if (answer.kind === "flagged" && answer.partial) {
        // The picture is refused, but an answer with parts missing does not show that the service works with this key. Nothing is written about the service.
      } else if (answer.kind === "clean" || answer.kind === "flagged") {
        await tx.update(checkers).set({ lastGoodAt: at, lastGoodKey: service.keyMark, outUntil: null, faultSince: null, faultDetail: null, faultToldAt: null }).where(eq(checkers.service, name));
      } else if (answer.kind === "out") {
        // It answers again, if only to say "not now": that is no longer a fault. (When the founder was last told stays, so a service that goes back and forth does not send an email each time.)
        await tx.update(checkers).set({ outUntil: new Date(at.getTime() + COOL_MS), faultSince: null, faultDetail: null }).where(eq(checkers.service, name));
      } else {
        const tell = !row.faultToldAt || at.getTime() - row.faultToldAt.getTime() >= DAY_MS;
        await tx.update(checkers).set({ outUntil: null, faultSince: row.faultSince ?? at, faultDetail: answer.detail, faultToldAt: tell ? at : row.faultToldAt }).where(eq(checkers.service, name));
        if (tell) {
          await tellFounders(tx, {
            subject: `A picture checking service has a fault: ${name}`,
            text: `The picture checking service "${name}" gave an answer Connect could not use:\n\n${answer.detail}\n\nThis is not the same as the service being used up. While it lasts, new pictures wait and are shown to nobody. The usual cause is a wrong or expired key. Put the right key into the settings, or take that service's key out, which takes the service out of the queue.\n\n${adminUrl()}`,
            key: `picture-checker-fault:${name}:${at.toISOString()}`,
          });
        }
      }
    });
  }
}
