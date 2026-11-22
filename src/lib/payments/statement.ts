/**
 * A host's yearly statement (plans/46-agreements-live.md, part 5): what customers paid for her
 * calls, memberships, contributions and tips in one calendar year, what was given back, Connect's
 * fees, her share, and what was sent to her. Made from the books the app already keeps
 * (`ledger_entries`), with no table of its own.
 *
 * It is a summary for her own records, NOT a tax form. Every line is counted in the month it was
 * written into the books, in UTC. The app writes a charge down when it learns of it, which can be
 * a little after the bank moved the money; the day a bank pays a host is not known to the app.
 *
 * Not in it: money a bank took back in a dispute. The books hold no dated amount for that.
 *
 * The sums are in the first half of this file, without the database, so they can be tested alone.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";

export type Source = "call" | "membership" | "contribution" | "tip";
export const SOURCES: readonly Source[] = ["call", "membership", "contribution", "tip"];

/** One line of the books that belongs to this host. */
export type StatementLine = { kind: string; amountCents: number; at: Date; source: Source };

export type Sums = {
  /** Charged to customers. A member's month is counted when it was paid, a tip with the payment fee the customer paid on top. */
  paidCents: number;
  /** Refunds, in the month they were written into the books. */
  givenBackCents: number;
  /**
   * What Connect carried itself of refunds given after the host had collected: a contribution's or a tip's refund at
   * once (her share is not touched for those), and for a call what Connect waived of the share she owed back, in the
   * month it was waived. With its sign: a waiver that is taken off the books again shows as a minus.
   */
  paidByConnectCents: number;
  /** Connect's fees, with their signs: a fee returned with a refund is taken off again. */
  feesCents: number;
  /** The payment fee of tips, which the customer pays on top of the tip. */
  tipFeesCents: number;
  /** The host's share, as it was earned: for a member's month as the calls happen or unused time runs out. */
  shareCents: number;
  /** Transfers to the host that went through: what was sent, with nothing taken off for what went back later. */
  sentCents: number;
  /**
   * What went back from her after it had been sent: taken back out of a transfer (after a lost bank dispute, or after a
   * refund Connect gave once she had collected), or paid back by her outside the app. In the month it went back.
   */
  takenBackCents: number;
  /** The collection charges really taken from those transfers. Already off "sent". */
  collectionChargesCents: number;
};

export type Statement = { year: number; months: Sums[]; total: Sums; /** "Paid by customers", by what it was paid for. */ paidBy: Record<Source, number> };

const none = (): Sums => ({ paidCents: 0, givenBackCents: 0, paidByConnectCents: 0, feesCents: 0, tipFeesCents: 0, shareCents: 0, sentCents: 0, takenBackCents: 0, collectionChargesCents: 0 });

/** The first moment of a year, in UTC. */
export const yearStart = (year: number): Date => new Date(Date.UTC(year, 0, 1));

/** The year asked for, if it is one this host can have a statement for; otherwise null. */
export function readYear(asked: unknown, first: number, last: number): number | null {
  if (typeof asked !== "string" || !/^\d{4}$/.test(asked)) return null;
  const year = Number(asked);
  return year >= first && year <= last ? year : null;
}

/** Adds one line to the sums it belongs to. A hold that was let go moves no money and adds nothing. */
function add(sums: Sums, line: StatementLine): void {
  if (line.kind === "customer_charge") sums.paidCents += line.amountCents;
  else if (line.kind === "customer_refund") sums.givenBackCents -= line.amountCents;
  else if (line.kind === "platform_fee") {
    if (line.source === "tip") sums.tipFeesCents += line.amountCents;
    else sums.feesCents += line.amountCents;
  } else if (line.kind === "host_share") sums.shareCents += line.amountCents;
  else if (line.kind === "host_transfer") sums.sentCents -= line.amountCents;
  // What went back from her (plans/46-part-3-money-owed.md, decision 8): taken back out of a transfer, or paid back
  // by her outside the app. In a column of its own, in the month it went back: "Sent to you" stays what was sent,
  // so a share sent in December and taken back in January no longer makes January's "Sent to you" a minus.
  else if (line.kind === "host_takeback" || line.kind === "host_repaid") sums.takenBackCents += line.amountCents;
  else if (line.kind === "payout_fee") sums.collectionChargesCents += line.amountCents;
  // What Connect carried of a refund given after the host had collected, with its sign.
  else if (line.kind === "connect_cost") sums.paidByConnectCents += line.amountCents;
}

/** The statement of one year from the host's lines. A line of another year is left out. */
export function buildStatement(lines: readonly StatementLine[], year: number): Statement {
  const months = Array.from({ length: 12 }, none);
  const total = none();
  const paidBy: Record<Source, number> = { call: 0, membership: 0, contribution: 0, tip: 0 };
  for (const line of lines) {
    if (line.at.getUTCFullYear() !== year) continue;
    add(months[line.at.getUTCMonth()], line);
    add(total, line);
    if (line.kind === "customer_charge") paidBy[line.source] += line.amountCents;
  }
  return { year, months, total, paidBy };
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The columns, in the order the page and the file show them. */
export const COLUMNS: readonly { key: keyof Sums; title: string }[] = [
  { key: "paidCents", title: "Paid by customers" },
  { key: "givenBackCents", title: "Given back (refunds)" },
  { key: "paidByConnectCents", title: "Carried by Connect" },
  { key: "feesCents", title: "Connect's fees" },
  { key: "tipFeesCents", title: "Payment fees on tips" },
  { key: "shareCents", title: "Your share" },
  { key: "sentCents", title: "Sent to you" },
  { key: "takenBackCents", title: "Taken back or paid back" },
  { key: "collectionChargesCents", title: "Collection charges" },
];

/** Cents as "12.34", or "-0.50": a plain number a spreadsheet reads. */
export function plainDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.abs(cents);
  return `${sign}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`;
}

