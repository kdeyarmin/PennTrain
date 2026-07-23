import { describe, expect, it } from "vitest";
import {
  assessmentFormDocumentLabel,
  deriveStateFormWorkflow,
  listUpcomingRenewals,
  prefillDocumentLabel,
  sortOpenItemsByUrgency,
  type WorkflowAssessmentForm,
  type WorkflowDocument,
  type WorkflowItem,
} from "./stateFormWorkflow";

const TODAY = "2026-07-12";

function item(overrides: Partial<WorkflowItem> = {}): WorkflowItem {
  return {
    id: "item-1",
    item_type: "annual_reassessment",
    status: "due_soon",
    due_date: "2026-08-01",
    completed_date: null,
    ...overrides,
  };
}

function form(overrides: Partial<WorkflowAssessmentForm> = {}): WorkflowAssessmentForm {
  return { id: "form-1", compliance_item_id: "item-1", status: "draft", version_number: 1, ...overrides };
}

function doc(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id: "doc-1",
    compliance_item_id: "item-1",
    is_state_form: false,
    document_label: null,
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("deriveStateFormWorkflow", () => {
  it("starts a digital item at not_started with start_prep primary and a 4-step rail", () => {
    const state = deriveStateFormWorkflow(item(), [], [], "PCH");
    expect(state.step).toBe("not_started");
    expect(state.isDigitalEligible).toBe(true);
    expect(state.primaryAction?.key).toBe("start_prep");
    expect(state.steps).toHaveLength(4);
    expect(state.steps[0].state).toBe("current");
    expect(state.steps.slice(1).every((s) => s.state === "upcoming")).toBe(true);
    // The escape hatch (upload the signed DHS form directly) is always offered.
    expect(state.secondaryActions.map((a) => a.key)).toContain("upload_signed_form");
    expect(state.secondaryActions.find((a) => a.key === "download_official_blank")?.url).toContain("pa.gov");
  });

  it("prefers the highest-version linked draft for continue_draft", () => {
    const forms = [
      form({ id: "form-old", status: "finalized", version_number: 1 }),
      form({ id: "form-new", status: "draft", version_number: 2 }),
    ];
    const state = deriveStateFormWorkflow(item(), forms, [], "PCH");
    expect(state.step).toBe("draft_in_progress");
    expect(state.primaryAction).toMatchObject({ key: "continue_draft", formId: "form-new" });
    expect(state.linkedDraftFormId).toBe("form-new");
    expect(state.linkedFinalizedFormId).toBe("form-old");
  });

  it("offers generate_pdf when a linked form is finalized but its reference PDF is missing", () => {
    const state = deriveStateFormWorkflow(item(), [form({ status: "finalized" })], [], "ALR");
    expect(state.step).toBe("finalized_pdf_missing");
    expect(state.primaryAction).toMatchObject({ key: "generate_pdf", formId: "form-1" });
    expect(state.steps[0].state).toBe("done");
    expect(state.steps[1].state).toBe("current");
  });

  it("moves to awaiting_signed_upload once the reference PDF exists, and never treats it as completion documentation", () => {
    const referencePdf = doc({ id: "ref-pdf", document_label: assessmentFormDocumentLabel("form-1") });
    const state = deriveStateFormWorkflow(item(), [form({ status: "finalized" })], [referencePdf], "PCH");
    expect(state.step).toBe("awaiting_signed_upload");
    expect(state.primaryAction?.key).toBe("upload_signed_form");
    expect(state.secondaryActions.find((a) => a.key === "download_reference_pdf")?.documentId).toBe("ref-pdf");
    // The CareMetric-generated PDF is is_state_form=false -- it must never surface as mark_compliant.
    expect(state.primaryAction?.key).not.toBe("mark_compliant");
    expect(state.linkedStateFormDocumentId).toBeNull();
  });

  it("goes ready_to_complete with the newest linked state-form document", () => {
    const docs = [
      doc({ id: "signed-old", is_state_form: true, created_at: "2026-07-01T00:00:00Z" }),
      doc({ id: "signed-new", is_state_form: true, created_at: "2026-07-05T00:00:00Z" }),
    ];
    const state = deriveStateFormWorkflow(item(), [], docs, "PCH");
    expect(state.step).toBe("ready_to_complete");
    expect(state.primaryAction).toMatchObject({ key: "mark_compliant", documentId: "signed-new" });
    expect(state.steps.at(-1)?.state).toBe("current");
  });

  it("marks a compliant item complete with every step done and no primary action", () => {
    const signed = doc({ is_state_form: true });
    const state = deriveStateFormWorkflow(item({ status: "compliant", completed_date: "2026-07-02" }), [], [signed], "PCH");
    expect(state.step).toBe("complete");
    expect(state.primaryAction).toBeNull();
    expect(state.steps.every((s) => s.state === "done")).toBe(true);
    expect(state.secondaryActions).toEqual([
      { key: "view_signed_form", label: "View signed form", documentId: "doc-1" },
    ]);
  });

  it("treats not_applicable as complete with no actions", () => {
    const state = deriveStateFormWorkflow(item({ status: "not_applicable" }), [], [], "PCH");
    expect(state.step).toBe("complete");
    expect(state.primaryAction).toBeNull();
    expect(state.secondaryActions).toEqual([]);
  });

  it("ignores forms and documents linked to another item or to nothing", () => {
    const forms = [
      form({ id: "other-form", compliance_item_id: "item-other" }),
      form({ id: "legacy-form", compliance_item_id: null }),
    ];
    const docs = [doc({ id: "other-doc", compliance_item_id: "item-other", is_state_form: true })];
    const state = deriveStateFormWorkflow(item(), forms, docs, "PCH");
    expect(state.step).toBe("not_started");
    expect(state.linkedDraftFormId).toBeNull();
    expect(state.linkedStateFormDocumentId).toBeNull();
  });

  it("gives upload-only items a 3-step rail with generate_prefilled_start first", () => {
    const state = deriveStateFormWorkflow(item({ item_type: "preadmission_screening" }), [], [], "PCH");
    expect(state.isDigitalEligible).toBe(false);
    expect(state.steps).toHaveLength(3);
    expect(state.step).toBe("not_started");
    expect(state.primaryAction?.key).toBe("generate_prefilled_start");
  });

  it("advances an upload-only item to awaiting_signed_upload once its prefill document exists", () => {
    const prefill = doc({ id: "prefill-doc", document_label: prefillDocumentLabel("item-1") });
    const state = deriveStateFormWorkflow(item({ item_type: "medical_evaluation" }), [], [prefill], "ALR");
    expect(state.step).toBe("awaiting_signed_upload");
    expect(state.primaryAction?.key).toBe("upload_signed_form");
    expect(state.secondaryActions.find((a) => a.key === "download_prefilled_start")?.documentId).toBe("prefill-doc");
  });
});

describe("sortOpenItemsByUrgency", () => {
  it("orders expired most-overdue-first, then missing, then due_soon nearest-first", () => {
    const items = [
      item({ id: "due-25", status: "due_soon", due_date: "2026-08-06" }),
      item({ id: "expired-2", status: "expired", due_date: "2026-07-10" }),
      item({ id: "missing", status: "missing", due_date: null }),
      item({ id: "due-3", status: "due_soon", due_date: "2026-07-15" }),
      item({ id: "expired-40", status: "expired", due_date: "2026-06-02" }),
    ];
    expect(sortOpenItemsByUrgency(items, TODAY).map((i) => i.id)).toEqual([
      "expired-40", "expired-2", "missing", "due-3", "due-25",
    ]);
  });

  it("keeps incoming order for ties (stable sort)", () => {
    const items = [
      item({ id: "a", status: "missing", due_date: null }),
      item({ id: "b", status: "missing", due_date: null }),
    ];
    expect(sortOpenItemsByUrgency(items, TODAY).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("listUpcomingRenewals", () => {
  it("includes only open annual reassessments and medical evaluations inside the window", () => {
    const items = [
      item({ id: "annual-59", item_type: "annual_reassessment", due_date: "2026-09-09" }),
      item({ id: "dme-10", item_type: "medical_evaluation", due_date: "2026-07-22" }),
      item({ id: "support-10", item_type: "support_plan_30day", due_date: "2026-07-22" }),
      item({ id: "annual-61", item_type: "annual_reassessment", due_date: "2026-09-11" }),
      item({ id: "annual-done", item_type: "annual_reassessment", status: "compliant", completed_date: "2026-07-01", due_date: "2026-07-20" }),
      item({ id: "annual-overdue", item_type: "annual_reassessment", status: "expired", due_date: "2026-07-01" }),
    ];
    expect(listUpcomingRenewals(items, TODAY, 60).map((i) => i.id)).toEqual(["dme-10", "annual-59"]);
  });
});

describe("document label helpers", () => {
  it("round-trips the exact conventions shared with the editor and edge functions", () => {
    // These literals are load-bearing: generate-resident-assessment-pdf and
    // generate-state-form-prefill write the same strings (hand-synced, Deno side).
    expect(assessmentFormDocumentLabel("abc")).toBe("resident_assessment_form:abc");
    expect(prefillDocumentLabel("xyz")).toBe("state_form_prefill:xyz");
  });
});
