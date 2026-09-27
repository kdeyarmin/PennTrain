import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from, rpc: h.rpc } }));
import { useEnterpriseRoleTemplates, usePermissionDefinitions, useRoleTemplatePermissions } from "./useEnterpriseRoleTemplates";
import { useListOrganizations } from "./useOrganizations";
import { useScimConnectionRegistry, useSsoConnections } from "./useScimRegistry";
import { useStandingEnterpriseGrants } from "./useEnterpriseAccessGrants";
import { useAdminRegulatoryUpdates } from "./useRegulatoryUpdates";

const readers = [
  ["templates", useEnterpriseRoleTemplates, ["name", "id"], ["is_active", true]],
  ["permission definitions", usePermissionDefinitions, ["permission_key"], ["is_active", true]],
  ["saved permission set", () => useRoleTemplatePermissions("role-a"), ["permission_key"], ["role_template_id", "role-a"]],
  ["organizations", useListOrganizations, ["name", "id"], null],
  ["SSO connections", useSsoConnections, ["display_name", "id"], null],
  ["SCIM registry", useScimConnectionRegistry, ["display_name", "connection_id"], null],
  ["standing grants", useStandingEnterpriseGrants, ["effective_from", "id"], null],
  ["regulatory administration", useAdminRegulatoryUpdates, ["created_at", "id"], null],
] as const;
beforeEach(() => vi.clearAllMocks());
function prepare(pages: Array<{ data: unknown[] | null; error: Error | null }>) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(),
    then(resolve: (value: unknown) => unknown) { const page = pages.shift(); if (!page) throw new Error("Unexpected page"); return Promise.resolve(page).then(resolve); },
  };
  h.from.mockReturnValue(builder); h.rpc.mockReturnValue(builder); return builder;
}
describe.each(readers)("complete enterprise %s", (name, read, order, filter) => {
  it("preserves all permissions and templates when the response cap is smaller than requested", async () => {
    const first = { id: "a", permission_key: "read" }; const second = { id: "b", permission_key: "manage" };
    const q = prepare([{ data: [first], error: null }, { data: [second], error: null }, { data: [], error: null }]);
    const signal = new AbortController().signal; read();
    const result = await h.query.mock.calls.at(-1)![0].queryFn({ signal });
    if (name === "standing grants") {
      expect(result.map((row: { id: string }) => row.id)).toEqual(["a", "b"]);
      expect(q.is.mock.calls).toEqual([["effective_to", null], ["effective_to", null], ["effective_to", null]]);
    } else expect(result).toEqual(name === "saved permission set" ? ["read", "manage"] : [first, second]);
    expect(q.range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
    expect(q.eq.mock.calls).toEqual(filter ? [filter, filter, filter] : []);
    expect(q.order.mock.calls.map(args => args[0])).toEqual([...order, ...order, ...order]);
    expect(q.abortSignal.mock.calls).toEqual([[signal], [signal], [signal]]);
  });
  it("rejects a later read failure instead of offering a partial permission set to replace", async () => {
    const error = new Error("Later permissions unavailable"); prepare([{ data: [{ id: "a", permission_key: "read" }], error: null }, { data: null, error }]);
    read(); await expect(h.query.mock.calls.at(-1)![0].queryFn({ signal: new AbortController().signal })).rejects.toThrow(error.message);
  });
});
