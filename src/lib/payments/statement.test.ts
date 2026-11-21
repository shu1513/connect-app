import { describe, expect, it, vi } from "vitest";

// The sums only: reading the books is covered by scripts/statement-check.ts.
vi.mock("@/db", () => ({ db: {}, schema: {} }));

import { buildStatement, COLUMNS, plainDollars, readYear, statementCsv, type Source, type StatementLine } from "./statement";

const line = (kind: string, amountCents: number, at: string, source: Source = "call"): StatementLine => ({ kind, amountCents, at: new Date(at), source });

describe("a host's yearly statement", () => {
  it("counts a share taken back after a lost bank dispute as that much less sent, in the month it was taken", () => {
    const s = buildStatement([line("host_transfer", -4435, "2026-03-20T09:00:00Z"), line("payout_fee", 25, "2026-03-20T09:00:00Z"), line("host_takeback", 4435, "2026-05-02T09:00:00Z")], 2026);
    expect(s.months[2].sentCents).toBe(4435);
    expect(s.months[4].sentCents).toBe(-4435);
    expect(s.total.sentCents).toBe(0);
    expect(s.total.collectionChargesCents).toBe(25);
  });

  it("adds up a call that was paid, its fee, her share, and the transfer with its collection charge", () => {
    const s = buildStatement(
      [
        line("customer_charge", 5000, "2026-03-10T12:00:00Z"),
        line("platform_fee", 540, "2026-03-10T12:00:00Z"),
        line("host_share", 4460, "2026-03-10T12:00:00Z"),
        line("host_transfer", -4435, "2026-03-20T09:00:00Z"),
        line("payout_fee", 25, "2026-03-20T09:00:00Z"),
      ],
      2026,
    );
    expect(s.months[2]).toEqual({ paidCents: 5000, givenBackCents: 0, paidByConnectCents: 0, feesCents: 540, tipFeesCents: 0, shareCents: 4460, sentCents: 4435, collectionChargesCents: 25 });
    expect(s.total).toEqual(s.months[2]);
    expect(s.paidBy).toEqual({ call: 5000, membership: 0, contribution: 0, tip: 0 });
  });

  it("puts a refund in the month and the year it went through, and takes the returned fee off again", () => {
    const lines = [
      line("customer_charge", 5000, "2026-12-20T12:00:00Z"),
      line("platform_fee", 540, "2026-12-20T12:00:00Z"),
      line("host_share", 4460, "2026-12-20T12:00:00Z"),
      // Half of it is given back in January.
      line("customer_refund", -2500, "2027-01-05T12:00:00Z"),
      line("platform_fee", -270, "2027-01-05T12:00:00Z"),
      line("host_share", -2230, "2027-01-05T12:00:00Z"),
    ];
    expect(buildStatement(lines, 2026).total).toMatchObject({ paidCents: 5000, givenBackCents: 0, feesCents: 540, shareCents: 4460 });
    expect(buildStatement(lines, 2027).months[0]).toMatchObject({ paidCents: 0, givenBackCents: 2500, feesCents: -270, shareCents: -2230 });
  });

  it("counts a line at midnight of New Year in the new year, in UTC", () => {
    const lines = [line("customer_charge", 100, "2026-12-31T23:59:59.999Z"), line("customer_charge", 200, "2027-01-01T00:00:00.000Z")];
    expect(buildStatement(lines, 2026).total.paidCents).toBe(100);
    expect(buildStatement(lines, 2027).months[0].paidCents).toBe(200);
  });

  it("shows a tip's payment fee apart from Connect's fees: the customer pays it on top, and the host gets the tip whole", () => {
    const s = buildStatement([line("customer_charge", 1061, "2026-05-01T10:00:00Z", "tip"), line("platform_fee", 61, "2026-05-01T10:00:00Z", "tip"), line("host_share", 1000, "2026-05-01T10:00:00Z", "tip")], 2026);
    expect(s.total).toMatchObject({ paidCents: 1061, feesCents: 0, tipFeesCents: 61, shareCents: 1000 });
    expect(s.paidBy.tip).toBe(1061);
  });

  it("counts a member's month when it was paid, and her share of it as the time is used or runs out", () => {
    const s = buildStatement(
      [
        line("customer_charge", 12000, "2026-06-01T08:00:00Z", "membership"),
        line("platform_fee", 400, "2026-06-12T08:00:00Z", "membership"),
        line("host_share", 3600, "2026-06-12T08:00:00Z", "membership"),
        // Unused time runs out at the start of the next month.
        line("platform_fee", 800, "2026-07-01T08:00:00Z", "membership"),
        line("host_share", 7200, "2026-07-01T08:00:00Z", "membership"),
      ],
      2026,
    );
    expect(s.months[5]).toMatchObject({ paidCents: 12000, feesCents: 400, shareCents: 3600 });
    expect(s.months[6]).toMatchObject({ paidCents: 0, feesCents: 800, shareCents: 7200 });
    expect(s.paidBy.membership).toBe(12000);
  });

  it("leaves out a hold that was let go, and shows beside a refund what Connect paid of it itself", () => {
    expect(buildStatement([line("hold_released", 5000, "2026-02-01T00:00:00Z")], 2026).total).toEqual(buildStatement([], 2026).total);
    // A contribution refunded after the host had collected: her share stays, and Connect bears the refund.
    const s = buildStatement([line("customer_refund", -2500, "2026-02-01T00:00:00Z", "contribution"), line("connect_cost", 2500, "2026-02-01T00:00:00Z", "contribution")], 2026);
    expect(s.total).toMatchObject({ givenBackCents: 2500, paidByConnectCents: 2500, shareCents: 0, feesCents: 0 });
  });

  it("has twelve months that add up to the year, for every column", () => {
    const lines = Array.from({ length: 40 }, (_, i) => line(["customer_charge", "customer_refund", "platform_fee", "host_share", "host_transfer", "payout_fee"][i % 6], (i % 2 ? -1 : 1) * (100 + i * 7), new Date(Date.UTC(2026, i % 12, 1 + (i % 27))).toISOString(), (["call", "membership", "contribution", "tip"] as const)[i % 4]));
    const s = buildStatement(lines, 2026);
    expect(s.months).toHaveLength(12);
    for (const { key } of COLUMNS) expect(s.months.reduce((sum, month) => sum + month[key], 0)).toBe(s.total[key]);
  });
});

