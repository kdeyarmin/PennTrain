import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("@/hooks/useResidentRecordDestructions", () => ({ useResidentRecordDestructions: h.query }));
import { ResidentRecordDestructionLog } from "./ResidentRecordDestructionLog";
type Node = ReactElement<Record<string, unknown>>;
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Node).props.children as ReactNode) : "";
}
const entry = { id: "entry", resident_name: "Pat Morgan", record_number: "resident-record-id", date_of_birth: "1940-01-01", admission_date: "2020-01-01", discharge_date: "2022-01-01", record_table: "resident_documents", record_id: "document-id", completed_at: null };
beforeEach(() => { h.query.mockReset().mockReturnValue({ data: [entry], isLoading: false, isError: false }); });
describe("resident record destruction log", () => {
  it("preserves identity while distinguishing metadata removal from file destruction", () => {
    const tree = ResidentRecordDestructionLog({ residentId: "resident-a" });
    expect(h.query).toHaveBeenCalledWith("resident-a", true);
    expect(text(tree)).toContain("Pat Morgan");
    expect(text(tree)).toContain("resident-record-id");
    expect(text(tree)).toContain("document-id");
    expect(text(tree)).toContain("File cleanup pending");
    h.query.mockReturnValue({ data: [{ ...entry, completed_at: "2026-09-26T12:00:00Z" }] });
    expect(text(ResidentRecordDestructionLog({}))).not.toContain("File cleanup pending");
  });
  it("hides cached private records when disabled", () => {
    expect(ResidentRecordDestructionLog({ residentId: "resident-a", enabled: false })).toBeNull();
    expect(h.query).toHaveBeenCalledWith("resident-a", false);
  });
  it("does not turn unavailable history into an empty success state", () => {
    const failure = new Error("History unavailable");
    h.query.mockReturnValue({ data: [entry], isError: true, error: failure, refetch: h.refetch });
    const tree = ResidentRecordDestructionLog({}) as Node;
    expect(tree.props.error).toBe(failure);
    expect(text(tree)).not.toContain("Pat Morgan");
    (tree.props.onRetry as () => void)();
    expect(h.refetch).toHaveBeenCalledOnce();
  });
});
