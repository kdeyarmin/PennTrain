import { describe, expect, it } from "vitest";
import { summarizePolicyLifecycle } from "./policyLifecycle";

describe("summarizePolicyLifecycle", () => {
  it("recommends the next policy lifecycle step", () => {
    expect(summarizePolicyLifecycle({ currentVersionId: null, versions: [], campaigns: [], attestations: [], today: "2026-07-10" }).state).toBe("needs_version");
    expect(summarizePolicyLifecycle({
      currentVersionId: "v1",
      versions: [{ id: "v1", status: "published" }],
      campaigns: [{ id: "c1", due_date: "2026-07-01", policy_document_version_id: "v1" }],
      attestations: [{ campaign_id: "c1", status: "pending", due_date: "2026-07-01" }],
      today: "2026-07-10",
    })).toMatchObject({ state: "overdue", overdueAttestations: 1, pendingAttestations: 1 });
  });

  // BACKLOG J88. Publishing a new version closes every campaign pinned to an older one and marks
  // their pending attestations superseded. Counting those rows made the same campaign wrong in
  // opposite directions depending on how far it had got.
  it("ignores a campaign pinned to a superseded version", () => {
    const versions = [{ id: "v1", status: "published" }, { id: "v2", status: "published" }];

    // Fully signed against v1: this used to read "Lifecycle current", offering a signature on text
    // nobody is required to follow as inspection-ready evidence for the version now in force.
    expect(summarizePolicyLifecycle({
      currentVersionId: "v2",
      versions,
      campaigns: [{ id: "c1", due_date: "2026-07-01", policy_document_version_id: "v1" }],
      attestations: [{ campaign_id: "c1", status: "attested", due_date: "2026-07-01" }],
      today: "2026-07-10",
    })).toMatchObject({ state: "ready_for_campaign", campaigns: 0, attestedCount: 0 });

    // Still pending against v1: this used to read "Attestations overdue" for ever, because
    // attest-policy refuses a superseded row and nothing else can clear it.
    expect(summarizePolicyLifecycle({
      currentVersionId: "v2",
      versions,
      campaigns: [{ id: "c1", due_date: "2026-07-01", policy_document_version_id: "v1" }],
      attestations: [{ campaign_id: "c1", status: "pending", due_date: "2026-07-01" }],
      today: "2026-07-10",
    })).toMatchObject({ state: "ready_for_campaign", overdueAttestations: 0, pendingAttestations: 0 });

    // And a campaign on the current version is still counted, so the scoping cannot be mistaken
    // for "no campaign ever counts".
    expect(summarizePolicyLifecycle({
      currentVersionId: "v2",
      versions,
      campaigns: [
        { id: "c1", due_date: "2026-07-01", policy_document_version_id: "v1" },
        { id: "c2", due_date: "2026-08-01", policy_document_version_id: "v2" },
      ],
      attestations: [
        { campaign_id: "c1", status: "pending", due_date: "2026-07-01" },
        { campaign_id: "c2", status: "pending", due_date: "2026-08-01" },
      ],
      today: "2026-07-10",
    })).toMatchObject({ state: "in_progress", campaigns: 1, pendingAttestations: 1, overdueAttestations: 0 });
  });
});