describe("the file and the year", () => {
  it("writes cents as plain dollars", () => {
    expect(plainDollars(123456)).toBe("1234.56");
    expect(plainDollars(5)).toBe("0.05");
    expect(plainDollars(-270)).toBe("-2.70");
    expect(plainDollars(0)).toBe("0.00");
  });

  it("is a file a spreadsheet reads: a line of titles, twelve months and the year", () => {
    const csv = statementCsv(buildStatement([line("customer_charge", 5000, "2026-03-10T12:00:00Z"), line("customer_refund", -500, "2026-04-01T12:00:00Z")], 2026)).split("\r\n");
    expect(csv[0]).toContain("Not a tax form");
    expect(csv[1]).toBe('Month,"Paid by customers","Given back (refunds)","Of that, paid by Connect","Connect\'s fees","Payment fees on tips","Your share","Sent to you","Collection charges"');
    expect(csv[4]).toBe("March,50.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00");
    expect(csv[5]).toBe("April,0.00,5.00,0.00,0.00,0.00,0.00,0.00,0.00");
    expect(csv[14]).toBe("Year 2026,50.00,5.00,0.00,0.00,0.00,0.00,0.00,0.00");
    // Then what was paid for, so that someone who keeps only the file has those figures too.
    expect(csv.slice(16, 21)).toEqual(['"Paid by customers in 2026, by what it was paid for"', '"Calls paid by card",50.00', '"Membership months",0.00', '"Contributions to your project",0.00', '"Tips, with the payment fee paid on top",0.00']);
    expect(csv).toHaveLength(22);
  });

  it("takes only a year the host can have a statement for", () => {
    expect(readYear("2026", 2026, 2027)).toBe(2026);
    expect(readYear("2025", 2026, 2027)).toBeNull();
    expect(readYear("2028", 2026, 2027)).toBeNull();
    expect(readYear("20261", 2026, 2027)).toBeNull();
    expect(readYear(["2026", "2027"], 2026, 2027)).toBeNull();
    expect(readYear(undefined, 2026, 2027)).toBeNull();
  });
});
