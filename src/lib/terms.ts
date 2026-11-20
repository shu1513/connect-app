import { generalStamp } from "@/legal/versions";

/**
 * The stamp of the general documents (the Terms of Service, the Payment Terms and the Community
 * Rules) in the versions in effect when this file was loaded: what a person's own line carries
 * once they have finished sign-up (plans/46-agreements-live.md, decision 5).
 *
 * Kept under its old name for the check scripts, which write it onto their test people, and for
 * the phone app's door. Code that runs for a long time asks `generalStamp(now)` instead (the gate
 * in session.ts, the welcome step), because a new version can take effect while the server runs.
 */
export const TERMS_VERSION = generalStamp(new Date());

/** Where people write to appeal or ask for help. A placeholder until the company has its own. */
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@connect.example";

/**
 * The rules of the site in short, for the founder's warning and pause forms and the emails they send. The full
 * text people accept is the Community Rules document; the report form has its own list (REPORT_REASONS).
 */
export const RULES = [
  { key: "sexual", title: "No nudity, sexual acts or sexual services", text: "Connect is not for that, and our payment company does not allow it." },
  { key: "under18", title: "Nobody under 18", text: "Everyone on a call must be an adult." },
  { key: "impersonation", title: "No pretending to be someone else", text: "Your name, your face, your accounts." },
  { key: "harassment", title: "No threats, harassment or hate", text: "Treat the other person with respect." },
  { key: "scam", title: "No scams", text: "No tricks to get money or information out of the other person." },
  { key: "privacy", title: "No sharing someone's private details", text: "What is said on a call stays between you." },
  { key: "recording", title: "No recording", text: "Do not record a call. We do not record them either." },
  { key: "illegal", title: "Nothing illegal", text: "" },
  { key: "offsite", title: "No paying for a Connect call outside Connect", text: "That is what keeps both people protected." },
  // Added with the Community Rules document (src/legal/documents/community-rules). The nine keys above are looked
  // up by name (a pause for an age under 18, the founder's warning and pause forms) and never change.
  { key: "advice", title: "No professional advice without the right to give it", text: "Sharing your own experience is fine. Presenting it as medical, legal or financial advice is not." },
  { key: "spam", title: "No spam and no misuse of the service", text: "No mass requests, no advertising on calls, no second account." },
  { key: "content", title: "Only post what is yours", text: "Photos, pictures, text and links must be yours to post and follow these rules." },
] as const;
