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
  it("buckets open statement balances by days past due", () => {
    const workspace = workspaceWithRate({ room_rate: 1000 });
    workspace.statements = [
      { due_date: "2026-07-25", balance_due: 100 } as FinancialWorkspace["statements"][number],
      { due_date: "2026-07-01", balance_due: 200 } as FinancialWorkspace["statements"][number],
      { due_date: "2026-06-01", balance_due: 300 } as FinancialWorkspace["statements"][number],
      { due_date: "2026-05-01", balance_due: 400 } as FinancialWorkspace["statements"][number],
      { due_date: "2026-03-01", balance_due: 500 } as FinancialWorkspace["statements"][number],
      { due_date: "2026-01-01", balance_due: 0 } as FinancialWorkspace["statements"][number],
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
});
