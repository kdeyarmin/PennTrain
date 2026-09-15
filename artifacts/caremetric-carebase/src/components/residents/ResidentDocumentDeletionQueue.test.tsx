import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "org_admin", query: vi.fn(), retry: vi.fn(), toast: vi.fn(), refetch: vi.fn(),
  pending: false,
  row: { document_id: "document-a", resident_id: "resident-awaiting-cleanup", file_name: "Assessment.pdf", storage_bucket: "resident-documents", storage_path: "private-object-path", requested_at: "2026-09-15T00:00:00Z" },
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useMemo: (compute: () => unknown) => compute(),
  useEffect: vi.fn(),
}));
vi.mock("@/hooks/useResidentDocuments", () => ({
  useListPendingResidentDocumentDeletions: h.query,
  useRetryResidentDocumentDeletion: () => ({ mutateAsync: h.retry, isPending: h.pending }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile-a", role: h.role } }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useDocuments", () => ({
  usePaginatedDocuments: () => ({ data: { rows: [], count: 0 } }),
  useUploadDocument: () => ({}), useDocumentSignedUrl: () => ({}), useDeleteDocument: () => ({}),
}));

import { ResidentDocumentDeletionQueue } from "./ResidentDocumentDeletionQueue";
import Documents from "@/pages/app/Documents";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node
    ? text((node as Node).props.children as ReactNode) : "";
}
function retryButton(tree: ReactNode) {
  return nodes(tree).find((node) => node.props["aria-label"] === "Retry deletion of Assessment.pdf")!;
}

beforeEach(() => {
  h.role = "org_admin"; h.pending = false;
  h.query.mockReset().mockReturnValue({ data: [h.row], isError: false, isLoading: false, refetch: h.refetch });
  h.retry.mockReset().mockResolvedValue(undefined); h.toast.mockReset(); h.refetch.mockReset();
});

describe("resident deletion cleanup visibility", () => {
  it("retries an org-wide pending receipt without opening the individual resident record", async () => {
    const tree = ResidentDocumentDeletionQueue({});
    expect(h.query).toHaveBeenCalledWith(undefined, true);
    expect(text(tree)).toContain("Assessment.pdf");
    expect(text(tree)).not.toContain("private-object-path");
    (retryButton(tree).props.onClick as () => void)();
    await vi.waitFor(() => expect(h.retry).toHaveBeenCalledWith(h.row));
    expect(h.toast).toHaveBeenCalledWith({ title: "Document deleted" });
  });

  it("keeps the resident scope and hides cached receipts when disabled", () => {
    ResidentDocumentDeletionQueue({ residentId: "resident-a" });
    expect(h.query).toHaveBeenLastCalledWith("resident-a", true);
    expect(ResidentDocumentDeletionQueue({ residentId: "resident-a", enabled: false })).toBeNull();
    expect(h.query).toHaveBeenLastCalledWith("resident-a", false);
    expect(h.retry).not.toHaveBeenCalled();
  });

  it("does not announce deletion when cleanup remains pending", async () => {
    h.retry.mockRejectedValue(new Error("Storage confirmation unavailable"));
    (retryButton(ResidentDocumentDeletionQueue({})).props.onClick as () => void)();
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith({
      title: "File deletion is still pending", description: "Storage confirmation unavailable", variant: "destructive",
    }));
    expect(h.toast).not.toHaveBeenCalledWith({ title: "Document deleted" });
  });

  it("disables repeated retry while cleanup is running", () => {
    h.pending = true;
    const button = retryButton(ResidentDocumentDeletionQueue({}));
    expect(button.props.disabled).toBe(true);
    (button.props.onClick as () => void)();
    expect(h.retry).not.toHaveBeenCalled();
  });

  it("surfaces a failed receipt query instead of offering stale cleanup actions", () => {
    const failure = new Error("Receipt list unavailable");
    h.query.mockReturnValue({ data: [h.row], isError: true, error: failure, refetch: h.refetch });
    const tree = ResidentDocumentDeletionQueue({});
    expect(retryButton(tree)).toBeUndefined();
    const error = nodes(tree).find((node) => node.props.what === "pending resident file deletions")!;
    expect(error.props.error).toBe(failure);
    (error.props.onRetry as () => void)();
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it.each(["org_admin", "platform_admin"])("makes cleanup discoverable in Documents for %s", (role) => {
    h.role = role;
    const queue = nodes(Documents()).find((node) => node.type === ResidentDocumentDeletionQueue);
    expect(queue).toBeDefined();
    expect(queue?.props.residentId).toBeUndefined();
  });

  it.each(["facility_manager", "trainer", "employee", "auditor"])("does not offer org-wide cleanup to %s", (role) => {
    h.role = role;
    expect(nodes(Documents()).some((node) => node.type === ResidentDocumentDeletionQueue)).toBe(false);
  });
});
