import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("https://guest-pagination.test", "test-anon-key", {
    global: { fetch: h.fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) };
});
import { fetchGuestGrantPage, GRANT_PAGE_SIZE, type GrantPageCursor, type GrantFilters } from "./useGuestAccessGrants";

type Row = { id: string; created_at: string; expires_at: string | null; revoked_at: string | null; organization_id: string; guest_label: string; collection_id: string; workspace_id: string; resident_id: string };
let tables: Record<string, Row[]>;
let requests: URL[];
const base: GrantFilters = { organizationId: "org-a", kind: "all", status: "all", residentBase: "/app/residents" };
const names = ["evidence_guest_grants", "move_in_guest_grants", "resident_agreement_guest_grants", "resident_portal_grants"];
function row(id: number, day = 1): Row {
  return { id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, created_at: `2026-01-${String(day).padStart(2, "0")}T00:00:00+00:00`, expires_at: null, revoked_at: null, organization_id: "org-a", guest_label: `Guest ${id}`, collection_id: "collection-a", workspace_id: "workspace-a", resident_id: "resident-a" };
}
beforeEach(() => {
  tables = Object.fromEntries(names.map(name => [name, []])); requests = [];
  h.fetch.mockReset().mockImplementation(async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url);
    let rows = [...tables[url.pathname.split("/").at(-1)!]];
    const params = url.searchParams;
    rows = rows.filter(row => `eq.${row.organization_id}` === params.get("organization_id"));
    const cutoff = params.get("created_at")!.slice(4);
    rows = rows.filter(row => new Date(row.created_at) <= new Date(cutoff));
    for (const or of params.getAll("or")) {
      if (or.includes("created_at.lt.")) {
        const [, createdAt, id] = or.match(/^\(created_at\.lt\.(.+),and\(created_at\.eq\..+,id\.lt\.(.+)\)\)$/)!;
        rows = rows.filter(row => row.created_at < createdAt || (row.created_at === createdAt && row.id < id));
      } else if (or.includes("expires_at.gt.")) {
        const now = or.match(/expires_at\.gt\.(.+)\)$/)![1];
        rows = rows.filter(row => !row.revoked_at && (!row.expires_at || new Date(row.expires_at) > new Date(now)));
      } else if (or.includes("expires_at.lte.")) {
        const now = or.match(/expires_at\.lte\.(.+)\)$/)![1];
        rows = rows.filter(row => row.revoked_at || (row.expires_at && new Date(row.expires_at) <= new Date(now)));
      }
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    return new Response(JSON.stringify(rows.slice(0, Number(params.get("limit")))), { headers: { "Content-Type": "application/json" } });
  });
});

describe("guest grant pagination through the existing Data API", () => {
  it("reaches grants past the old 200-row cap, including timestamp ties, exactly once", async () => {
    tables.evidence_guest_grants = Array.from({ length: 237 }, (_, index) => row(index + 1));
    let cursor: GrantPageCursor | undefined = {};
    const ids: string[] = [];
    do {
      const page = await fetchGuestGrantPage({ ...base, kind: "evidence" }, cursor);
      expect(page.rows.length).toBeLessThanOrEqual(GRANT_PAGE_SIZE);
      ids.push(...page.rows.map(grant => grant.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(tables.evidence_guest_grants.map(grant => grant.id).reverse());
    expect(new Set(ids).size).toBe(237);
    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(request.searchParams.get("order")).toBe("created_at.desc,id.desc");
      expect(request.searchParams.get("organization_id")).toBe("eq.org-a");
      expect(request.searchParams.get("select")).not.toMatch(/token|hash|secret/);
    }
  });

  it("merges types in descending time order without losing unconsumed rows from another source", async () => {
    tables.evidence_guest_grants = Array.from({ length: 60 }, (_, i) => row(i + 1, 20));
    tables.move_in_guest_grants = Array.from({ length: 6 }, (_, i) => row(i + 100, 10));
    tables.resident_agreement_guest_grants = [row(200, 25)];
    const first = await fetchGuestGrantPage(base);
    expect(first.rows[0].kind).toBe("agreement");
    expect(first.rows.at(-1)?.kind).toBe("evidence");
    const second = await fetchGuestGrantPage(base, first.nextCursor);
    expect(second.rows).toHaveLength(17);
    expect(second.rows.slice(-6).every(grant => grant.kind === "move_in")).toBe(true);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.rows, ...second.rows].map(grant => `${grant.kind}/${grant.id}`)).size).toBe(67);
    expect(requests.filter(request => request.pathname.endsWith("resident_agreement_guest_grants"))).toHaveLength(1);
    expect(requests.filter(request => request.pathname.endsWith("resident_portal_grants"))).toHaveLength(1);
  });

  it("keeps organization, type and active status server-scoped on continuation pages", async () => {
    tables.evidence_guest_grants = [
      ...Array.from({ length: 60 }, (_, i) => row(i + 1)),
      { ...row(500, 30), revoked_at: "2026-02-01T00:00:00Z" },
      { ...row(501, 30), expires_at: "2026-02-01T00:00:00Z" },
      { ...row(502, 30), organization_id: "org-b" },
    ];
    const filters = { ...base, kind: "evidence", status: "active" } as const;
    const first = await fetchGuestGrantPage(filters);
    // Newer grants cannot insert themselves above the existing page; a deleted/revoked row
    // also does not shift a numeric offset and skip another grant.
    tables.evidence_guest_grants = tables.evidence_guest_grants.filter(grant => grant.id !== first.rows[0].id);
    const second = await fetchGuestGrantPage(filters, first.nextCursor);
    expect(first.rows.length + second.rows.length).toBe(60);
    expect(requests.every(request => request.pathname.endsWith("evidence_guest_grants"))).toBe(true);
    expect(requests[1].searchParams.getAll("or")).toHaveLength(2);
    expect(requests[1].searchParams.get("revoked_at")).toBe("is.null");
    expect(requests[1].searchParams.get("created_at")).toBe(requests[0].searchParams.get("created_at"));
  });

  it("keeps inactive filtering and platform resident destinations", async () => {
    tables.resident_agreement_guest_grants = [row(1), { ...row(2), revoked_at: "2026-02-01T00:00:00Z" }];
    const page = await fetchGuestGrantPage({ ...base, kind: "agreement", status: "inactive", residentBase: "/admin/residents" });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].parentHref).toBe("/admin/residents/resident-a");
  });

  it("fails the whole page on a source error instead of claiming the missing source is exhausted", async () => {
    h.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Grant read failed", code: "42501" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    await expect(fetchGuestGrantPage(base)).rejects.toMatchObject({ message: "Grant read failed" });
  });
});
