/**
 * Social media names: turning what a host types into one clean name and one
 * link per network. Plain logic only, so it can be tested on its own.
 */

type NetworkRule = {
  label: string;
  /** Whether a link to an account on this network always has an @ before the name. */
  linkNeedsAt?: boolean;
  /** First parts of a link that are pages of the site itself (a post, a search), not an account. */
  notAccounts?: string[];
  /** What a cleaned-up name on this network may look like. */
  pattern: RegExp;
  /** The public link to an account, built by us and never taken from the host. */
  link: (name: string) => string;
  /** Web addresses this network uses, without "www." or "m.". */
  sites: string[];
};

export const NETWORKS = {
  instagram: {
    label: "Instagram",
    pattern: /^[a-z0-9._]{1,30}$/,
    link: (name) => `https://www.instagram.com/${name}/`,
    sites: ["instagram.com"],
    notAccounts: ["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "legal"],
  },
  tiktok: {
    label: "TikTok",
    pattern: /^[a-z0-9._]{2,24}$/,
    link: (name) => `https://www.tiktok.com/@${name}`,
    sites: ["tiktok.com"],
    linkNeedsAt: true,
  },
  youtube: {
    label: "YouTube",
    pattern: /^[a-z0-9._-]{3,30}$/,
    link: (name) => `https://www.youtube.com/@${name}`,
    sites: ["youtube.com"],
    linkNeedsAt: true,
  },
  x: {
    label: "X",
    pattern: /^[a-z0-9_]{1,15}$/,
    link: (name) => `https://x.com/${name}`,
    sites: ["x.com", "twitter.com"],
    notAccounts: ["home", "explore", "search", "i", "intent", "share", "hashtag", "settings", "notifications", "messages", "login", "signup"],
  },
} as const satisfies Record<string, NetworkRule>;

export type Network = keyof typeof NETWORKS;

export function isNetwork(value: string): value is Network {
  return Object.hasOwn(NETWORKS, value);
}

export type SocialName = { nameKey: string; url: string };

/**
 * Reads a name typed by a host: "@Name", "name", or the full link to the
 * account. Returns the cleaned-up name and our own link to it, or a problem.
 */
export function readSocialName(network: Network, typed: string): SocialName | { problem: string } {
  const rule: NetworkRule = NETWORKS[network];
  let name = typed.trim();
  if (!name) return { problem: "Enter the account's name." };

  if (/^https?:\/\//i.test(name) || name.includes("/")) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(name) ? name : `https://${name}`);
    } catch {
      return { problem: "That link could not be read. Enter just the account's name." };
    }
    const site = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
    if (!rule.sites.includes(site)) return { problem: `That is not a ${rule.label} link.` };
    const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
    // A link to a video, a post or a channel number is not a link to an account, and cannot be matched to a name.
    if (rule.linkNeedsAt && !first.startsWith("@")) {
      return { problem: `Enter the ${rule.label} name that starts with @, for example @yourname.` };
    }
    if (!first || rule.notAccounts?.includes(first.toLowerCase())) {
      return { problem: `That link does not lead to a ${rule.label} account. Enter just the account's name.` };
    }
    name = first;
  }

  const nameKey = name.replace(/^@/, "").toLowerCase();
  if (!rule.pattern.test(nameKey)) return { problem: `That does not look like a ${rule.label} name.` };
  return { nameKey, url: rule.link(nameKey) };
}