/** What "Paid by customers" was paid for, in the words of the page and the file. */
export const PAID_FOR: Record<Source, string> = { call: "Calls paid by card", membership: "Membership months", contribution: "Contributions to your project", tip: "Tips, with the payment fee paid on top" };

/** The statement as a file for a spreadsheet: a line for each month, one for the year, and what was paid for. Only words of our own and numbers are in it. */
export function statementCsv(statement: Statement): string {
  const row = (label: string, sums: Sums) => [label, ...COLUMNS.map((column) => plainDollars(sums[column.key]))].join(",");
  return [
    `"Connect: summary of ${statement.year} for your own records. Not a tax form. US dollars. Counted by the day each line was written into Connect's books, in UTC. A payment a customer's bank took back in a dispute is not in 'Given back'. 'Sent to you' is what was sent; what went back from you afterwards (taken back out of a transfer, or paid back by you) is in 'Taken back or paid back', in the month it went back."`,
    ["Month", ...COLUMNS.map((column) => `"${column.title}"`)].join(","),
    ...statement.months.map((sums, index) => row(MONTH_NAMES[index], sums)),
    row(`Year ${statement.year}`, statement.total),
    "",
    `"Paid by customers in ${statement.year}, by what it was paid for"`,
    ...SOURCES.map((source) => `"${PAID_FOR[source]}",${plainDollars(statement.paidBy[source])}`),
    "",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------------------------
// With the database.
// ---------------------------------------------------------------------------------------------

/**
 * Every line of the books of one year that belongs to this host. A line belongs to a payment, to a member's month
 * or to a contribution's payment, and each of those leads to its host its own way; five questions, each along an
 * index, rather than one that reads the whole of the books.
 */
export async function statementLines(hostId: string, year: number): Promise<StatementLine[]> {
  const le = schema.ledgerEntries;
  const p = schema.payments;
  const inYear = and(gte(le.createdAt, yearStart(year)), lt(le.createdAt, yearStart(year + 1)));
  const columns = { kind: le.kind, amountCents: le.amountCents, at: le.createdAt };
  // All five see the books at one and the same moment (one read-only database step that holds its first look). A
  // payment is written into the books as several lines in one step; asked one after the other without this, a
  // statement made in that instant could show what was paid without the fee and the share that go with it.
  const [ofCalls, ofExpired, ofShares, ofMonths, ofContributions] = await db.transaction(
    async (tx) => [
    // A payment for a call: paid by card, or from a member's time.
      await tx.select({ ...columns, paymentKind: p.kind }).from(le).innerJoin(p, eq(p.id, le.paymentId)).innerJoin(schema.calls, eq(schema.calls.id, p.callId)).where(and(eq(schema.calls.hostId, hostId), inYear)),
    // A member's time that ran out unused.
      await tx
      .select(columns)
      .from(le)
      .innerJoin(p, eq(p.id, le.paymentId))
      .innerJoin(schema.membershipMonths, eq(schema.membershipMonths.id, p.monthId))
      .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
      .where(and(eq(p.kind, "member_expired"), eq(schema.memberships.hostId, hostId), inYear)),
    // The host's share of a contribution or a tip.
      await tx
      .select({ ...columns, contributionKind: schema.contributions.kind })
      .from(le)
      .innerJoin(p, eq(p.id, le.paymentId))
      .innerJoin(schema.contributionPayments, eq(schema.contributionPayments.id, p.contributionPaymentId))
      .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
      .where(and(eq(schema.contributions.hostId, hostId), inYear)),
    // A member's month itself: what the member paid, and what was paid back.
      await tx
      .select(columns)
      .from(le)
      .innerJoin(schema.membershipMonths, eq(schema.membershipMonths.id, le.monthId))
      .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
      .where(and(eq(schema.memberships.hostId, hostId), inYear)),
    // A contribution's or a tip's own payment: what the person paid, and what was given back.
      await tx
      .select({ ...columns, contributionKind: schema.contributions.kind })
      .from(le)
      .innerJoin(schema.contributionPayments, eq(schema.contributionPayments.id, le.contributionPaymentId))
      .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
      .where(and(eq(schema.contributions.hostId, hostId), inYear)),
  ] as const,
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const of = (kind: string): Source => (kind === "tip" ? "tip" : "contribution");
  return [
    ...ofCalls.map((line) => ({ kind: line.kind, amountCents: line.amountCents, at: line.at, source: (line.paymentKind === "member_call" ? "membership" : "call") as Source })),
    ...ofExpired.map((line) => ({ ...line, source: "membership" as Source })),
    ...ofShares.map((line) => ({ kind: line.kind, amountCents: line.amountCents, at: line.at, source: of(line.contributionKind) })),
    ...ofMonths.map((line) => ({ ...line, source: "membership" as Source })),
    ...ofContributions.map((line) => ({ kind: line.kind, amountCents: line.amountCents, at: line.at, source: of(line.contributionKind) })),
  ];
}

/** The years this host can have a statement for: from the year her host profile was made to this one. Null when she has no host profile. */
export async function statementYears(hostId: string, now: Date): Promise<{ first: number; last: number } | null> {
  const [profile] = await db.select({ createdAt: schema.hostProfiles.createdAt }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
  if (!profile) return null;
  return { first: profile.createdAt.getUTCFullYear(), last: now.getUTCFullYear() };
}

export async function statementFor(hostId: string, year: number): Promise<Statement> {
  return buildStatement(await statementLines(hostId, year), year);
}
