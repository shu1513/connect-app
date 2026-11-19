/**
 * Connect's own checker, the last in the queue: the open-source NSFWJS, on Connect's own server.
 * It only looks for nudity, so its "clean" is never a full check (plans/23, "The queue").
 *
 * This file is the side that asks. The work itself is done in one thread of its own
 * (own-thread.ts), one picture at a time. The thread starts the first time it is needed and
 * stops after ten idle minutes. If it fails to start, stops by itself or takes too long, the
 * answer is a fault, the picture waits, and the thread is started fresh the next time.
 */
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { OwnReply } from "./own-thread";
import { isShare, type Answer, type Checker } from "./types";

const START_WITHIN_MS = 30_000;
const ANSWER_WITHIN_MS = 10_000;
const IDLE_MS = 10 * 60_000;
const NAMES = ["Drawing", "Hentai", "Neutral", "Porn", "Sexy"] as const;

/** What its five numbers mean for a picture. Exported for the tests. */
export function readOwn(classes: unknown): Answer {
  const share = new Map<string, number>();
  // Anything that makes the answer less than five classes, each once, each a share between 0 and 1.
  let unclear = !Array.isArray(classes);
  for (const entry of Array.isArray(classes) ? classes : []) {
    // A class that is not one of the five is not what this checker gives: the answer is not complete.
    if (typeof entry?.className !== "string" || !(NAMES as readonly string[]).includes(entry.className) || !isShare(entry.probability)) unclear = true;
    else {
      // A class given twice is unclear, and of its numbers the larger one is kept: a finding is never passed over.
      if (share.has(entry.className)) unclear = true;
      share.set(entry.className, Math.max(share.get(entry.className) ?? 0, entry.probability));
    }
  }
  // All five must be there: a missing one is not read as zero.
  if (NAMES.some((name) => !share.has(name))) unclear = true;
  const explicit = (share.get("Porn") ?? 0) + (share.get("Hentai") ?? 0);
  const sexy = share.get("Sexy") ?? 0;
  // A finding counts even when another part of the answer is missing.
  if (explicit >= 0.5 || sexy >= 0.8) return { kind: "flagged", detail: `Connect's own checker found nudity (explicit ${explicit.toFixed(2)}, suggestive ${sexy.toFixed(2)})`, partial: unclear };
  if (unclear) return { kind: "fault", detail: "Connect's own checker did not give its five numbers, each once and each between 0 and 1" };
  return { kind: "clean", detail: "Connect's own checker looked for nudity only" };
}

const START_FILE = path.resolve(process.cwd(), "src/lib/projects/checks/own-thread-start.mjs");
/** The file the thread is started from. Only the check script names another one, to see what a failed start does. */
let startFile = START_FILE;
let thread: Worker | null = null;
let ready: Promise<void> | null = null;
let idle: NodeJS.Timeout | null = null;
let nextId = 0;
const waiting = new Map<number, (reply: OwnReply) => void>();
/** One picture at a time: each waits for the one before. */
let line: Promise<unknown> = Promise.resolve();

function stop(): void {
  if (idle) clearTimeout(idle);
  idle = null;
  const old = thread;
  thread = null;
  ready = null;
  // Whoever is still waiting for an answer is told there will be none.
  for (const [id, tell] of waiting) tell({ id, error: "the thread stopped" });
  waiting.clear();
  void old?.terminate();
}

function start(): Promise<void> {
  if (thread && ready) return ready;
  const worker = new Worker(startFile);
  thread = worker;
  ready = new Promise<void>((resolve, reject) => {
    const tooSlow = setTimeout(() => reject(new Error("the thread did not start in time")), START_WITHIN_MS);
    worker.on("message", (reply: OwnReply) => {
      if ("ready" in reply) {
        clearTimeout(tooSlow);
        resolve();
      } else if ("failed" in reply) {
        clearTimeout(tooSlow);
        reject(new Error(reply.failed));
      } else waiting.get(reply.id)?.(reply);
    });
    worker.on("error", (error) => {
      clearTimeout(tooSlow);
      reject(error);
      if (thread === worker) stop();
    });
    worker.on("exit", () => {
      clearTimeout(tooSlow);
      reject(new Error("the thread stopped"));
      if (thread === worker) stop();
    });
  });
  // A failed start must not stay around as "the thread": the next picture starts a fresh one.
  ready.catch(() => {
    if (thread === worker) stop();
  });
  return ready;
}

async function ask(jpeg: Buffer): Promise<Answer> {
  if (idle) clearTimeout(idle);
  try {
    await start();
  } catch (error) {
    return { kind: "fault", detail: `Connect's own checker could not start: ${error instanceof Error ? error.message : "error"}` };
  }
  const worker = thread;
  if (!worker) return { kind: "fault", detail: "Connect's own checker is not running" };
  const id = ++nextId;
  const reply = await new Promise<OwnReply>((resolve) => {
    const tooSlow = setTimeout(() => {
      // It took too long: this thread is given up, and the next picture gets a fresh one.
      resolve({ id, error: "no answer in time" });
      if (thread === worker) stop();
    }, ANSWER_WITHIN_MS);
    waiting.set(id, (given) => {
      clearTimeout(tooSlow);
      resolve(given);
    });
    worker.postMessage({ id, jpeg: new Uint8Array(jpeg) });
  });
  waiting.delete(id);
  if (thread) {
    idle = setTimeout(stop, IDLE_MS);
    // An idle timer must never keep the helper or a script from ending.
    idle.unref();
  }
  if ("classes" in reply) return readOwn(reply.classes);
  return { kind: "fault", detail: `Connect's own checker failed: ${"error" in reply ? reply.error : "no answer"}` };
}

export function ownChecker(startFrom: string = START_FILE): Checker {
  return {
    name: "own",
    // It has no key. It is always part of the queue's last step.
    keyMark: "own",
    check: (jpeg) => {
      const turn = line.then(() => {
        startFile = startFrom;
        return ask(jpeg);
      });
      line = turn.catch(() => undefined);
      return turn;
    },
  };
}

/** Stops the thread now. For the check scripts, so they can end. */
export const stopOwnChecker = stop;
