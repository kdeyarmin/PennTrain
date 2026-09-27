import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ useQuery: vi.fn(), from: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.useQuery }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@/lib/identityReverification", () => ({ useRequestIdentityVerification: vi.fn() }));

import { useListPolicyDocuments, useListPolicyDocumentVersions, useListPolicyDocumentVersionsForOrg } from "./usePolicyDocuments";
import { useListPolicyAttestationCampaigns, useListPolicyAttestations } from "./usePolicyAttestations";

beforeEach(() => vi.clearAllMocks());

const readers = [
  ["documents", () => useListPolicyDocuments({ organizationId: "org" }), [["organization_id", "org"]]],
  ["document versions", () => useListPolicyDocumentVersions("document"), [["policy_document_id", "document"]]],
  ["organization versions", () => useListPolicyDocumentVersionsForOrg("org"), [["organization_id", "org"]]],
  ["campaigns", () => useListPolicyAttestationCampaigns({ organizationId: "org", policyDocumentId: "document" }), [["organization_id", "org"], ["policy_document_id", "document"]]],
  ["attestations", () => useListPolicyAttestations({ campaignId: "campaign", employeeId: "employee", facilityId: "facility", status: "pending" }), [["campaign_id", "campaign"], ["employee_id", "employee"], ["facility_id", "facility"], ["status", "pending"]]],
] as const;

function query(pages: Array<{ data: unknown[] | null; error: Error | null }>) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    then(resolve: (value: unknown) => unknown) {
      const page = pages.shift();
      if (!page) throw new Error("Unexpected extra page request");
      return Promise.resolve(page).then(resolve);
    },
  };
  h.from.mockReturnValue(builder);
  return builder;
}

describe.each(readers)("complete policy %s", (_name, read, filters) => {
  it("retains later rows and every scope filter when the API caps pages below the requested size", async () => {
    const builder = query([{ data: [{ id: "first" }], error: null }, { data: [{ id: "second" }], error: null }, { data: [], error: null }]);
    read();
    const result = await h.useQuery.mock.calls.at(-1)![0].queryFn();
    expect(result).toEqual([{ id: "first" }, { id: "second" }]);
    expect(builder.range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
    for (const filter of filters) expect(builder.eq.mock.calls.filter(call => call[0] === filter[0])).toEqual([filter, filter, filter]);
    expect(builder.order.mock.calls.filter(call => call[0] === "id")).toHaveLength(3);
  });

  it("rejects a failed later page instead of presenting a partial policy history", async () => {
    const error = new Error("Later page unavailable");
    query([{ data: [{ id: "first" }], error: null }, { data: null, error }]);
    read();
    await expect(h.useQuery.mock.calls.at(-1)![0].queryFn()).rejects.toBe(error);
  });
});
