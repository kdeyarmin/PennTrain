import { describe, expect, it } from "vitest";
import {
  buildPersonalFundStatement,
  currentFundBalance,
  fundSettlementBlocker,
  SETTLEABLE_RESIDENT_STATUSES,
  type FundLedgerEntryLike,
} from "./personalFundsStatement";

// Instants are chosen mid-afternoon Eastern so the facility day is unambiguous whatever zone the
// test runs in -- the same reason the app never buckets a timestamptz with the browser's day.
function entry(
  id: string,
  transactionAt: string,
  direction: "in" | "out",
  amount: number,
  balanceAfter: number,
  kind = direction === "in" ? "deposit" : "withdrawal",
): FundLedgerEntryLike {
  return {
    id,
    transaction_kind: kind,
    direction,
    amount,
    purpose: `${kind} ${id}`,
    transaction_at: transactionAt,
    posted_at: transactionAt,
    balance_after: balanceAfter,
  };
}

const LEDGER: FundLedgerEntryLike[] = [
  entry("t1", "2026-01-05T18:00:00Z", "in", 100, 100, "beginning_balance"),
  entry("t2", "2026-02-10T18:00:00Z", "in", 50, 150),
  entry("t3", "2026-02-20T18:00:00Z", "out", 30, 120),
  entry("t4", "2026-03-04T18:00:00Z", "out", 20, 100),
];

describe("buildPersonalFundStatement", () => {
  it("opens on the ledger's own balance before the period, not on a re-sum", () => {
    const statement = buildPersonalFundStatement({
      transactions: LEDGER,
      beginningBalance: 0,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });
    expect(statement.openingBalance).toBe(100);
    expect(statement.rows.map((row) => row.entry.id)).toEqual(["t2", "t3"]);
    expect(statement.closingBalance).toBe(120);
    expect(statement.totalIn).toBe(50);
    expect(statement.totalOut).toBe(30);
    expect(statement.reconciles).toBe(true);
  });

  it("reads oldest first, so the running balance descends the page in order", () => {
    // The tab lists newest-first; a statement that inherited that order would show a running
    // balance moving backwards.
    const statement = buildPersonalFundStatement({
      transactions: [...LEDGER].reverse(),
      beginningBalance: 0,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    expect(statement.rows.map((row) => row.balanceAfter)).toEqual([100, 150, 120, 100]);
    expect(statement.rows.map((row) => row.signedAmount)).toEqual([100, 50, -30, -20]);
  });

  it("falls back to the account's beginning balance when nothing precedes the period", () => {
    const statement = buildPersonalFundStatement({
      transactions: [],
      beginningBalance: "42.50",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(statement.openingBalance).toBe(42.5);
    expect(statement.closingBalance).toBe(42.5);
    expect(statement.rows).toHaveLength(0);
    expect(statement.reconciles).toBe(true);
  });

  it("includes both boundary days", () => {
    const statement = buildPersonalFundStatement({
      transactions: LEDGER,
      beginningBalance: 0,
      periodStart: "2026-02-10",
      periodEnd: "2026-02-20",
    });
    expect(statement.rows.map((row) => row.entry.id)).toEqual(["t2", "t3"]);
  });

  it("reports a ledger whose stored balance does not add up rather than printing it silently", () => {
    const statement = buildPersonalFundStatement({
      transactions: [
        entry("t1", "2026-01-05T18:00:00Z", "in", 100, 100, "beginning_balance"),
        // balance_after should be 60; a row written outside the RPC says 75.
        entry("t2", "2026-01-06T18:00:00Z", "out", 40, 75),
      ],
      beginningBalance: 0,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(statement.closingBalance).toBe(75);
    expect(statement.reconciles).toBe(false);
  });

  it("does not fail to balance on decimal arithmetic", () => {
    const statement = buildPersonalFundStatement({
      transactions: [
        entry("t1", "2026-01-05T18:00:00Z", "in", 0.1, 0.1, "beginning_balance"),
        entry("t2", "2026-01-06T18:00:00Z", "in", 0.2, 0.3),
      ],
      beginningBalance: 0,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(statement.reconciles).toBe(true);
  });
});

describe("currentFundBalance", () => {
  it("is the newest entry's stored balance", () => {
    expect(currentFundBalance(LEDGER, 0)).toBe(100);
    expect(currentFundBalance([...LEDGER].reverse(), 0)).toBe(100);
  });

  it("is the opening figure when no entry exists", () => {
    expect(currentFundBalance([], "250.00")).toBe(250);
  });
});

describe("fundSettlementBlocker", () => {
  const now = new Date("2026-05-01T12:00:00Z");
  const valid = {
    residentStatus: "discharged",
    accountClosedOn: null,
    purpose: "Return of personal funds on discharge",
    recipient: "Jane Doe, daughter",
    transactionAt: "2026-05-01T12:00:00Z",
    now,
  };

  it("accepts a complete settlement for an ended residency", () => {
    expect(fundSettlementBlocker(valid)).toBeNull();
    for (const status of SETTLEABLE_RESIDENT_STATUSES) {
      expect(fundSettlementBlocker({ ...valid, residentStatus: status })).toBeNull();
    }
  });

  it("states each of the RPC's refusals before the call, not after", () => {
    expect(fundSettlementBlocker({ ...valid, residentStatus: "active" })).toContain("residency ends");
    expect(fundSettlementBlocker({ ...valid, accountClosedOn: "2026-04-01" })).toContain("already settled");
    expect(fundSettlementBlocker({ ...valid, purpose: "Re" })).toContain("at least three characters");
    expect(fundSettlementBlocker({ ...valid, recipient: "J" })).toContain("at least two characters");
    expect(fundSettlementBlocker({ ...valid, transactionAt: "2026-05-03T12:00:00Z" }))
      .toContain("more than a day ahead");
  });

  it("reports the closed account first, since nothing else can be fixed about it", () => {
    expect(fundSettlementBlocker({
      ...valid,
      accountClosedOn: "2026-04-01",
      residentStatus: "active",
      purpose: "",
      recipient: "",
    })).toContain("already settled");
  });

  it("allows a settlement dated within the day of grace the RPC permits", () => {
    expect(fundSettlementBlocker({ ...valid, transactionAt: "2026-05-02T11:00:00Z" })).toBeNull();
  });
});
