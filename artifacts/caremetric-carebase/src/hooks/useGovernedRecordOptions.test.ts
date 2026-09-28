import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn(), from: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
import { governedRecordOption, governedRecordSearchFilter, useGovernedRecordOptions } from "./useGovernedRecordOptions";

function prepare(pages: Array<{ data: unknown[] | null; error: Error | null }>) {
  const query = {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(),
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
  it("reads one bounded page for the picker instead of the whole table", async () => {
    const query = prepare([{ data: [{ id: "one", title: "First" }], error: null }]);
    useGovernedRecordOptions("work_item", "org-a", "east");
    expect(await run()).toEqual([{ id: "one", label: "First", description: "Ref one" }]);
    expect(query.limit).toHaveBeenCalledWith(50);
    expect(query.range).not.toHaveBeenCalled();
    expect(query.eq.mock.calls).toEqual([["organization_id", "org-a"], ["facility_id", "east"]]);
    expect(query.order.mock.calls).toEqual([["title"], ["id"]]);
    expect(query.select).toHaveBeenCalledWith("id,title,state,due_at");
    expect(query.or).not.toHaveBeenCalled();
  });
  it("sends the search to the server and still resolves a selected record outside that page", async () => {
    const query = prepare([{ data: [{ id: "one", title: "Night" }], error: null }, { data: [{ id: "kept", title: "Kept" }], error: null }]);
    useGovernedRecordOptions("work_item", "org-a", undefined, false, "Night shift", "kept");
    expect(await run()).toEqual([
      { id: "kept", label: "Kept", description: "Ref kept" },
      { id: "one", label: "Night", description: "Ref one" },
    ]);
    expect(query.or).toHaveBeenCalledWith(governedRecordSearchFilter(["title"], "Night shift"));
    expect(query.limit.mock.calls).toEqual([[50], [1]]);
    expect(query.eq.mock.calls).toContainEqual(["id", "kept"]);
  });
  it("rejects the lookup when the read fails", async () => {
    prepare([{ data: null, error: new Error("Read unavailable") }]);
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
