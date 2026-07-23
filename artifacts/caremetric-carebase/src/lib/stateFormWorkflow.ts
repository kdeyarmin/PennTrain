import { getRequiredStateFormInfo } from "./residentCompliance";
import { isDigitalFormEligible } from "./residentAssessmentFormSchema";

// Derives the guided "state forms" pipeline for one resident_compliance_items row from data that
// already exists (linked resident_assessment_forms + resident_documents) -- no new status columns,
// so this can never disagree with the server-side compliance state. The completion gate is
// untouched: only complete_resident_compliance_item() with an is_state_form=true document makes an
// item compliant; everything here just sequences the UI toward that call.
//
// Shared by StateFormWorkflowStepper.tsx (rendered on ResidentDetail and the State Forms Center)
// so the two surfaces can't drift.

// Narrow structural inputs instead of the full generated Row types: the Center page's org-wide
// items query selects only a subset of columns, and the derivation must accept both that shape
// and ResidentDetail's full rows.
export interface WorkflowItem {
  id: string;
  item_type: string;
  status: string;
  due_date: string | null;
  completed_date: string | null;
}

export interface WorkflowAssessmentForm {
  id: string;
  compliance_item_id: string | null;
  status: string; // 'draft' | 'finalized'
  version_number: number;
}

export interface WorkflowDocument {
  id: string;
  compliance_item_id: string | null;
  is_state_form: boolean;
  document_label: string | null;
  created_at: string;
}

// Single source of truth for the document_label conventions. The assessment-PDF label was
// previously an inline string in ResidentAssessmentFormEditor.tsx and (necessarily, Deno can't
// import frontend code) in generate-resident-assessment-pdf/index.ts -- the edge functions'
// copies must stay in sync with these by hand.
export function assessmentFormDocumentLabel(formId: string): string {
  return `resident_assessment_form:${formId}`;
}
export function prefillDocumentLabel(itemId: string): string {
  return `state_form_prefill:${itemId}`;
}

export type WorkflowStepKey =
  | "not_started"
  | "draft_in_progress"
  | "finalized_pdf_missing"
  | "awaiting_signed_upload"
  | "ready_to_complete"
  | "complete";

export type WorkflowActionKey =
  | "start_prep"              // RPC start_resident_assessment_form (clone-forward for renewals)
  | "continue_draft"          // navigate to the editor
  | "generate_pdf"            // retry generate-resident-assessment-pdf for a finalized form
  | "download_reference_pdf"  // signed-url the CareMetric-rendered filled DHS PDF
  | "generate_prefilled_start"// upload-only items: call generate-state-form-prefill
  | "download_prefilled_start"// upload-only items: prefill doc already exists
  | "download_official_blank" // official pa.gov PDF from getRequiredStateFormInfo
  | "upload_signed_form"      // opens the upload + complete dialog (the only path to compliant)
  | "mark_compliant"          // signed state form already linked; call the completion RPC
  | "view_signed_form";       // item already compliant; open the attached documentation

export interface WorkflowAction {
  key: WorkflowActionKey;
  label: string;
  formId?: string;
  documentId?: string;
  url?: string;
}

export interface WorkflowStep {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming";
}

export interface StateFormWorkflowState {
  step: WorkflowStepKey;
  steps: WorkflowStep[];
  primaryAction: WorkflowAction | null;
  secondaryActions: WorkflowAction[];
  isDigitalEligible: boolean;
  linkedDraftFormId: string | null;
  linkedFinalizedFormId: string | null;
  linkedStateFormDocumentId: string | null;
}

