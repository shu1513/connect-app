/**
 * Finding a host by name, handle or confirmed social media name. Who can be
 * found is decided inside the query itself, before anything is ordered or cut
 * to the number shown: only approved, visible hosts whose account is neither
 * closed nor paused, and never someone blocked either way by the person
 * searching. The cleaning and ordering rules are plain logic in search-rules.ts.
 */
import { and, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { averagesFor } from "@/lib/ratings/ratings";
import type { ShownAverage } from "@/lib/ratings/rules";
import { containsPattern, keyUsable, orderResults, SEARCH, searchTerms } from "./search-rules";
import { isNetwork, NETWORKS, type Network } from "./social";

export type SearchResult = {
  handle: string;
  displayName: string;
  about: string;
  pricePer15Cents: number;
  socials: Array<{ network: Network; label: string; name: string }>;
  rating: ShownAverage | null;
};

const hostId = schema.hostProfiles.userId;

/** "This host has a confirmed social account whose name fits." `s` is that account inside the condition. */
function confirmedSocial(fits: SQL): SQL {
  return sql`exists (select 1 from ${schema.socialAccounts} s where s.user_id = ${hostId} and s.confirmed_at is not null and ${fits})`;
}

export async function searchHosts(typed: string, viewerId: string | null, now: Date): Promise<SearchResult[]> {
  const terms = searchTerms(typed);
  if (!terms) return [];
  const loose = keyUsable(terms);
  const text = terms.text;
  const key = terms.key;
  const prefix = (term: string) => containsPattern(term).slice(1); // "term%": starts with

  const canBeFound = and(
    eq(schema.hostProfiles.status, "approved"),
    eq(schema.hostProfiles.hidden, false),
    isNull(schema.user.closedAt),
    isNull(schema.user.pausedAt),
    viewerId
      ? sql`not exists (select 1 from ${schema.blocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${hostId}) or (b.blocker_id = ${hostId} and b.blocked_id = ${viewerId}))`
      : undefined,
  );
  const contains = or(
    ilike(schema.hostProfiles.displayName, containsPattern(text)),
    ilike(schema.hostProfiles.handle, containsPattern(text)),
    confirmedSocial(sql`s.name_key ilike ${containsPattern(text)}`),
    loose ? ilike(schema.hostProfiles.handleKey, containsPattern(key)) : undefined,
    loose ? confirmedSocial(sql`replace(s.name_key, '_', '') ilike ${containsPattern(key)}`) : undefined,
  );
  // The same four steps as matchRank in search-rules.ts.
  const exact = or(eq(schema.hostProfiles.handle, text), confirmedSocial(sql`s.name_key = ${text}`));
  const nearlyExact = or(
    sql`lower(${schema.hostProfiles.displayName}) = ${text}`,
    loose ? eq(schema.hostProfiles.handleKey, key) : undefined,
    loose ? confirmedSocial(sql`replace(s.name_key, '_', '') = ${key}`) : undefined,
  );
  const startsWith = or(
    ilike(schema.hostProfiles.displayName, prefix(text)),
    ilike(schema.hostProfiles.handle, prefix(text)),
    confirmedSocial(sql`s.name_key ilike ${prefix(text)}`),
    loose ? ilike(schema.hostProfiles.handleKey, prefix(key)) : undefined,
    loose ? confirmedSocial(sql`replace(s.name_key, '_', '') ilike ${prefix(key)}`) : undefined,
  );

  // Best matches first, so the cut to the number shown never drops an exact match for a looser one.
  const hosts = await db
    .select({
      userId: hostId,
      handle: schema.hostProfiles.handle,
      handleKey: schema.hostProfiles.handleKey,
      displayName: schema.hostProfiles.displayName,
      about: schema.hostProfiles.about,
      pricePer15Cents: schema.hostProfiles.pricePer15Cents,
    })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, hostId))
    .where(and(canBeFound, contains))
    .orderBy(sql`case when ${exact} then 0 when ${nearlyExact} then 1 when ${startsWith} then 2 else 3 end`, schema.hostProfiles.displayName, schema.hostProfiles.handle)
    .limit(SEARCH.results);
  if (hosts.length === 0) return [];

  const ids = hosts.map((h) => h.userId);
  const [socials, ratings] = await Promise.all([
    db
      .select({ userId: schema.socialAccounts.userId, network: schema.socialAccounts.network, nameKey: schema.socialAccounts.nameKey })
      .from(schema.socialAccounts)
      .where(and(inArray(schema.socialAccounts.userId, ids), isNotNull(schema.socialAccounts.confirmedAt))),
    averagesFor(ids, "host", now),
  ]);
  const withSocials = hosts.map((host) => ({
    ...host,
    socials: socials.filter((s) => s.userId === host.userId && isNetwork(s.network)).map((s) => s.nameKey),
    shownSocials: socials
      .filter((s) => s.userId === host.userId && isNetwork(s.network))
      .map((s) => ({ network: s.network as Network, label: NETWORKS[s.network as Network].label, name: s.nameKey })),
  }));
  return orderResults(withSocials, terms).map((host) => ({
    handle: host.handle,
    displayName: host.displayName,
    about: host.about,
    pricePer15Cents: host.pricePer15Cents,
    socials: host.shownSocials,
    rating: ratings.get(host.userId) ?? null,
  }));
}
