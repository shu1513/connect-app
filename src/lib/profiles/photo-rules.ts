/**
 * The plain rules of a host's photo (plans/29): its limits, which addresses a picture may be
 * fetched from, and which account a photo belongs to. Nothing in here touches the database or
 * the network.
 */

export const PHOTO = {
  /** For each host, in any 24 hours. A try counts from the moment it starts, however it ends. */
  triesPerDay: 5,
  /** A try that started less than this long ago and has not ended is still running: a second one is refused. After that it counts as stopped. */
  runningMs: 2 * 60_000,
  /** A picture larger than this is dropped while it is being read. */
  fetchMaxBytes: 5 * 1024 * 1024,
  /** Fetching a picture may take this long in all, reading included. */
  fetchWithinMs: 8_000,
} as const;

export type PhotoNetwork = "instagram" | "tiktok";

/**
 * The servers a network's pictures are fetched from: a server's name must end in one of these,
 * after a full stop. Only what was seen in real answers (plans/29). TikTok's are added in part
 * two, from a real answer.
 */
export const PICTURE_SERVERS: Record<PhotoNetwork, readonly string[]> = {
  instagram: ["fbcdn.net"],
  tiktok: [],
};

/**
 * The address a network gave for a picture, if Connect may fetch from it: https, no name and
 * password in it, no port of its own, and on one of the network's picture servers. Null otherwise.
 */
export function pictureAddress(text: string, servers: readonly string[]): URL | null {
  let address: URL;
  try {
    address = new URL(text);
  } catch {
    return null;
  }
  if (address.protocol !== "https:" || address.username !== "" || address.password !== "" || address.port !== "") return null;
  const host = address.hostname.toLowerCase();
  // A whole part of the name: "evilfbcdn.net" and "fbcdn.net.example.com" are other servers.
  return servers.some((server) => host.endsWith(`.${server}`)) ? address : null;
}

/** The last two parts of a server's name, for the log when a network names a server that is not allowed. Never the address. */
export function serverFamily(text: string): string {
  try {
    return new URL(text).hostname.toLowerCase().split(".").slice(-2).join(".").slice(0, 80);
  } catch {
    return "not an address";
  }
}

/**
 * Whether a photo still belongs to the host's confirmed entry on its network. `entry` is that
 * confirmed entry, or null when there is none. By the account's number when the entry has one
 * (proven by signing in), otherwise by its name (proven with the code, which proves a name).
 */
export function sameAccount(photo: { sourceNameKey: string; sourceAccountId: string }, entry: { nameKey: string; providerAccountId: string | null } | null): boolean {
  if (!entry) return false;
  return entry.providerAccountId ? entry.providerAccountId === photo.sourceAccountId : entry.nameKey === photo.sourceNameKey;
}
