/**
 * Testing tool: a host's yearly statement (plans/46-agreements-live.md, part 5), against the local
 * database. It makes its own people, calls, a member's month, a tip and the lines of the books
 * for them, with known amounts and days, and reads the statement back. It touches no other
 * account, needs neither Stripe nor the running app, and removes what it made.
 *
 * Usage: npx tsx scripts/statement-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const S = await import("../src/lib/payments/statement");

  const people: string[] = [];
  const calls: string[] = [];
  const payments: string[] = [];
  const months: string[] = [];
  const memberships: string[] = [];
  const contributionPayments: string[] = [];
  const contributions: string[] = [];
  const at = (iso: string) => new Date(iso);
  const FEES = { feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150 };

  async function person(name: string) {
    const id = `st-${RUN}-${name}`;
    await db.insert(schema.user).values({ id, name: `Statement ${name}`, email: `statecheck-${RUN}-${name}@example.test`, emailVerified: true });
    people.push(id);
    return id;
  }
  async function hostProfile(userId: string, name: string, createdAt: Date) {
    await db.insert(schema.hostProfiles).values({ userId, handle: `st${RUN}${name}`, handleKey: `st${RUN}${name}`, displayName: `Statement ${name}`, pricePer15Cents: 2000, usConfirmedAt: createdAt, createdAt });
  }
  async function call(hostId: string, customerId: string, startsAt: Date) {
    const [row] = await db.insert(schema.calls).values({ hostId, customerId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), roomName: `st-${RUN}-${randomUUID()}` }).returning({ id: schema.calls.id });
    calls.push(row.id);
    return row.id;
  }
  async function cardPayment(callId: string, when: Date, cents: number) {
    const [row] = await db.insert(schema.payments).values({ callId, coversFrom: when, coversUntil: new Date(when.getTime() + 30 * 60_000), pricePer15Cents: 2000, bookedCents: cents, ...FEES }).returning({ id: schema.payments.id });
    payments.push(row.id);
    return row.id;
  }
  const line = (owner: { paymentId?: string; monthId?: string; contributionPaymentId?: string }, kind: string, amountCents: number, when: string) => db.insert(schema.ledgerEntries).values({ ...owner, kind, amountCents, createdAt: at(when) });

  try {
    const host = await person("host");
    const other = await person("other");
    const customer = await person("customer");
    await hostProfile(host, "host", at("2026-02-10T00:00:00Z"));
    await hostProfile(other, "other", at("2026-02-10T00:00:00Z"));

    // 1. A call paid by card in March 2026: $50.00, fee $2.75, her share $47.25; collected ten days later, $47.00 after the 25-cent charge.
    const first = await cardPayment(await call(host, customer, at("2026-03-10T12:00:00Z")), at("2026-03-10T12:00:00Z"), 5000);
    await line({ paymentId: first }, "hold_released", 0, "2026-03-10T12:30:00Z");
    await line({ paymentId: first }, "customer_charge", 5000, "2026-03-11T13:00:00Z");
    await line({ paymentId: first }, "platform_fee", 275, "2026-03-11T13:00:00Z");
    await line({ paymentId: first }, "host_share", 4725, "2026-03-11T13:00:00Z");
    await line({ paymentId: first }, "host_transfer", -4700, "2026-03-21T09:00:00Z");
    await line({ paymentId: first }, "payout_fee", 25, "2026-03-21T09:00:00Z");

    // 2. A call paid on 31 December 2026, a second before midnight UTC, and half given back in January 2027.
    const second = await cardPayment(await call(host, customer, at("2026-12-30T12:00:00Z")), at("2026-12-30T12:00:00Z"), 4000);
    await line({ paymentId: second }, "customer_charge", 4000, "2026-12-31T23:59:59Z");
    await line({ paymentId: second }, "platform_fee", 226, "2026-12-31T23:59:59Z");
    await line({ paymentId: second }, "host_share", 3774, "2026-12-31T23:59:59Z");
    await line({ paymentId: second }, "customer_refund", -2000, "2027-01-01T00:00:00Z");
    await line({ paymentId: second }, "platform_fee", -98, "2027-01-01T00:00:00Z");
    await line({ paymentId: second }, "host_share", -1902, "2027-01-01T00:00:00Z");

    // 3. A member's month paid in June 2026 ($120.00): one call from it in June, and the unused rest runs out in July.
    const [membership] = await db.insert(schema.memberships).values({ hostId: host, customerId: customer, status: "ended", period: 1 }).returning({ id: schema.memberships.id });
    memberships.push(membership.id);
    const [agreement] = await db.insert(schema.membershipAgreements).values({ membershipId: membership.id, requestId: randomUUID(), kind: "joined", offerVersion: 1, pricePer15Cents: 1500, minutes: 120, firstMonthNumber: 1, at: at("2026-06-01T08:00:00Z") }).returning({ id: schema.membershipAgreements.id });
    const [month] = await db
      .insert(schema.membershipMonths)
      .values({ membershipId: membership.id, period: 1, number: 1, agreementId: agreement.id, originKey: `st-${RUN}-month`, pricePer15Cents: 1500, includedMinutes: 120, totalCents: 12000, ...FEES, startsAt: at("2026-06-01T08:00:00Z"), endsAt: at("2026-07-01T08:00:00Z") } as typeof schema.membershipMonths.$inferInsert)
      .returning({ id: schema.membershipMonths.id });
    months.push(month.id);
    await line({ monthId: month.id }, "customer_charge", 12000, "2026-06-01T08:00:10Z");
    const memberCallId = await call(host, customer, at("2026-06-12T10:00:00Z"));
    const [memberCall] = await db.insert(schema.payments).values({ kind: "member_call", callId: memberCallId, monthId: month.id, coversFrom: at("2026-06-12T10:00:00Z"), coversUntil: at("2026-06-12T10:30:00Z"), pricePer15Cents: 1500, bookedCents: 3000, ...FEES }).returning({ id: schema.payments.id });
    payments.push(memberCall.id);
    await line({ paymentId: memberCall.id }, "platform_fee", 177, "2026-06-13T10:30:00Z");
    await line({ paymentId: memberCall.id }, "host_share", 2823, "2026-06-13T10:30:00Z");
    const [expired] = await db.insert(schema.payments).values({ kind: "member_expired", monthId: month.id, coversFrom: at("2026-07-01T08:00:00Z"), coversUntil: at("2026-07-01T08:00:00Z"), pricePer15Cents: 1500, bookedCents: 9000, ...FEES }).returning({ id: schema.payments.id });
    payments.push(expired.id);
    await line({ paymentId: expired.id }, "platform_fee", 441, "2026-07-01T08:05:00Z");
    await line({ paymentId: expired.id }, "host_share", 8559, "2026-07-01T08:05:00Z");

    // 4. A tip of $10.00 in May 2026: the customer pays $10.61, the 61 cents are the payment fee, the host gets the tip whole.
    const tipCall = await call(host, customer, at("2026-05-01T09:00:00Z"));
    const [tip] = await db.insert(schema.contributions).values({ callId: tipCall, hostId: host, contributorId: customer, kind: "tip", amountCents: 1061, tipCents: 1000, status: "ended", endedAt: at("2026-05-04T10:00:00Z"), endedHow: "paid", requestKey: randomUUID() }).returning({ id: schema.contributions.id });
    contributions.push(tip.id);
    const [tipPayment] = await db.insert(schema.contributionPayments).values({ contributionId: tip.id, number: 1, originKey: `st-${RUN}-tip`, amountCents: 1061, ...FEES }).returning({ id: schema.contributionPayments.id });
    contributionPayments.push(tipPayment.id);
    await line({ contributionPaymentId: tipPayment.id }, "customer_charge", 1061, "2026-05-04T10:00:00Z");
    await line({ contributionPaymentId: tipPayment.id }, "connect_cost", 7, "2026-05-04T10:00:00Z");
    const taken = at("2026-05-04T10:00:00Z");
    const [share] = await db
      .insert(schema.payments)
      .values({ kind: "contribution", contributionPaymentId: tipPayment.id, coversFrom: taken, coversUntil: taken, pricePer15Cents: 0, bookedCents: 1061, ...FEES, status: "charged", chargedCents: 1061, chargedAt: taken, originalFeeCents: 61, originalHostShareCents: 1000, stripeChargeId: `ch_statecheck_${RUN}` })
      .returning({ id: schema.payments.id });
    payments.push(share.id);
    await line({ paymentId: share.id }, "platform_fee", 61, "2026-05-04T10:00:00Z");
    await line({ paymentId: share.id }, "host_share", 1000, "2026-05-04T10:00:00Z");

    // 5. Another host's call in March 2026: none of it is hers.
    const theirs = await cardPayment(await call(other, customer, at("2026-03-15T12:00:00Z")), at("2026-03-15T12:00:00Z"), 9900);
    await line({ paymentId: theirs }, "customer_charge", 9900, "2026-03-16T12:00:00Z");
    await line({ paymentId: theirs }, "host_share", 9000, "2026-03-16T12:00:00Z");

    console.log("\n1. The year 2026");
    const y26 = await S.statementFor(host, 2026);
    const month26 = (index: number) => JSON.stringify(y26.months[index]);
    check("March: the call paid by card, its fee, her share, and what was sent with the collection charge", month26(2) === JSON.stringify({ paidCents: 5000, givenBackCents: 0, feesCents: 275, tipFeesCents: 0, shareCents: 4725, sentCents: 4700, collectionChargesCents: 25 }), month26(2));
    check("May: the tip with its payment fee apart, and the tip whole as her share", month26(4) === JSON.stringify({ paidCents: 1061, givenBackCents: 0, feesCents: 0, tipFeesCents: 61, shareCents: 1000, sentCents: 0, collectionChargesCents: 0 }), month26(4));
    check("June: the member's month counted when it was paid, and her share of the one call from it", month26(5) === JSON.stringify({ paidCents: 12000, givenBackCents: 0, feesCents: 177, tipFeesCents: 0, shareCents: 2823, sentCents: 0, collectionChargesCents: 0 }), month26(5));
    check("July: her share of the member's unused time, with nothing paid again", month26(6) === JSON.stringify({ paidCents: 0, givenBackCents: 0, feesCents: 441, tipFeesCents: 0, shareCents: 8559, sentCents: 0, collectionChargesCents: 0 }), month26(6));
    check("December: the payment a second before midnight is in 2026, and its refund is not", month26(11) === JSON.stringify({ paidCents: 4000, givenBackCents: 0, feesCents: 226, tipFeesCents: 0, shareCents: 3774, sentCents: 0, collectionChargesCents: 0 }), month26(11));
    check("the year: everything of hers once, and nothing of the other host", JSON.stringify(y26.total) === JSON.stringify({ paidCents: 22061, givenBackCents: 0, feesCents: 1119, tipFeesCents: 61, shareCents: 20881, sentCents: 4700, collectionChargesCents: 25 }), JSON.stringify(y26.total));
    check("what customers paid for, by kind", JSON.stringify(y26.paidBy) === JSON.stringify({ call: 9000, membership: 12000, contribution: 0, tip: 1061 }), JSON.stringify(y26.paidBy));
    check("the twelve months add up to the year in every column", S.COLUMNS.every(({ key }) => y26.months.reduce((sum, m) => sum + m[key], 0) === y26.total[key]));

    console.log("\n2. The year 2027, and the other host");
    const y27 = await S.statementFor(host, 2027);
    check("January 2027: the refund at midnight UTC, with the fee that came back taken off", JSON.stringify(y27.months[0]) === JSON.stringify({ paidCents: 0, givenBackCents: 2000, feesCents: -98, tipFeesCents: 0, shareCents: -1902, sentCents: 0, collectionChargesCents: 0 }) && JSON.stringify(y27.total) === JSON.stringify(y27.months[0]), JSON.stringify(y27.months[0]));
    const others = await S.statementFor(other, 2026);
    check("the other host's statement has her own call and nothing else", others.total.paidCents === 9900 && others.total.shareCents === 9000 && others.total.feesCents === 0);
    check("a customer has no statement: no host profile, no years", (await S.statementYears(customer, new Date())) === null);
    const years = await S.statementYears(host, at("2028-01-03T00:00:00Z"));
    check("a host's years run from the year her profile was made to this one", years?.first === 2026 && years.last === 2028, JSON.stringify(years));

    console.log("\n3. The file");
    const csv = S.statementCsv(y26).split("\r\n");
    check("the file has the same numbers as the page: March, and the year", csv[4] === "March,50.00,0.00,2.75,0.00,47.25,47.00,0.25" && csv[14] === "Year 2026,220.61,0.00,11.19,0.61,208.81,47.00,0.25", `${csv[4]} | ${csv[14]}`);
  } finally {
    const owned = (column: "paymentId" | "monthId" | "contributionPaymentId", ids: string[]) => (ids.length ? db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries[column], ids)) : Promise.resolve());
    await owned("paymentId", payments);
    await owned("monthId", months);
    await owned("contributionPaymentId", contributionPayments);
    if (payments.length) await db.delete(schema.payments).where(inArray(schema.payments.id, payments));
    if (contributionPayments.length) await db.delete(schema.contributionPayments).where(inArray(schema.contributionPayments.id, contributionPayments));
    if (contributions.length) await db.delete(schema.contributions).where(inArray(schema.contributions.id, contributions));
    if (months.length) await db.delete(schema.membershipMonths).where(inArray(schema.membershipMonths.id, months));
    if (memberships.length) {
      await db.delete(schema.membershipAgreements).where(inArray(schema.membershipAgreements.membershipId, memberships));
      await db.delete(schema.memberships).where(inArray(schema.memberships.id, memberships));
    }
    if (calls.length) await db.delete(schema.calls).where(inArray(schema.calls.id, calls));
    if (people.length) {
      await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, people));
      for (const id of people) await db.delete(schema.user).where(eq(schema.user.id, id));
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
