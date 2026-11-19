/**
 * The heart of the checking queue as one plain function: who is asked about a picture, in which
 * order, and what the answers mean for it (plans/23, "The queue"; plans/24, "How the queue
 * decides"). It knows nothing of the database.
 */
import type { Answer } from "./types";

export type Asked = { name: string; answer: Answer };

/** What happens to the picture after this try. */
export type Outcome =
  | { kind: "shown"; level: "full" | "nudity_only"; by: string; detail: string }
  | { kind: "refused"; by: string; detail: string }
  | { kind: "wait"; detail: string };

export type ServiceTurn = {
  name: string;
  /** Still in its five minutes after being out: not asked, counts as out. */
  cooling: boolean;
  /** Has given a complete, valid answer with the key it has now. */
  worked: boolean;
  check: () => Promise<Answer>;
};

/**
 * `services` are the outside services that have a key, in their order. `own` is Connect's own
 * checker, or null when it must not be asked: for a picture it has already passed, which is only
 * here to get its full check.
 *
 * `mayStillAsk` is asked before every single request. A try can take a while, and in that time the
 * founder may have held or locked the picture, or a report may have marked it: from that moment
 * it is sent to nobody else. (A request that is already on its way cannot be called back.)
 */
export async function askInOrder(services: ServiceTurn[], own: (() => Promise<Answer>) | null, mayStillAsk: () => Promise<boolean> = async () => true): Promise<{ outcome: Outcome; asked: Asked[] }> {
  const asked: Asked[] = [];
  const stopped = { outcome: { kind: "wait", detail: "Something was decided about this picture while it was being checked." } as Outcome, asked };
  // No service at all is never "every service is out".
  if (services.length === 0) return { outcome: { kind: "wait", detail: "No checking service is set up." }, asked };

  for (const service of services) {
    if (service.cooling) continue;
    if (!(await mayStillAsk())) return stopped;
    const answer = await service.check();
    asked.push({ name: service.name, answer });
    if (answer.kind === "clean") return { outcome: { kind: "shown", level: "full", by: service.name, detail: answer.detail }, asked };
    if (answer.kind === "flagged") return { outcome: { kind: "refused", by: service.name, detail: answer.detail }, asked };
    // A broken answer is not an outage: the picture waits, and nobody else is asked.
    if (answer.kind === "fault") return { outcome: { kind: "wait", detail: `${service.name} has a fault: ${answer.detail}` }, asked };
  }

  // Every service is out, just now or still in its five minutes.
  if (!own) return { outcome: { kind: "wait", detail: "Every checking service is out at the moment." }, asked };
  if (!services.some((service) => service.worked)) return { outcome: { kind: "wait", detail: "No checking service has worked yet with the key it has now." }, asked };
  if (!(await mayStillAsk())) return stopped;
  const answer = await own();
  asked.push({ name: "own", answer });
  if (answer.kind === "clean") return { outcome: { kind: "shown", level: "nudity_only", by: "own", detail: answer.detail }, asked };
  if (answer.kind === "flagged") return { outcome: { kind: "refused", by: "own", detail: answer.detail }, asked };
  return { outcome: { kind: "wait", detail: answer.detail }, asked };
}

/** How long a waiting picture waits before it is tried again: 1 minute, then 5, then every 15. */
export function waitMinutes(tries: number): number {
  return tries <= 1 ? 1 : tries === 2 ? 5 : 15;
}
