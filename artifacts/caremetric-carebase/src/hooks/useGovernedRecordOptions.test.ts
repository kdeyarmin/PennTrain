import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn(), from: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
import { governedRecordOption, useGovernedRecordOptions } from "./useGovernedRecordOptions";

function prepare(pages: Array<{ data: unknown[] | null; error: Error | null }>) {
  const query = {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    then(resolve: (value: unknown) => unknown) { const next = pages.shift(); if (!next) throw new Error("Unexpected request"); return Promise.resolve(next).then(resolve); },
  };
  h.from.mockReturnValue(query); return query;
}
const run = () => h.query.mock.calls.at(-1)![0].queryFn({ signal: new AbortController().signal });
beforeEach(() => vi.clearAllMocks());
describe("governed record choices", () => {
  it.each(["facility", "employee", "profile", "domain", "incident", "complaint", "work_item", "compliance_profile"] as const)("does not read %s before its tenant is known", async kind => {
    useGovernedRecordOptions(kind); expect(h.query.mock.calls.at(-1)![0].enabled).toBe(false);
    expect(await run()).toEqual([]); expect(h.from).not.toHaveBeenCalled();
  });
  it("retains scope and stable pagination when the server response cap is smaller than requested", async () => {
    const query = prepare([{ data: [{ id: "one", title: "First" }], error: null }, { data: [{ id: "two", title: "Second" }], error: null }, { data: [], error: null }]);
    useGovernedRecordOptions("work_item", "org-a", "east");
    expect(await run()).toEqual([{ id: "one", label: "First", description: "Ref one" }, { id: "two", label: "Second", description: "Ref two" }]);
    expect(query.range.mock.calls).toEqual([[0, 499], [1, 500], [2, 501]]);
    expect(query.eq.mock.calls).toEqual(Array.from({ length: 3 }, () => [["organization_id", "org-a"], ["facility_id", "east"]]).flat());
    expect(query.order.mock.calls).toEqual(Array.from({ length: 3 }, () => [["title"], ["id"]]).flat());
    expect(query.select).toHaveBeenCalledWith("id,title,state,due_at");
  });
  it("rejects a partial lookup if a later page fails", async () => {
    prepare([{ data: [{ id: "one", name: "First" }], error: null }, { data: null, error: new Error("Read unavailable") }]);
    useGovernedRecordOptions("facility", "org-a"); await expect(run()).rejects.toThrow("Read unavailable");
  });
  it("offers only verified non-revoked domains for SSO", async () => {
    const query = prepare([{ data: [], error: null }]); useGovernedRecordOptions("domain", "org-a", undefined, true); await run();
    expect(query.eq.mock.calls).toEqual([["organization_id", "org-a"], ["verification_status", "verified"]]);
    expect(query.is).toHaveBeenCalledWith("revoked_at", null);
    expect(query.select.mock.calls[0][0]).not.toContain("challenge");
  });
  it("includes active shared compliance definitions and the selected organization only", async () => {
    const query = prepare([{ data: [], error: null }]); useGovernedRecordOptions("compliance_profile", "org-a"); await run();
    expect(query.or).toHaveBeenCalledWith("organization_id.eq.org-a,organization_id.is.null"); expect(query.eq).toHaveBeenCalledWith("is_active", true);
  });
  it("distinguishes same-name people using readable role and contact details", () => {
    expect(governedRecordOption("profile", { id: "id", first_name: "Alex", last_name: "Lee", email: "alex@example.test", role: "facility_manager" }))
      .toEqual({ id: "id", label: "Alex Lee", description: "alex@example.test · facility manager · Ref id" });
  });
});
