import { describe, expect, it } from "vitest";
import { summarizePolicyLifecycle } from "./policyLifecycle";

describe("summarizePolicyLifecycle", () => {
  it("recommends the next policy lifecycle step", () => {
    expect(summarizePolicyLifecycle({ currentVersionId: null, versions: [], campaigns: [], attestations: [], today: "2026-07-10" }).state).toBe("needs_version");
    expect(summarizePolicyLifecycle({
      currentVersionId: "v1",
      versions: [{ id: "v1", status: "published" }],
      campaigns: [{ id: "c1", due_date: "2026-07-01" }],
      attestations: [{ campaign_id: "c1", status: "pending", due_date: "2026-07-01" }],
      today: "2026-07-10",
    })).toMatchObject({ state: "overdue", overdueAttestations: 1, pendingAttestations: 1 });
  });
});
