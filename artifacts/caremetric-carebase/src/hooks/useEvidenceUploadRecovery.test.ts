import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mutation: vi.fn(), upload: vi.fn(), remove: vi.fn(), write: vi.fn(), read: vi.fn(), eq: vi.fn(), from: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useMutation: h.mutation, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/hooks/useResidentAssessmentForms", () => ({ describeFunctionError: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  rpc: h.write,
  storage: { from: () => ({ upload: h.upload, remove: h.remove }) },
  from: (table: string) => { h.from(table); const query = { select: () => query, insert: () => query,
    eq: (...args: unknown[]) => { h.eq(...args); return query; }, single: h.write, maybeSingle: h.read }; return query; },
} }));
import { useUploadIncidentDocument } from "./useIncidentDocuments";
import { useUploadViolationDocument } from "./useViolationDocuments";
import { useUploadComplianceEvidence } from "./useComplianceRequirements";
import { useUploadWorkItemEvidence } from "./useWorkItems";
import { useUploadAnalyzerDocuments } from "./useDocumentAnalyzer";

const file = new File(["pdf"], "evidence.pdf", { type: "application/pdf" });
const scope = { organizationId: "org", facilityId: "facility", file };
const cases = [
  { name: "incident", hook: useUploadIncidentDocument, input: { ...scope, incidentId: "incident" }, table: "incident_documents", parent: ["incident_id", "incident"], bucket: "incident-documents" },
  { name: "violation", hook: useUploadViolationDocument, input: { ...scope, violationId: "violation" }, table: "violation_documents", parent: ["violation_id", "violation"], bucket: "violation-documents" },
  { name: "compliance", hook: useUploadComplianceEvidence, input: { file, instance: { id: "instance", organization_id: "org", facility_id: "facility" } }, table: "compliance_requirement_documents", parent: ["instance_id", "instance"], bucket: "compliance-evidence" },
  { name: "work item", hook: useUploadWorkItemEvidence, input: { file, workItem: { id: "work", organization_id: "org", facility_id: "facility" }, evidenceType: "photo" }, table: "work_item_evidence", parent: ["work_item_id", "work"], bucket: "work-item-evidence" },
  { name: "analyzer", hook: useUploadAnalyzerDocuments, input: [file], table: "document_analyzer_jobs", parent: null, bucket: "state-form-analyzer" },
];
beforeEach(() => {
  vi.resetAllMocks();
  h.upload.mockResolvedValue({ error: null }); h.remove.mockResolvedValue({ error: null });
  h.write.mockResolvedValue({ data: null, error: new Error("Response lost") }); h.read.mockResolvedValue({ data: null, error: null });
});
describe.each(cases)("$name evidence upload", (testCase) => {
  const run = () => { testCase.hook(); return h.mutation.mock.calls.at(-1)![0].mutationFn(testCase.input); };
  const expectFailure = async (message: string) => {
    if (testCase.name === "analyzer") {
      const result = await run(); expect(result.enqueued).toEqual([]); expect(result.rejected[0].reason).toContain(message);
    } else await expect(run()).rejects.toMatchObject({ message: expect.stringContaining(message) });
  };
  it("recovers the exact committed link without removing its bytes", async () => {
    const saved = { id: "saved" }; h.read.mockResolvedValue({ data: saved, error: null });
    const result = await run();
    expect(result).toEqual(testCase.name === "analyzer" ? { enqueued: [saved], rejected: [] } : testCase.name === "work item" ? "saved" : saved);
    expect(h.remove).not.toHaveBeenCalled(); expect(h.from).toHaveBeenCalledWith(testCase.table);
    const path = h.upload.mock.calls[0][0];
    expect(h.eq.mock.calls).toContainEqual([testCase.name === "analyzer" ? "source_path" : "storage_path", path]);
    if (testCase.parent) {
      expect(h.eq.mock.calls).toContainEqual(testCase.parent);
      expect(h.eq.mock.calls).toContainEqual(["organization_id", "org"]);
      expect(h.eq.mock.calls).toContainEqual(["storage_bucket", testCase.bucket]);
    }
  });
  it("retains bytes when a lost response has an empty readback", async () => {
    await expectFailure("uploaded file was retained"); expect(h.remove).not.toHaveBeenCalled();
  });
  it("retains bytes when verification is unavailable", async () => {
    h.read.mockRejectedValue(new Error("Offline")); await expectFailure("refresh the document list"); expect(h.remove).not.toHaveBeenCalled();
  });
  it("cleans only a definitively rejected write with confirmed absence", async () => {
    h.write.mockResolvedValue({ error: { code: "42501", message: "Denied" } }); await expectFailure("Denied");
    expect(h.remove).toHaveBeenCalledWith([h.upload.mock.calls[0][0]]);
    expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.remove.mock.invocationCallOrder[0]);
  });
  it("reports cleanup failure after definitive rejection", async () => {
    h.write.mockResolvedValue({ error: { code: "23514", message: "Rejected" } });
    h.remove.mockResolvedValue({ error: { message: "Storage unavailable" } });
    await expectFailure("also failed to remove uploaded file: Storage unavailable");
  });
});
