/**
 * The version of the terms and rules a person accepts on the welcome page.
 * Change it when they change: everyone is then asked to accept again the next
 * time they log in.
 */
export const TERMS_VERSION = "2026-11-rules";

/** Where people write to appeal or ask for help. A placeholder until the company has its own. */
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@connect.example";

/** The rules of the site, in one place: the rules page, the warning email and the report form use them. */
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
] as const;
