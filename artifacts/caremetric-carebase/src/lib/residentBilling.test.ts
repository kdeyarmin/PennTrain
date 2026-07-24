import { describe, expect, it } from "vitest";
import { monthlyChargePreviews, receivableAgingSummary } from "./residentBilling";
import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";

function workspaceWithRate(rate: Partial<FinancialWorkspace["rates"][number]>): FinancialWorkspace {
  return {
    account: null,
    rates: [rate as FinancialWorkspace["rates"][number]],
    transactions: [],
    statements: [],
    fundAccount: null,
    fundTransactions: [],
    reconciliations: [],
    history: [],
    agreementVersions: [],
    documents: [],
  };
}

describe("monthlyChargePreviews", () => {
  it("builds recurring charge previews from the latest rate agreement", () => {
    const previews = monthlyChargePreviews(workspaceWithRate({
      base_monthly_charge: 3200,
      level_of_care_charge: "450.25",
      room_rate: 750,
      ancillary_services: [{ name: "Laundry", amount: 40 }, { name: "Transportation", amount: "25.337" }],
    }));

    expect(previews).toEqual([
      { category: "base_monthly", label: "Base monthly charge", amount: 3200 },
      { category: "level_of_care", label: "Level-of-care charge", amount: 450.25 },
      { category: "room_rate", label: "Room rate", amount: 750 },
      { category: "ancillary_service", label: "Laundry", amount: 40 },
      { category: "ancillary_service", label: "Transportation", amount: 25.34 },
    ]);
  });

  it("omits zero, invalid, and malformed ancillary charges", () => {
    const previews = monthlyChargePreviews(workspaceWithRate({
      base_monthly_charge: 0,
      level_of_care_charge: Number.NaN,
      room_rate: 1000,
      ancillary_services: [{ name: "", amount: 0 }, null, "bad", { amount: "not-a-number" }, { amount: 15 }],
    }));

    expect(previews).toEqual([
      { category: "room_rate", label: "Room rate", amount: 1000 },
      { category: "ancillary_service", label: "Ancillary service", amount: 15 },
    ]);
  });
});


