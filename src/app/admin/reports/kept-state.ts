import type { KeptMessage } from "@/lib/safety/kept-messages";

/** What the founder's "Read the kept messages" button answers with (kept-messages.tsx). */
export type KeptState = { error: string | null; kept: { reportedNumber: number; olderLeftOut: number; messages: KeptMessage[] } | null };
