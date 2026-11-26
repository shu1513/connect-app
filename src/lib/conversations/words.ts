/**
 * The sentences of a conversation (plans/49-messaging.md). One place, so the page and the answer
 * to a form that was sent a moment too late always say the same thing.
 */
import { CONVERSATION, type LimitProblem, type Refusal } from "./rules";

/**
 * Why this person cannot write, in words for them. `name` is the other person as this person
 * knows them. A host whom the customer blocked and one he switched off read the same sentence
 * (decision 15): the refusal itself never names the reason.
 */
export function refusalWords(why: Refusal, name: string): string {
  switch (why) {
    case "switched_off":
      return "Messages are switched off for the moment. You can still read this conversation.";
    case "you_blocked":
      return "You blocked this person.";
    case "not_taking":
      return `${name} is not taking messages right now.`;
    case "paused":
      return "Your account is paused, so you cannot write. You can still read this conversation.";
    case "page_not_public":
      return `Your page is not public right now, so you can write to ${name} only around a call.`;
    case "you_muted":
      return `You stopped messages from ${name} between calls.`;
    case "book_again":
      return `Book a call to write to ${name} again.`;
    case "closed":
      return "This conversation is closed.";
  }
}

export function limitWords(problem: LimitProblem, name: string): string {
  switch (problem) {
    case "in_a_row":
      return `You have sent ${CONVERSATION.inARow} messages in a row. You can write again when ${name} has answered.`;
    case "wakes":
      return "You have written to a lot of people today. Please try again tomorrow.";
    case "minute":
      return "That was a lot of messages in a short time. Please wait a minute.";
    case "day":
      return "You have sent a lot of messages today. Please try again tomorrow.";
  }
}

export const CONVERSATION_WORDS = {
  tooLong: `Please keep a message under ${CONVERSATION.maxChars} characters.`,
  empty: "Write something first.",
  notFound: "This conversation is not there.",
  wrong: "Something went wrong. Your message was not sent. Please try again.",
  /** The line beside the box (decision 25). */
  staysOnConnect: "Calls and payments for them stay on Connect.",
  write: (name: string) => `Write to ${name}`,
  mute: (name: string) => `Stop messages from ${name} between calls`,
  unmute: (name: string) => `Allow messages from ${name} again`,
  muteExplained: (name: string) => `With this on, ${name} can write to you only around a call you booked with them.`,
  bookATime: (name: string) => `Book a time with ${name}`,
  bookToWrite: (name: string) => `Book a call to write to ${name} again`,
} as const;
