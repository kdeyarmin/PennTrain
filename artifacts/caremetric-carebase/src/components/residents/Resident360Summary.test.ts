import { expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useResident360", () => ({
  useResident360Snapshot: vi.fn(),
  useResidentTimeline: vi.fn(),
}));

import { residentBalanceDetail, weightPlanDetail } from "./Resident360Summary";

it("puts the ledger date under the balance, not the weight-plan count", () => {
  // 03:30Z is still the previous evening in Pennsylvania.
  expect(residentBalanceDetail("2026-09-27T03:30:00Z")).toBe("Last posted 9/26/2026");
  expect(residentBalanceDetail(null)).toBe("No ledger activity");
  expect(residentBalanceDetail("not-a-date")).toBe("No ledger activity");
});

it("shows the dietary profile date on the weight-plan tile", () => {
  expect(weightPlanDetail("2026-01-15T15:00:00Z")).toBe("Dietary profile updated 1/15/2026");
  expect(weightPlanDetail(null)).toBe("No dietary profile on file");
});
