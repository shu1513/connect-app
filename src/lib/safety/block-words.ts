/**
 * The sentences about blocking someone, kept in one place so that the website and the phone app
 * say the same (plans/45-phone-apps/07-a-hosts-requests.md).
 */
export const BLOCK_WORDS = {
  label: (name: string) => `Block ${name}`,
  /** What blocking does, said before it is done. */
  what: (name: string) => `Block ${name}: they cannot ask you for calls any more`,
  /** The phone app asks once more before it blocks. */
  sure: (name: string) => `${name} will not be able to ask you for calls any more, and any requests or future calls between you end.`,
  yes: "Block",
  no: "Not now",
  done: "Blocked. They cannot ask you for calls any more, and any requests or future calls between you have ended.",
  notCancelled: (calls: number) =>
    `Blocked. ${calls} future ${calls === 1 ? "call" : "calls"} between you could not be cancelled just now; please cancel ${calls === 1 ? "it" : "them"} from your calls page, or try again in a minute.`,
  wrong: "Something went wrong. Please try again.",
} as const;
