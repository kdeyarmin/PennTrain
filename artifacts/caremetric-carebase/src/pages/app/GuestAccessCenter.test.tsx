import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  filters: { kind: "all", status: "active" }, user: { id: "manager", organizationId: "org-a", role: "org_admin" }, viewingOrgId: null as string | null,
  query: {} as Record<string, any>, load: vi.fn(), retry: vi.fn(), update: vi.fn(), hook: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (fn: () => unknown) => fn(), useId: () => "guest-form", useState: (initial: unknown) => [initial, vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.viewingOrgId }) }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => [h.filters, h.update] }));
vi.mock("@/hooks/useGuestAccessGrants", () => ({ useGuestAccessGrants: (...args: unknown[]) => { h.hook(...args); return h.query; } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
import GuestAccessCenter from "./GuestAccessCenter";

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
const grant = { kind: "evidence", id: "grant-1", label: "Survey visitor", revokedAt: null, expiresAt: null, createdAt: "2026-01-01T00:00:00Z", parentHref: "/app/evidence/collection-1", parentLabel: "Open evidence collection" };
beforeEach(() => {
  vi.clearAllMocks(); h.filters = { kind: "all", status: "active" }; h.viewingOrgId = null;
  h.user = { id: "manager", organizationId: "org-a", role: "org_admin" };
  h.query = { data: { pages: [{ rows: [grant] }] }, hasNextPage: true, isLoading: false, isError: false, isFetchNextPageError: false, isFetching: false, isFetchingNextPage: false, fetchNextPage: h.load, refetch: h.retry };
});

describe("guest access continuation and recovery", () => {
  it("loads older matching grants without implying the first page is complete", () => {
    const tree = GuestAccessCenter();
    expect(text(tree)).toContain("Older grants are available.");
    expect(text(tree)).not.toContain("200");
    nodes(tree).find(node => node.props.onClick && text(node) === "Load older grants")!.props.onClick();
    expect(h.load).toHaveBeenCalledOnce();
  });
  it("retains visible grants when only loading the next page fails, and offers a targeted retry", () => {
    h.query.isError = h.query.isFetchNextPageError = true;
    const tree = GuestAccessCenter();
    expect(text(tree)).toContain("Survey visitor");
    expect(text(tree)).toContain("Your current results are still available.");
    nodes(tree).find(node => node.props.onClick && text(node) === "Retry loading older grants")!.props.onClick();
    expect(h.load).toHaveBeenCalledOnce();
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("hides stale grant data after a failed refresh instead of allowing actions on it", () => {
    h.query.isError = true;
    const tree = GuestAccessCenter();
    expect(text(tree)).not.toContain("Survey visitor");
    expect(nodes(tree).some(node => node.props.what === "guest access grants" && node.props.onRetry)).toBe(true);
    expect(text(tree)).not.toContain("All matching grants loaded.");
  });
  it("disables continuation while a read is pending", () => {
    h.query.isFetching = h.query.isFetchingNextPage = true;
    const button = nodes(GuestAccessCenter()).find(node => text(node) === "Loading older grants…")!;
    expect(button.props.disabled).toBe(true);
  });
  it("describes completion only when all matching grants were loaded", () => {
    h.query.hasNextPage = false;
    const tree = GuestAccessCenter();
    expect(text(tree)).toContain("All matching grants loaded.");
    expect(nodes(tree).some(node => node.props.onClick && text(node) === "Load older grants")).toBe(false);
  });
  it("offers an empty-result reset and persists filters using the URL state", () => {
    h.query.data.pages[0].rows = []; h.query.hasNextPage = false;
    h.filters = { kind: "evidence", status: "inactive" };
    const tree = GuestAccessCenter();
    nodes(tree).find(node => node.props.onClick && text(node) === "Show all grants")!.props.onClick();
    expect(h.update).toHaveBeenCalledWith({ kind: "all", status: "all" });
    expect(h.hook).toHaveBeenCalledWith(expect.objectContaining({ kind: "evidence", status: "inactive" }), "manager");
  });
  it("uses the viewed organization and platform resident path while rejecting unknown URL filter values", () => {
    h.viewingOrgId = "viewed-org"; h.user.role = "platform_admin"; h.filters = { kind: "invalid", status: "invalid" };
    GuestAccessCenter();
    expect(h.hook).toHaveBeenCalledWith({ organizationId: "viewed-org", kind: "all", status: "active", residentBase: "/admin/residents" }, "manager");
  });
  it("keeps guest auditors read-only", () => {
    h.user.role = "guest_auditor";
    const tree = GuestAccessCenter();
    expect(nodes(tree).some(node => node.props["aria-label"] === "Revoke access for Survey visitor")).toBe(false);
    expect(text(tree)).toContain("Read-only for auditors");
  });
});
