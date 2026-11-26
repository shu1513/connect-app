/**
 * The plain rules of a project and its diary (plans/23 and plans/24). No database and no
 * network, so every line can be tested on its own.
 */

/** Something a person asked for cannot be done, for a reason they can read. Nothing was changed. */
export class ProjectError extends Error {}

export const PROJECT = {
  nameMin: 2,
  nameMax: 80,
  descriptionMax: 1000,
  postTextMax: 5000,
  linksMax: 3,
  /**
   * The longest address a link box takes. It has to hold the longest address we ourselves write:
   * a channel name of 30 letters, each written out in up to 12 characters of codes.
   */
  linkMax: 400,
  /** How many posts a page of the diary shows. */
  postsPerPage: 10,
} as const;

/** The limits of a diary's pictures (plans/23, "Pictures"; plans/24). */
export const PICTURE = {
  perPost: 4,
  /** For each host, in any 24 hours. Every upload counts, also one that is flagged, removed or replaced. */
  perDay: 20,
  /** The largest file a host can upload. */
  uploadMaxBytes: 10 * 1024 * 1024,
  /** Room for the form around the file, on top of the file itself. */
  formOverheadBytes: 64 * 1024,
  /** A file that would unpack into more points than this is refused before it is unpacked. */
  maxPixels: 50_000_000,
  /** A picture smaller than this on either side is refused: it shows nothing, and one checking service cannot read it. */
  minSide: 100,
  /** Connect's copy is no wider or taller than this, */
  side: 1600,
  /** and no larger than this. */
  maxBytes: 1024 * 1024,
  /** The JPEG qualities tried in turn until the copy is small enough. */
  qualities: [82, 70, 60],
  /** The version of these rules and of the checkers' thresholds. Kept with every answer a checker gives. */
  rulesVersion: "2026-11-18",
} as const;

export type PictureKind = "jpeg" | "png" | "webp";

/**
 * What kind of picture a file is, read from its first bytes: never from its name or from what the
 * browser says about it. Null for everything else (a phone's HEIC, SVG, GIF, AVIF, and anything
 * that is not a picture at all).
 */
export function pictureKind(bytes: Uint8Array): PictureKind | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0xff, 0xd8, 0xff)) return "jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  // "RIFF", four bytes of length, "WEBP".
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return null;
}

/**
 * Whether a PNG is an animated one. Such a file carries a part named "acTL" before its picture
 * data. The parts are walked in order, each by its own stated length, up to the first "IDAT".
 */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (name === "acTL") return true;
    if (name === "IDAT" || name === "IEND") return false;
    at += 12 + length;
  }
  return false;
}

/**
 * Characters nobody types on purpose and nobody can see: the control characters, apart from a new
 * line and a tab. They are taken out. (The database cannot keep the first of them at all, and
 * would answer with an error nobody could understand.)
 */
const UNSEEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Text as it is kept: the same line ends everywhere, nothing unseen in it, and no space around it. */
export function tidyText(typed: string): string {
  return typed.replace(/\r\n?/g, "\n").replace(UNSEEN, "").trim();
}

/** A name is one line. */
export function tidyName(typed: string): string {
  return typed.replace(UNSEEN, "").replace(/\s+/g, " ").trim();
}

