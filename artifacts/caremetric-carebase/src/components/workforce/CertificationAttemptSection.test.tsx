import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, record: vi.fn(), submit: vi.fn(), approve: vi.fn(), digest: vi.fn(), toast: vi.fn(), recording: false, submitting: false }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }]; },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/certificationAttempt", async original => ({ ...await original<typeof import("@/lib/certificationAttempt")>(), signatureDigest: h.digest }));
vi.mock("@/hooks/useCertificationAttempts", () => ({
  useAvailableCertificationVersions: () => ({ data: [] }), useEmployeeCertificationAttempts: () => ({ data: [{ id: "attempt", certification_version_id: "version", status: "in_progress", observed_at: "2026-09-26T12:00:00Z" }] }),
  useCertificationChecklist: () => ({ data: [{ item: { id: "item", item_key: "task", prompt: "Observed task", evidence_required: false, signature_required: false }, recorded: { checklist_item_id: "item", result: "met", evidence: {}, signed_at: null } }] }),
  useStartCertificationAttempt: () => ({}), useRecordCertificationAttemptItem: () => ({ mutateAsync: h.record, isPending: h.recording }),
  useSubmitCertificationAttempt: () => ({ mutateAsync: h.submit, isPending: h.submitting }), useApproveCertificationAttempt: () => ({ mutateAsync: h.approve }),
}));
import CertificationAttemptSection from "./CertificationAttemptSection";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function render() { h.cursor = 0; return CertificationAttemptSection({ employeeId: "employee", employeeName: "Learner" }); }
function button(tree: ReactNode, label: string) { return nodes(tree).find(node => node.props.onClick && text(node) === label)!; }
function signedForm() { const tree = render(); nodes(tree).find(node => node.props.id === "decision-reason")!.props.onChange({ target: { value: "Observation reviewed" } }); nodes(tree).find(node => node.props.id === "decision-signature")!.props.onChange({ target: { value: "Assessor Name" } }); return render(); }
beforeEach(() => { h.state = []; h.cursor = 0; h.recording = false; h.submitting = false; vi.clearAllMocks(); h.digest.mockResolvedValue("signed-hash"); h.record.mockResolvedValue({}); h.approve.mockResolvedValue({}); });
describe("certification evidence and decision coordination", () => {
  it("prevents submission and decisions while a previously completed checklist item is being changed", () => {
    signedForm(); h.recording = true; const tree = render();
    for (const label of ["Submit observation", "Pass", "Fail"]) { expect(button(tree, label).props.disabled).toBe(true); button(tree, label).props.onClick(); }
    expect(h.submit).not.toHaveBeenCalled(); expect(h.digest).not.toHaveBeenCalled(); expect(h.approve).not.toHaveBeenCalled();
  });
  it("locks checklist edits and decisions while observation submission is pending", () => {
    signedForm(); h.submitting = true; const tree = render();
    for (const label of ["met", "not met", "N/A", "Pass", "Fail"]) { expect(button(tree, label).props.disabled).toBe(true); button(tree, label).props.onClick(); }
    expect(h.record).not.toHaveBeenCalled(); expect(h.digest).not.toHaveBeenCalled();
  });
  it("locks from signature hashing through decision completion and preserves the signed payload", async () => {
    let finish!: (value: string) => void; h.digest.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    button(signedForm(), "Pass").props.onClick(); const pending = render();
    expect(button(pending, "Fail").props.disabled).toBe(true); expect(button(pending, "not met").props.disabled).toBe(true);
    button(pending, "Fail").props.onClick(); button(pending, "not met").props.onClick();
    expect(h.digest).toHaveBeenCalledTimes(1); expect(h.record).not.toHaveBeenCalled(); expect(h.approve).not.toHaveBeenCalled();
    finish("signed-hash"); await vi.waitFor(() => expect(h.approve).toHaveBeenCalledExactlyOnceWith({ attemptId: "attempt", decision: "passed", reason: "Observation reviewed", signatureSha256: "signed-hash" }));
  });
  it("retains the decision form and allows retry after signature failure", async () => {
    h.digest.mockRejectedValueOnce(new Error("Signature failed")); button(signedForm(), "Pass").props.onClick();
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not record the decision" })));
    const retry = render(); expect(button(retry, "Pass").props.disabled).toBe(false); expect(h.approve).not.toHaveBeenCalled();
    expect(nodes(retry).find(node => node.props.id === "decision-reason")!.props.value).toBe("Observation reviewed");
  });
});