describe("receivableAgingSummary", () => {
  type Txn = FinancialWorkspace["transactions"][number];
  type Stmt = FinancialWorkspace["statements"][number];

  const debit = (effectiveOn: string, amount: number): Txn =>
    ({ entry_side: "debit", amount, effective_on: effectiveOn, posted_at: `${effectiveOn}T12:00:00Z` }) as Txn;
  const credit = (effectiveOn: string, amount: number): Txn =>
    ({ entry_side: "credit", amount, effective_on: effectiveOn, posted_at: `${effectiveOn}T12:00:00Z` }) as Txn;
  const statement = (periodEnd: string, dueDate: string, balanceDue: number): Stmt =>
    ({ period_end: periodEnd, due_date: dueDate, balance_due: balanceDue }) as Stmt;

  it("buckets open ledger charges by days past their billing statement's due date", () => {
    const workspace = workspaceWithRate({ room_rate: 1000 });
    workspace.transactions = [
      debit("2026-07-05", 100),
      debit("2026-06-15", 200),
      debit("2026-05-20", 300),
      debit("2026-04-10", 400),
      debit("2026-02-15", 500),
    ];
    workspace.statements = [
      statement("2026-07-15", "2026-07-25", 1500),
      statement("2026-06-30", "2026-07-01", 1400),
      statement("2026-05-31", "2026-06-01", 1200),
      statement("2026-04-30", "2026-05-01", 900),
      statement("2026-02-28", "2026-03-01", 500),
    ];

    const summary = receivableAgingSummary(workspace, "2026-07-21");

    expect(summary.buckets).toEqual([
      { key: "current", label: "Current", amount: 100 },
      { key: "days1To30", label: "1–30", amount: 200 },
      { key: "days31To60", label: "31–60", amount: 300 },
      { key: "days61To90", label: "61–90", amount: 400 },
      { key: "days90Plus", label: "90+", amount: 500 },
    ]);
    expect(summary.totalOpen).toBe(1500);
    expect(summary.oldestOpenDueDate).toBe("2026-03-01");
    expect(summary.highestRiskBucket).toBe("days90Plus");
  });

  it("does not double-count cumulative statement snapshots", () => {
    const workspace = workspaceWithRate({ room_rate: 1000 });
    workspace.transactions = [debit("2026-06-05", 1000), debit("2026-07-05", 1000)];
    // The July statement is a cumulative snapshot: its 2000 balance already
    // contains June's unpaid 1000. Naively summing balance_due reports 3000.
    workspace.statements = [
      statement("2026-06-30", "2026-07-01", 1000),
      statement("2026-07-31", "2026-08-01", 2000),
    ];

    const summary = receivableAgingSummary(workspace, "2026-07-21");

    expect(summary.totalOpen).toBe(2000);
    expect(summary.buckets.find((bucket) => bucket.key === "days1To30")?.amount).toBe(1000);
    expect(summary.buckets.find((bucket) => bucket.key === "current")?.amount).toBe(1000);
    expect(summary.oldestOpenDueDate).toBe("2026-07-01");
  });

  it("applies post-statement payments to the oldest open charges first", () => {
    const workspace = workspaceWithRate({ room_rate: 1000 });
    workspace.transactions = [
      debit("2026-06-05", 1000),
      debit("2026-07-05", 1000),
      credit("2026-07-10", 1500),
    ];
    workspace.statements = [
      statement("2026-06-30", "2026-07-01", 1000),
      statement("2026-07-31", "2026-08-01", 2000),
    ];

    const summary = receivableAgingSummary(workspace, "2026-07-21");

    // 1500 closes June's 1000 entirely and 500 of July's charge. As of 2026-07-21 the
    // July statement's period has not closed, so the remaining 500 is not yet billed:
    // current, with no due date.
    expect(summary.totalOpen).toBe(500);
    expect(summary.buckets.find((bucket) => bucket.key === "days1To30")?.amount).toBe(0);
    expect(summary.buckets.find((bucket) => bucket.key === "current")?.amount).toBe(500);
    expect(summary.oldestOpenDueDate).toBeNull();
    expect(summary.highestRiskBucket).toBe("current");
  });

  it("keeps not-yet-billed charges current with no due date", () => {
    const workspace = workspaceWithRate({ room_rate: 1000 });
    workspace.transactions = [debit("2026-07-20", 750)];

    const summary = receivableAgingSummary(workspace, "2026-07-21");

    expect(summary.totalOpen).toBe(750);
    expect(summary.buckets.find((bucket) => bucket.key === "current")?.amount).toBe(750);
    expect(summary.oldestOpenDueDate).toBeNull();
  });

  it("reports zero open receivables when credits cover every debit", () => {
    const workspace = workspaceWithRate({ room_rate: 1000 });
    workspace.transactions = [
      debit("2026-06-05", 1000),
      credit("2026-07-10", 1200),
    ];
    workspace.statements = [statement("2026-06-30", "2026-07-01", 1000)];

    const summary = receivableAgingSummary(workspace, "2026-07-21");

    expect(summary.totalOpen).toBe(0);
    expect(summary.buckets.every((bucket) => bucket.amount === 0)).toBe(true);
    expect(summary.oldestOpenDueDate).toBeNull();
    expect(summary.highestRiskBucket).toBeNull();
  });

  it("ignores ledger activity after the as-of date", () => {
    const workspace = {
      transactions: [
        { entry_side: "debit", amount: 100, effective_on: "2026-06-01", posted_at: "2026-06-01" },
        { entry_side: "credit", amount: 100, effective_on: "2026-07-10", posted_at: "2026-07-10" },
        { entry_side: "debit", amount: 50, effective_on: "2026-08-01", posted_at: "2026-08-01" },
      ],
      statements: [
        { period_end: "2026-06-30", due_date: "2026-07-05", balance_due: 100 },
      ],
    } as never;
    // As of 2026-07-01: the June debit is billed and open; the July credit and the
    // future August debit have not happened yet.
    const asOfJuly1 = receivableAgingSummary(workspace, "2026-07-01");
    expect(asOfJuly1.totalOpen).toBe(100);
    // As of 2026-07-15 the credit has cleared the June charge and August has not begun.
    const asOfJuly15 = receivableAgingSummary(workspace, "2026-07-15");
    expect(asOfJuly15.totalOpen).toBe(0);
  });
});