function newestByCreatedAt<T extends { created_at: string }>(docs: T[]): T | undefined {
  return [...docs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

function highestVersion<T extends { version_number: number }>(forms: T[]): T | undefined {
  return [...forms].sort((a, b) => b.version_number - a.version_number)[0];
}

function buildSteps(keys: { key: string; label: string }[], currentIndex: number): WorkflowStep[] {
  // currentIndex past the end marks every step done (the "complete" state).
  return keys.map((k, i) => ({
    ...k,
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming",
  }));
}

export function deriveStateFormWorkflow(
  item: WorkflowItem,
  forms: WorkflowAssessmentForm[],
  documents: WorkflowDocument[],
  facilityType: string | undefined,
): StateFormWorkflowState {
  const digital = isDigitalFormEligible(item.item_type);
  const officialForm = getRequiredStateFormInfo(item.item_type, facilityType);

  // Only artifacts explicitly linked to THIS item count -- legacy assessment forms saved before
  // compliance_item_id existed (or started against a different cycle's item) must not advance a
  // renewal's pipeline, since each cycle needs its own current-year documentation.
  const linkedForms = forms.filter((f) => f.compliance_item_id === item.id);
  const linkedDocs = documents.filter((d) => d.compliance_item_id === item.id);

  const draftForm = highestVersion(linkedForms.filter((f) => f.status === "draft"));
  const finalizedForm = highestVersion(linkedForms.filter((f) => f.status === "finalized"));
  const stateFormDoc = newestByCreatedAt(linkedDocs.filter((d) => d.is_state_form));
  // The generated reference PDF and the prefill PDF carry an id-bearing label, so matching by
  // label across all of the resident's documents is exact even if a row's compliance_item_id is
  // ever null (labels embed the form/item id being asked about).
  const referencePdfDoc = finalizedForm
    ? newestByCreatedAt(documents.filter((d) => d.document_label === assessmentFormDocumentLabel(finalizedForm.id)))
    : undefined;
  const prefillDoc = newestByCreatedAt(documents.filter((d) => d.document_label === prefillDocumentLabel(item.id)));

  const digitalFormName = facilityType === "PCH" ? "RASP" : facilityType === "ALR" ? "ASP" : "digital form";
  const stepDefs = digital
    ? [
        { key: "prepare", label: `Prepare ${digitalFormName}` },
        { key: "finalize_print", label: "Finalize & print" },
        { key: "upload_signed", label: "Upload signed form" },
        { key: "compliant", label: "Compliant" },
      ]
    : [
        { key: "get_form", label: "Get official form" },
        { key: "upload_signed", label: "Upload signed form" },
        { key: "compliant", label: "Compliant" },
      ];
  const uploadSignedIndex = stepDefs.length - 2;
  const compliantIndex = stepDefs.length - 1;

  const downloadOfficialBlank: WorkflowAction = {
    key: "download_official_blank",
    label: `Download official ${officialForm.label}`,
    url: officialForm.url,
  };
  const uploadSigned: WorkflowAction = { key: "upload_signed_form", label: "Upload signed form" };

  const base = {
    isDigitalEligible: digital,
    linkedDraftFormId: draftForm?.id ?? null,
    linkedFinalizedFormId: finalizedForm?.id ?? null,
    linkedStateFormDocumentId: stateFormDoc?.id ?? null,
  };

  if (item.status === "compliant" || item.status === "not_applicable") {
    return {
      ...base,
      step: "complete",
      steps: buildSteps(stepDefs, stepDefs.length),
      primaryAction: null,
      secondaryActions: stateFormDoc
        ? [{ key: "view_signed_form", label: "View signed form", documentId: stateFormDoc.id }]
        : [],
    };
  }

  // A signed state form is already attached but the item is still open -- e.g. the upload
  // succeeded and the completion RPC failed, or the form was uploaded from the generic Documents
  // card. One click left; never make the user re-upload.
  if (stateFormDoc) {
    return {
      ...base,
      step: "ready_to_complete",
      steps: buildSteps(stepDefs, compliantIndex),
      primaryAction: { key: "mark_compliant", label: "Mark compliant", documentId: stateFormDoc.id },
      secondaryActions: [{ key: "view_signed_form", label: "View signed form", documentId: stateFormDoc.id }],
    };
  }

  if (digital) {
    if (draftForm) {
      return {
        ...base,
        step: "draft_in_progress",
        steps: buildSteps(stepDefs, 0),
        primaryAction: { key: "continue_draft", label: "Continue draft", formId: draftForm.id },
        secondaryActions: [uploadSigned, downloadOfficialBlank],
      };
    }
    if (finalizedForm && !referencePdfDoc) {
      // finalize_resident_assessment_form() succeeded but the PDF edge function failed -- the
      // form is locked either way, so the missing artifact is the only thing left to retry.
      return {
        ...base,
        step: "finalized_pdf_missing",
        steps: buildSteps(stepDefs, 1),
        primaryAction: { key: "generate_pdf", label: "Generate filled DHS PDF", formId: finalizedForm.id },
        secondaryActions: [uploadSigned, downloadOfficialBlank],
      };
    }
    if (finalizedForm && referencePdfDoc) {
      return {
        ...base,
        step: "awaiting_signed_upload",
        steps: buildSteps(stepDefs, uploadSignedIndex),
        primaryAction: uploadSigned,
        secondaryActions: [
          { key: "download_reference_pdf", label: "Download filled DHS PDF", documentId: referencePdfDoc.id },
          downloadOfficialBlank,
        ],
      };
    }
    return {
      ...base,
      step: "not_started",
      steps: buildSteps(stepDefs, 0),
      primaryAction: { key: "start_prep", label: `Start ${digitalFormName} prep` },
      secondaryActions: [uploadSigned, downloadOfficialBlank],
    };
  }

  // Upload-only items (preadmission screening, DME): CareMetric can hand the user the official
  // PDF with demographics prefilled, but never drafts their content -- see isDigitalFormEligible.
  if (prefillDoc) {
    return {
      ...base,
      step: "awaiting_signed_upload",
      steps: buildSteps(stepDefs, uploadSignedIndex),
      primaryAction: uploadSigned,
      secondaryActions: [
        { key: "download_prefilled_start", label: "Download prefilled form", documentId: prefillDoc.id },
        downloadOfficialBlank,
      ],
    };
  }
  return {
    ...base,
    step: "not_started",
    steps: buildSteps(stepDefs, 0),
    primaryAction: { key: "generate_prefilled_start", label: "Get prefilled official form" },
    secondaryActions: [downloadOfficialBlank, uploadSigned],
  };
}

// ---------------------------------------------------------------------------
// Queue ordering for the State Forms Center

function daysUntil(date: string, today: string): number {
  // Bare "YYYY-MM-DD" date columns; parse both at UTC midnight so the difference is a whole-day
  // count regardless of the viewer's timezone (same approach as residentComplianceAnalytics.ts).
  return Math.ceil((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

// Group ordering: expired (most overdue first) < missing < due_soon (nearest due first) <
// everything else. Within a group, earlier due dates first; null due dates last.
const URGENCY_GROUP: Record<string, number> = { expired: 0, missing: 1, due_soon: 2 };

export function sortOpenItemsByUrgency<T extends WorkflowItem>(items: T[], _today: string): T[] {
  return [...items].sort((a, b) => {
    const groupDiff = (URGENCY_GROUP[a.status] ?? 3) - (URGENCY_GROUP[b.status] ?? 3);
    if (groupDiff !== 0) return groupDiff;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0; // Array.prototype.sort is stable, so equal keys keep their incoming order.
  });
}

// The two recurring yearly requirements (§2600.225 annual reassessment, §2600.141 annual medical
// evaluation) due within the window -- the "plan ahead" list, distinct from the needs-action
// queue. Already-overdue rows are excluded here because they're in that queue instead.
const RENEWAL_ITEM_TYPES = new Set(["annual_reassessment", "medical_evaluation"]);

export function listUpcomingRenewals<T extends WorkflowItem>(items: T[], today: string, windowDays: number): T[] {
  return items
    .filter((item) => {
      if (!RENEWAL_ITEM_TYPES.has(item.item_type)) return false;
      if (item.completed_date || item.status === "compliant" || item.status === "not_applicable") return false;
      if (!item.due_date) return false;
      const days = daysUntil(item.due_date, today);
      return days >= 0 && days <= windowDays;
    })
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
}
