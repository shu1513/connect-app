/**
 * The languages a host can hold a call in (plans/34-host-languages.md). No database and no network.
 *
 * A fixed list, so every host's answer is spelled the same way. Each language is saved as its
 * short international code, never as its name, so a name can be reworded here without touching
 * any host. The list is the languages of the countries a host can be based in (countries.ts), the
 * most spoken languages of the world, and two sign languages: the calls are video calls.
 *
 * Taking a language out of this list stops hosts choosing it, and it is no longer shown for the
 * hosts who had chosen it; it drops from their profile the next time they save.
 */
export const HOST_LANGUAGES = [
  { code: "ase", name: "American Sign Language" },
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "bfi", name: "British Sign Language" },
  { code: "bg", name: "Bulgarian" },
  { code: "yue", name: "Cantonese" },
  { code: "ca", name: "Catalan" },
  { code: "hr", name: "Croatian" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "et", name: "Estonian" },
  { code: "fil", name: "Filipino" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "ga", name: "Irish" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "lb", name: "Luxembourgish" },
  { code: "mt", name: "Maltese" },
  { code: "zh", name: "Mandarin Chinese" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pa", name: "Punjabi" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sr", name: "Serbian" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "ta", name: "Tamil" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" },
  { code: "cy", name: "Welsh" },
] as const;

/** A host chooses at least one language and at most this many. */
export const MAX_LANGUAGES = 5;

export const NO_LANGUAGE = "Choose at least one language you can hold a call in.";
export const TOO_MANY_LANGUAGES = `Choose at most ${MAX_LANGUAGES} languages.`;
export const UNKNOWN_LANGUAGE = "Choose your languages from the list.";

/**
 * What a host ticked, as it is saved: codes of the list, each once, in the list's own order
 * whatever order they came in. Or a problem the host can read: nothing chosen, too many, or
 * something that is not in the list (the whole choice is refused then, never quietly trimmed).
 */
export function chosenLanguages(sent: readonly unknown[]): { codes: string[] } | { problem: string } {
  if (sent.some((code) => !HOST_LANGUAGES.some((language) => language.code === code))) return { problem: UNKNOWN_LANGUAGE };
  const codes = HOST_LANGUAGES.map((language) => language.code as string).filter((code) => sent.includes(code));
  if (codes.length === 0) return { problem: NO_LANGUAGE };
  if (codes.length > MAX_LANGUAGES) return { problem: TOO_MANY_LANGUAGES };
  return { codes };
}

/**
 * The names to show for saved codes, in the list's order. A code that is no longer in the list
 * is left out, so the answer can be empty: a page then shows no "Languages" line at all.
 */
export function languageNames(codes: readonly string[]): string[] {
  return HOST_LANGUAGES.filter((language) => codes.includes(language.code)).map((language) => language.name);
}
