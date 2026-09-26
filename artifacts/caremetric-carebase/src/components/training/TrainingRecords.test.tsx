import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], index: 0, save: vi.fn(), upload: vi.fn(), toast: vi.fn(), signed: vi.fn(), open: vi.fn(), export: vi.fn(),
  data: { templates: [{ id: "checklist", title: "Hand hygiene", instructions: "Observe a complete demonstration.", items: ["Cleans hands", "Uses clean equipment"], archived: false }], observations: [] as unknown[], external: [] as unknown[], submission_document_ids: ["proof"] },
  documents: [{ id: "proof", file_name: "Outside course.pdf", document_type: "external_certificate" }, { id: "manager-proof", file_name: "Manager-uploaded.pdf", document_type: "external_certificate" }],
  pending: false, error: false, refetch: vi.fn(), records: vi.fn(), listDocuments: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index = h.index++;
  if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
  return [h.state[index], (next: unknown) => { h.state[index] = typeof next === "function" ? next(h.state[index]) : next; }];
} }));
vi.mock("@/hooks/useTrainingExperience", () => ({
  useTrainingRecords: (...args: unknown[]) => { h.records(...args); return { data: h.data, isLoading: false, isError: h.error, refetch: h.refetch }; },
  useSaveTrainingExperience: () => ({ mutateAsync: h.save, isPending: h.pending }),
}));
vi.mock("@/hooks/useDocuments", () => ({ useListDocuments: (...args: unknown[]) => { h.listDocuments(...args); return { data: args[1] ? h.documents : undefined }; }, useUploadDocument: () => ({ mutateAsync: h.upload, isPending: false }), useDocumentSignedUrl: () => ({ mutateAsync: h.signed, isPending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/openDocumentUrl", () => ({ openDocumentUrl: h.open }));
vi.mock("@/lib/csv", () => ({ downloadCsv: h.export }));
import { TrainingRecords } from "./TrainingRecords";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Node).props.children as ReactNode) : "";
}
const learnerProps = { facilityId: "facility-a", organizationId: "org-a", employeeId: "employee-a" };
const managerProps = { facilityId: "facility-a", organizationId: "org-a", canManage: true, employees: [{ id: "employee-a", first_name: "Casey", last_name: "Learner", status: "active" }] };
function render(manager = false) { h.index = 0; return TrainingRecords(manager ? managerProps : learnerProps); }
function field(tree: ReactNode, label: string) {
  const wrapper = nodes(tree).find(node => node.type === "label" && text(node).startsWith(label));
  if (!wrapper) throw new Error(`Missing field ${label}`);
  return nodes(wrapper).find(node => ["input", "select", "textarea"].includes(String(node.type)))!;
}
function change(node: Node, value: unknown) { (node.props.onChange as (event: unknown) => void)({ target: { value, files: value ? [value] : [] } }); }
function form(tree: ReactNode, button: string) { return nodes(tree).find(node => node.type === "form" && text(node).includes(button))!; }
async function submit(node: Node, values: Record<string, string>) {
  const reset = vi.fn();
  await (node.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn(), currentTarget: { values, reset } });
  return reset;
}
const outsideFields = { title: "Outside first-aid course", provider: "Community educator", completed_on: "2026-09-01", minutes: "90" };
beforeEach(() => {
  h.state = []; h.index = 0; h.pending = false; h.error = false; h.data.observations = []; h.data.external = [];
  h.save.mockReset().mockResolvedValue({ id: "record" }); h.upload.mockReset().mockResolvedValue({ id: "uploaded-proof" }); h.toast.mockReset(); h.records.mockReset(); h.listDocuments.mockReset(); h.refetch.mockReset(); h.signed.mockReset(); h.open.mockReset(); h.export.mockReset();
  vi.stubGlobal("FormData", class { constructor(private form: { values: Record<string, string> }) {} get(key: string) { return this.form.values[key] ?? null; } has(key: string) { return key in this.form.values; } });
});
afterEach(() => vi.unstubAllGlobals());

describe("outside training submissions", () => {
  it("offers only actual learner-owned uploads while explaining how to submit a manager-uploaded certificate", () => {
    const tree = render();
    const choices = text(field(tree, "Or choose an existing document"));
    expect(choices).toContain("Outside course.pdf");
    expect(choices).not.toContain("Manager-uploaded.pdf");
    expect(text(tree)).toContain("If someone else uploaded your certificate, upload your own copy.");
  });
  it("submits selected evidence with the learner and facility, without completing an assigned course", async () => {
    let tree = render();
    expect(h.records).toHaveBeenCalledWith("facility-a", "employee-a");
    change(field(tree, "Or choose an existing document"), "proof"); tree = render();
    await submit(form(tree, "Submit for review"), outsideFields);
    expect(h.save).toHaveBeenCalledWith({ action: "submit_external", facilityId: "facility-a", employeeId: "employee-a", data: { document_id: "proof", title: "Outside first-aid course", provider: "Community educator", completed_on: "2026-09-01", minutes: 90 } });
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({ title: "Training record saved" });
    expect(field(render(), "Or choose an existing document").props.value).toBe("");
    expect(text(tree)).toContain("do not complete assigned courses or issue CareMetric course certificates");
  });
  it("uploads a new certificate before submitting the returned evidence identity", async () => {
    const file = new File(["pdf evidence"], "certificate.pdf", { type: "application/pdf" });
    change(field(render(), "Upload certificate or transcript"), file);
    await submit(form(render(), "Submit for review"), outsideFields);
    expect(h.upload).toHaveBeenCalledWith({ file, bucket: "external-uploads", organizationId: "org-a", facilityId: "facility-a", employeeId: "employee-a", documentType: "external_certificate" });
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ document_id: "uploaded-proof" }) }));
    expect(h.upload.mock.invocationCallOrder[0]).toBeLessThan(h.save.mock.invocationCallOrder[0]);
  });
  it("does not announce or submit a record when evidence upload fails", async () => {
    h.upload.mockRejectedValueOnce(new Error("Evidence upload unavailable"));
    change(field(render(), "Upload certificate or transcript"), new File(["proof"], "certificate.pdf", { type: "application/pdf" }));
    await submit(form(render(), "Submit for review"), outsideFields);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({ title: "Training record could not be saved", description: "Evidence upload unavailable", variant: "destructive" });
    expect(h.toast).not.toHaveBeenCalledWith({ title: "Training record saved" });
  });
  it("keeps an uploaded proof for retry when record submission fails, avoiding a duplicate upload", async () => {
    h.save.mockRejectedValueOnce(new Error("Review queue unavailable"));
    change(field(render(), "Upload certificate or transcript"), new File(["proof"], "certificate.pdf", { type: "application/pdf" }));
    await submit(form(render(), "Submit for review"), outsideFields);
    expect(h.toast).not.toHaveBeenCalledWith({ title: "Training record saved" });
    expect(field(render(), "Or choose an existing document").props.value).toBe("uploaded-proof");
    await submit(form(render(), "Submit for review"), outsideFields);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].data.document_id).toBe("uploaded-proof");
  });
  it("requires evidence and rejects an unsupported file before calling upload", async () => {
    const button = nodes(render()).find(node => text(node) === "Submit for review" && node.props.disabled !== undefined)!;
    expect(button.props.disabled).toBe(true);
    await submit(form(render(), "Submit for review"), outsideFields);
    expect(h.save).not.toHaveBeenCalled();
    change(field(render(), "Upload certificate or transcript"), new File(["untrusted"], "notes.txt", { type: "text/plain" }));
    await submit(form(render(), "Submit for review"), outsideFields);
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: "Choose a PDF, PNG or JPEG no larger than 20 MB.", variant: "destructive" }));
  });
});

