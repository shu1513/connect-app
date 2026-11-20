/**
 * The sentences of "Confirm who you are", kept in one place so that the website's page and the
 * phone app say the same (plans/45-phone-apps/06-asking-for-a-call.md).
 */
import { IDENTITY_TRIES } from "./identity-rules";

export const IDENTITY_WORDS = {
  title: "Confirm who you are",
  passed: "Done. Your identity is confirmed.",
  what: "This confirms that you are a real adult. Hosts need it, and some hosts only take calls from people who have done it. You take a photo of your ID and a selfie on Stripe's own pages. We never see or keep the photos. Stripe tells us that you are a real person, your date of birth and the name on the ID. We use your date of birth only to check whether you are 18 or older. We do not keep it.",
  pending: "Your last check is still being looked at. This usually takes a minute or two.",
  noTries: `You have used all ${IDENTITY_TRIES} tries. Please write to us.`,
  /** Above the button, under the Identity Check Notice (plans/46-agreements-live.md, decision 9): pressing the button is the agreement. */
  agree: "By pressing the button you confirm that you have read this notice, and you agree that Stripe, for Connect, compares a picture of your face with your identity document as it describes.",
  noticeTitle: (draft: boolean) => `Identity Check Notice${draft ? " (draft, not in force yet)" : ""}`,
  noticeOpen: "open it on its own page",
  button: (pending: boolean) => (pending ? "I agree, start a new check at Stripe" : "I agree, continue to Stripe"),
  tries: (left: number) => `${left} of ${IDENTITY_TRIES} tries left`,
  small: "Hosts you ask for a call can see that your ID is confirmed. They never see your ID, your photos or the name on it.",
  notStarted: "The check could not be started. Please try again.",
} as const;