/** Says what is wrong with a tidied name and description, or null when they are fine. */
export function projectProblem(input: { name: string; description: string }): string | null {
  if (input.name.length < PROJECT.nameMin) return "Give your project a name.";
  if (input.name.length > PROJECT.nameMax) return `Please keep the name under ${PROJECT.nameMax} characters.`;
  if (input.description.length > PROJECT.descriptionMax) return `Please keep the description under ${PROJECT.descriptionMax} characters.`;
  return null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
/** A channel's @name: letters and numbers of any language, with dots, underscores and hyphens. */
const CHANNEL_NAME = /^@[\p{L}\p{N}._-]{3,30}$/u;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/**
 * A YouTube address as we keep and show it, or null for anything else. What comes back is never
 * what was typed: it is built here from the one part we read (a video's or a channel's id), so
 * nothing else a person put into the address can reach a page. Only a video and a channel are
 * taken: a watch link, a short link, a "short", a live video, a channel by its @name or by its id.
 */
export function youtubeLink(typed: string): string | null {
  const text = typed.trim();
  if (text.length === 0 || text.length > PROJECT.linkMax || /\s/.test(text)) return null;
  let url: URL;
  try {
    // An address typed without "https://" is read as if it had it. Any other kind of address is refused below.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  // "http" is read and then written as "https" like everything else, because only the id is kept.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return parts.length === 1 && VIDEO_ID.test(parts[0]) ? `https://youtu.be/${parts[0]}` : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (parts.length === 1 && parts[0] === "watch") {
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  if (parts.length === 2 && (parts[0] === "shorts" || parts[0] === "live") && VIDEO_ID.test(parts[1])) {
    return `https://www.youtube.com/${parts[0]}/${parts[1]}`;
  }
  if (parts.length === 2 && parts[0] === "channel" && CHANNEL_ID.test(parts[1])) {
    return `https://www.youtube.com/channel/${parts[1]}`;
  }
  if (parts.length === 1) {
    // A name in another alphabet arrives written out in codes (as a browser copies it) or as it reads.
    // It is read as it reads, checked, and written out in codes again: one form, whichever was typed.
    let name: string;
    try {
      name = decodeURIComponent(parts[0]);
    } catch {
      return null;
    }
    if (CHANNEL_NAME.test(name)) return `https://www.youtube.com/@${encodeURIComponent(name.slice(1))}`;
  }
  return null;
}

/**
 * A post as it will be kept, from what the host typed: the text tidied, and each link box read as
 * a YouTube address. Empty boxes are left out; the same address twice is kept once. Throws
 * ProjectError, with words for the host, when something is not right.
 */
export function readPost(input: { text: string; links: string[] }): { text: string; links: string[] } {
  const text = tidyText(input.text);
  if (text.length === 0) throw new ProjectError("Write something in your post first.");
  if (text.length > PROJECT.postTextMax) throw new ProjectError(`Please keep a post under ${PROJECT.postTextMax} characters.`);
  const links: string[] = [];
  for (const typed of input.links) {
    if (typed.trim() === "") continue;
    const link = youtubeLink(typed);
    if (!link) throw new ProjectError("A link must be the address of a YouTube video or channel, for example https://www.youtube.com/watch?v=… or https://youtu.be/…");
    if (!links.includes(link)) links.push(link);
  }
  if (links.length > PROJECT.linksMax) throw new ProjectError(`A post can have up to ${PROJECT.linksMax} YouTube links.`);
  return { text, links };
}

/** A post's links as they are kept (one per line), and read back. Only addresses youtubeLink still accepts come out. */
export const linksToText = (links: string[]): string => links.join("\n");
export const linksOf = (kept: string): string[] => kept.split("\n").filter((line) => youtubeLink(line) === line);

/** The first lines of a text, for a box that only shows a taste of it. Cut at a word where it can be. */
export function firstLines(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  const cut = oneLine.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/**
 * What the box after a call is decided from (plans/23, "After a call"; plans/26). Each is read
 * from what is recorded, by `askAfterCall`; nothing is guessed.
 */
export type AskFacts = {
  /** Who is looking at the call's results. */
  role: "host" | "customer" | "admin";
  cancelled: boolean;
  /** Ended with the call's button ("End call now", or the earlier "End call and report"). */
  safetyEnded: boolean;
  /** The call's record is final and complete, as the charge judges it. A record that needs review is not. */
  recordFinal: boolean;
  /** Time the two were in the room together. Null while the record has no totals. */
  togetherSeconds: number | null;
  /** Either has reported the other, about anything, whatever became of the report. */
  reported: boolean;
  blocked: boolean;
  /** The customer asked for a refund of this call, whatever became of the request. */
  refundAsked: boolean;
  /** The host has a running project, and her page is open to everyone. */
  projectShown: boolean;
  /** The customer could contribute to it right now (plans/25, choice 4). */
  mayContribute: boolean;
  /** A monthly contribution of theirs to it is being set up or running, or a payment of theirs to it was ever held or taken. */
  alreadyContributes: boolean;
};

/** Whether the customer is shown the host's project after this call. Every condition must hold. */
export function mayAsk(facts: AskFacts): boolean {
  if (facts.role !== "customer") return false;
  // The call took place.
  if (facts.cancelled || !facts.recordFinal || (facts.togetherSeconds ?? 0) <= 0) return false;
  if (facts.safetyEnded || facts.reported || facts.blocked || facts.refundAsked) return false;
  return facts.projectShown && facts.mayContribute && !facts.alreadyContributes;
}