describe("practical observation and review", () => {
  it("lets authorized read-only facility viewers open evidence without showing review actions", async () => {
    h.data.external = [{ id: "outside-a", employee_id: "employee-a", employee_name: "Casey Learner", title: "CPR", provider: "Outside provider", completed_on: "2026-09-01", minutes: 60, status: "pending", evidence_document_id: "proof", review_note: null }];
    h.signed.mockResolvedValue("https://example.test/signed-proof");
    const tree = TrainingRecords({ facilityId: "facility-a", organizationId: "org-a", canManage: false });
    expect(h.listDocuments).toHaveBeenCalledWith({ facilityId: "facility-a", employeeId: undefined, documentTypes: ["external_certificate", "transcript"] }, true);
    const evidence = nodes(tree).find(node => text(node) === "View submitted evidence" && node.props.onClick)!;
    expect(evidence.props.disabled).toBe(false);
    await (evidence.props.onClick as () => Promise<void>)();
    expect(h.signed).toHaveBeenCalledWith(h.documents[0]);
    expect(h.open).toHaveBeenCalledWith("https://example.test/signed-proof");
    expect(nodes(tree).some(node => node.type === "form")).toBe(false);
  });
  it("records each observed result and evaluator attestation for the selected staff member", async () => {
    let tree = render(true);
    change(field(tree, "Staff member"), "employee-a");
    tree = render(true); change(field(tree, "Practical skills checklist"), "checklist"); tree = render(true);
    expect(field(tree, "Cleans hands").props.defaultValue).toBe("");
    const reset = await submit(form(tree, "Save signed observation"), { observed_on: "2026-09-01", notes: "Second step needs another demonstration.", attested: "on", "step-0": "demonstrated", "step-1": "needs_practice" });
    expect(h.save).toHaveBeenCalledWith({ action: "observe", facilityId: "facility-a", employeeId: "employee-a", data: { template_id: "checklist", observed_on: "2026-09-01", notes: "Second step needs another demonstration.", attested: true, results: ["demonstrated", "needs_practice"] } });
    expect(reset).toHaveBeenCalledTimes(1);
  });
  it("requires an active chosen student and preserves form fields after server refusal", async () => {
    change(field(render(true), "Practical skills checklist"), "checklist");
    let tree = render(true);
    const button = nodes(tree).find(node => text(node) === "Save signed observation" && node.props.disabled !== undefined)!;
    expect(button.props.disabled).toBe(true);
    change(field(tree, "Staff member"), "employee-a"); tree = render(true);
    h.save.mockRejectedValueOnce(new Error("A separate evaluator is required"));
    const reset = await submit(form(tree, "Save signed observation"), { observed_on: "2026-09-01", notes: "Supervisor reviewed each step.", attested: "on", "step-0": "demonstrated", "step-1": "not_observed" });
    expect(reset).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalledWith({ title: "Training record saved" });
  });
  it("records a reasoned outside-training review without rewriting the evidence", async () => {
    h.data.external = [{ id: "outside-a", employee_id: "employee-a", employee_name: "Casey Learner", title: "CPR", provider: "Outside provider", completed_on: "2026-09-01", minutes: 60, status: "pending", evidence_document_id: "proof", review_note: null }];
    const tree = render(true);
    await submit(form(tree, "Record decision"), { status: "verified", review_note: "Certificate identity and attendance checked." });
    expect(h.save).toHaveBeenCalledWith({ action: "review_external", facilityId: "facility-a", employeeId: undefined, data: { id: "outside-a", status: "verified", review_note: "Certificate identity and attendance checked." } });
  });
  it("shows retrieval failure instead of editable stale records", () => {
    h.error = true;
    const tree = render(true);
    expect(text(tree)).toContain("Training records could not be loaded");
    expect(nodes(tree).some(node => node.type === "form")).toBe(false);
  });
});
