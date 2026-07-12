import { useMemo, useState } from "react";
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
import { formatDateForDisplay } from "@/lib/dateUtils";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
import { StatusBadge } from "@/components/ui/status-badge";
import { useListDocuments, useDocumentSignedUrl, type TrainingDocument } from "@/hooks/useDocuments";
import { useListEmployees, type Employee } from "@/hooks/useEmployees";
=======
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { useListDocuments, useDocumentSignedUrl, type TrainingDocument } from "@/hooks/useDocuments";
import { useListEmployees, type Employee } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
import { useListTrainingTypes, type TrainingType } from "@/hooks/useTrainingTypes";
import {
  useListTrainingRecords, useCreateTrainingRecord, useUpdateTrainingRecord,
  type TrainingRecord, type TrainingRecordInsert,
} from "@/hooks/useTrainingRecords";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
import { todayISO, addDaysISO, computeDueDate, computeStatus } from "@/lib/complianceDates";
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
import { ClipboardCheck, FileText, ExternalLink, Check, X, Inbox } from "lucide-react";

// The three document_type values that can carry an external training credential. 'roster',
// 'practicum_form' and 'competency_attachment' are evidence for other workflows entirely and
// never need this review step.
const EXTERNAL_CERT_DOC_TYPES: TrainingDocument["document_type"][] = ["certificate", "external_certificate", "transcript"];

const DOC_TYPE_LABELS: Record<string, string> = {
  certificate: "Certificate",
  external_certificate: "External Certificate",
  transcript: "Transcript",
};

type DecisionAction = "pending" | "approved" | "rejected";

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
// Matches employee_training_records_insert/_update RLS. Auditors are intentionally not routed to
// this operational queue; everyone who can reach it can review external training evidence.
const PENDING_APPROVAL_MANAGE_ROLES = ["org_admin", "facility_manager", "trainer"];

// Default age cutoff for the "New Submissions" tab -- a document uploaded this long ago without
// ever being linked to a training record is presumably already handled some other way (or simply
// never going to be), so it defaults to hidden rather than cluttering the awaiting-review list
// forever. This is a client-side default view only: the toggle can always reveal everything, and
// no document/record is ever deleted or dismissed by it.
const UNLINKED_DOCUMENT_AGE_CUTOFF_DAYS = 90;

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
// employee_training_records has no "unlinked" flag of its own -- a document counts as still
// awaiting triage as long as no record's external_certificate_document_id points at it. There's
// no server-side way to express that as a single filter on training_documents (the FK lives on
// the other table), so we fetch both sides and exclude client-side via a Set of linked ids.
function useLinkedDocumentIds(records: TrainingRecord[] | undefined): Set<string> {
  return useMemo(() => {
    const ids = new Set<string>();
    for (const r of records ?? []) {
      if (r.external_certificate_document_id) ids.add(r.external_certificate_document_id);
    }
    return ids;
  }, [records]);
}

// Employees can accumulate multiple employee_training_records rows for the same training type
// over successive renewal cycles (mirrors the convention documented in TrainingMatrix.tsx). When
// linking a newly reviewed certificate we want the *current* row for that employee/training
// type, not a stale historical one, so we pick using the same due_date -> completion_date ->
// created_at tiebreak used there.
function findCurrentRecord(records: TrainingRecord[], employeeId: string, trainingTypeId: string): TrainingRecord | undefined {
  const matches = records.filter(r => r.employee_id === employeeId && r.training_type_id === trainingTypeId);
  if (matches.length === 0) return undefined;
  return matches.reduce((current, candidate) => {
    const cDue = candidate.due_date ?? "", curDue = current.due_date ?? "";
    if (cDue !== curDue) return cDue > curDue ? candidate : current;
    const cComp = candidate.completion_date ?? "", curComp = current.completion_date ?? "";
    if (cComp !== curComp) return cComp > curComp ? candidate : current;
    return (candidate.created_at ?? "") > (current.created_at ?? "") ? candidate : current;
  });
}

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Mirrors the due_date formula in recalculate_all_compliance() (supabase/migrations/
// 20260704053624_compliance_rpcs_and_audit_trigger.sql): completion_date + renewal_interval_days,
// or no due date at all for one-time trainings.
function computeDueDate(completionDate: string | null, renewalIntervalDays: number | null | undefined): string | null {
  if (!completionDate || renewalIntervalDays == null) return null;
  return addDaysISO(completionDate, renewalIntervalDays);
}

// Mirrors the status formula in the same RPC. That RPC deliberately leaves 'pending_review' (and
// 'not_applicable') rows untouched, so approving a record here has to compute the real status
// ourselves -- recalculate_all_compliance() would never move it out of pending_review on its own.
function computeStatus(completionDate: string | null, dueDate: string | null, warningDays: number): string {
  if (!completionDate) return "missing";
  if (!dueDate) return "compliant";
  const today = todayISO();
  if (dueDate < today) return "expired";
  if (dueDate <= addDaysISO(today, warningDays)) return "due_soon";
  return "compliant";
}
=======
// recalculate_all_compliance() (supabase/migrations/20260704053624_compliance_rpcs_and_audit_trigger.sql)
// deliberately leaves 'pending_review' (and 'not_applicable') rows untouched, so approving a
// record here has to compute the real status ourselves via computeStatus() -- the nightly recalc
// would never move it out of pending_review on its own.
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx

interface DecisionInput {
  organizationId: string;
  facilityId: string;
  employeeId: string;
  trainingTypeId: string;
  documentId: string;
  completionDate: string;
  trainingType: TrainingType | undefined;
  comment: string;
  reviewerId: string;
}

// Builds the full row payload for whichever decision the reviewer makes. Used for both the
// create path (no employee_training_records row exists yet for this employee/training type) and
// the update path (one does) -- the same field values apply either way, only the create-vs-update
// choice differs at the call site.
function buildDecisionPayload(action: DecisionAction, input: DecisionInput): TrainingRecordInsert {
  const base = {
    organization_id: input.organizationId,
    facility_id: input.facilityId,
    employee_id: input.employeeId,
    training_type_id: input.trainingTypeId,
    external_certificate_document_id: input.documentId,
    document_required: true,
    completion_method: "manual_entry" as const,
    hours: input.trainingType?.required_hours ?? null,
  };

  if (action === "rejected") {
    // A rejected credential shouldn't leave behind a completion/due date that could read as
    // partial compliance elsewhere (e.g. TrainingMatrix), so we clear both and fall back to
    // 'missing' -- the employee still needs valid evidence for this training type.
    return {
      ...base,
      completion_date: null,
      due_date: null,
      status: "missing",
      approval_status: "rejected",
      review_comments: input.comment.trim(),
      verified_by_profile_id: input.reviewerId,
      verified_at: new Date().toISOString(),
    };
  }

  const dueDate = computeDueDate(input.completionDate || null, input.trainingType?.renewal_interval_days ?? null);

  if (action === "pending") {
    // Just links the document to a record for later review (e.g. the reviewer wants to pick the
    // training type now but decide approve/reject later) -- this is the row that then shows up
    // under the "Pending Review" tab.
    return {
      ...base,
      completion_date: input.completionDate || null,
      due_date: dueDate,
      status: "pending_review",
      approval_status: "pending",
    };
  }

  const status = computeStatus(input.completionDate || null, dueDate, input.trainingType?.warning_days_default ?? 90);
  return {
    ...base,
    completion_date: input.completionDate || null,
    due_date: dueDate,
    status,
    approval_status: "approved",
    review_comments: input.comment.trim() || null,
    verified_by_profile_id: input.reviewerId,
    verified_at: new Date().toISOString(),
  };
}

interface UnlinkedDocumentRowProps {
  doc: TrainingDocument;
  employees: Employee[];
  trainingTypes: TrainingType[];
  allRecords: TrainingRecord[];
  currentUserId: string;
  busy: boolean;
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
  canManage: boolean;
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
  onDecide: (existing: TrainingRecord | undefined, payload: TrainingRecordInsert) => Promise<void>;
  onView: (doc: TrainingDocument) => void;
  viewPending: boolean;
}

function UnlinkedDocumentRow({
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
  doc, employees, trainingTypes, allRecords, currentUserId, busy, onDecide, onView, viewPending,
=======
  doc, employees, trainingTypes, allRecords, currentUserId, busy, canManage, onDecide, onView, viewPending,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
}: UnlinkedDocumentRowProps) {
  const { toast } = useToast();
  const [manualEmployeeId, setManualEmployeeId] = useState("");
  const [trainingTypeId, setTrainingTypeId] = useState("");
  const [completionDate, setCompletionDate] = useState(doc.created_at.slice(0, 10));
  const [comment, setComment] = useState("");

  const employeeId = doc.employee_id ?? manualEmployeeId;
  const linkedEmployee = doc.employee_id ? employees.find(e => e.id === doc.employee_id) : undefined;
  // Documents uploaded without a specific employee (Documents.tsx allows "No specific employee")
  // can't be attributed to a training record without a human picking one -- narrow the choices to
  // the facility the document was uploaded under.
  const facilityEmployees = employees.filter(e => e.facility_id === doc.facility_id);

  const handleDecide = async (action: DecisionAction) => {
    if (!trainingTypeId) {
      toast({ title: "Select a training type first", variant: "destructive" });
      return;
    }
    if (!employeeId) {
      toast({ title: "Select an employee first", variant: "destructive" });
      return;
    }
    if (action === "rejected" && !comment.trim()) {
      toast({ title: "A reason is required to reject a certificate", variant: "destructive" });
      return;
    }
    const trainingType = trainingTypes.find(t => t.id === trainingTypeId);
    const payload = buildDecisionPayload(action, {
      organizationId: doc.organization_id,
      facilityId: doc.facility_id,
      employeeId,
      trainingTypeId,
      documentId: doc.id,
      completionDate,
      trainingType,
      comment,
      reviewerId: currentUserId,
    });
    const existing = findCurrentRecord(allRecords, employeeId, trainingTypeId);
    await onDecide(existing, payload);
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <FileText className="h-9 w-9 shrink-0 text-primary/70 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{doc.file_name}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}</Badge>
              <span className="text-xs text-muted-foreground">Uploaded {new Date(doc.created_at).toLocaleDateString()}</span>
              {linkedEmployee && (
                <span className="text-xs text-muted-foreground">• {linkedEmployee.first_name} {linkedEmployee.last_name}</span>
              )}
            </div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => onView(doc)} disabled={viewPending}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View Document
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {!doc.employee_id && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Employee *</label>
            <Select value={manualEmployeeId} onValueChange={setManualEmployeeId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {facilityEmployees.map(e => (
                  <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Training Type *</label>
          <Select value={trainingTypeId} onValueChange={setTrainingTypeId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select training type" /></SelectTrigger>
            <SelectContent>
              {trainingTypes.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Completion Date</label>
          <Input type="date" className="h-9" value={completionDate} onChange={e => setCompletionDate(e.target.value)} />
        </div>
      </div>

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Review Comments (required to reject)</label>
        <Textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Notes for the employee's file..." />
      </div>

      <div className="flex items-center gap-2 justify-end flex-wrap">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => handleDecide("pending")}>
          Save as Pending
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => handleDecide("rejected")}>
          <X className="h-3.5 w-3.5 mr-1.5" /> Reject
        </Button>
        <Button size="sm" disabled={busy} onClick={() => handleDecide("approved")}>
          <Check className="h-3.5 w-3.5 mr-1.5" /> Approve
        </Button>
      </div>
=======
      {canManage && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Review Comments (required to reject)</label>
          <Textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Notes for the employee's file..." />
        </div>
      )}

      {canManage && (
        <div className="flex items-center gap-2 justify-end flex-wrap">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => handleDecide("pending")}>
            Save as Pending
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => handleDecide("rejected")}>
            <X className="h-3.5 w-3.5 mr-1.5" /> Reject
          </Button>
          <Button size="sm" disabled={busy} onClick={() => handleDecide("approved")}>
            <Check className="h-3.5 w-3.5 mr-1.5" /> Approve
          </Button>
        </div>
      )}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
    </div>
  );
}

interface PendingRecordRowProps {
  record: TrainingRecord;
  employeeName: string;
  trainingType: TrainingType | undefined;
  doc: TrainingDocument | undefined;
  currentUserId: string;
  busy: boolean;
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
  canManage: boolean;
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
  onDecide: (payload: Partial<TrainingRecord> & { id: string }) => Promise<void>;
  onView: (doc: TrainingDocument) => void;
  viewPending: boolean;
}

function PendingRecordRow({
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
  record, employeeName, trainingType, doc, currentUserId, busy, onDecide, onView, viewPending,
=======
  record, employeeName, trainingType, doc, currentUserId, busy, canManage, onDecide, onView, viewPending,
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
}: PendingRecordRowProps) {
  const { toast } = useToast();
  const [comment, setComment] = useState("");

  const handleApprove = async () => {
    const dueDate = computeDueDate(record.completion_date, trainingType?.renewal_interval_days ?? null);
    const status = computeStatus(record.completion_date, dueDate, trainingType?.warning_days_default ?? 90);
    await onDecide({
      id: record.id,
      approval_status: "approved",
      status,
      due_date: dueDate,
      review_comments: comment.trim() || null,
      verified_by_profile_id: currentUserId,
      verified_at: new Date().toISOString(),
    });
  };

  const handleReject = async () => {
    if (!comment.trim()) {
      toast({ title: "A reason is required to reject a certificate", variant: "destructive" });
      return;
    }
    await onDecide({
      id: record.id,
      approval_status: "rejected",
      status: "missing",
      due_date: null,
      completion_date: null,
      review_comments: comment.trim(),
      verified_by_profile_id: currentUserId,
      verified_at: new Date().toISOString(),
    });
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-medium text-sm">{trainingType?.name ?? "Unknown Training Type"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{employeeName}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusBadge status={record.status} />
            {record.completion_date && (
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
              <span className="text-xs text-muted-foreground">Completed {new Date(record.completion_date).toLocaleDateString()}</span>
=======
              <span className="text-xs text-muted-foreground">Completed {formatDateForDisplay(record.completion_date)}</span>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
            )}
          </div>
        </div>
        {doc && (
          <Button size="sm" variant="outline" onClick={() => onView(doc)} disabled={viewPending}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View Document
          </Button>
        )}
      </div>

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Review Comments (required to reject)</label>
        <Textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Notes for the employee's file..." />
      </div>

      <div className="flex items-center gap-2 justify-end">
        <Button variant="destructive" size="sm" disabled={busy} onClick={handleReject}>
          <X className="h-3.5 w-3.5 mr-1.5" /> Reject
        </Button>
        <Button size="sm" disabled={busy} onClick={handleApprove}>
          <Check className="h-3.5 w-3.5 mr-1.5" /> Approve
        </Button>
      </div>
=======
      {canManage && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Review Comments (required to reject)</label>
          <Textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Notes for the employee's file..." />
        </div>
      )}

      {canManage && (
        <div className="flex items-center gap-2 justify-end">
          <Button variant="destructive" size="sm" disabled={busy} onClick={handleReject}>
            <X className="h-3.5 w-3.5 mr-1.5" /> Reject
          </Button>
          <Button size="sm" disabled={busy} onClick={handleApprove}>
            <Check className="h-3.5 w-3.5 mr-1.5" /> Approve
          </Button>
        </div>
      )}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
    </div>
  );
}

export default function PendingApprovals() {
  const { user } = useAuth();
  const { toast } = useToast();
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx

  const { data: documents, isLoading: documentsLoading } = useListDocuments({ documentTypes: EXTERNAL_CERT_DOC_TYPES });
  const { data: employees } = useListEmployees({});
=======
  const canManage = PENDING_APPROVAL_MANAGE_ROLES.includes(user?.role ?? "");

  const [facilityId, setFacilityId] = useState<string>("all");
  const [hideOldDocuments, setHideOldDocuments] = useState(true);

  const { data: documents, isLoading: documentsLoading } = useListDocuments({ documentTypes: EXTERNAL_CERT_DOC_TYPES });
  const { data: employees } = useListEmployees({});
  const { data: facilities } = useListFacilities();
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
  const { data: allRecords, isLoading: recordsLoading } = useListTrainingRecords({});
  const { data: pendingRecords, isLoading: pendingLoading } = useListTrainingRecords({ approvalStatus: "pending" });

  const createRecord = useCreateTrainingRecord();
  const updateRecord = useUpdateTrainingRecord();
  const getSignedUrl = useDocumentSignedUrl();

  const linkedDocumentIds = useLinkedDocumentIds(allRecords);

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
  const unlinkedDocuments = useMemo(
=======
  // Unfiltered by facility/age -- used only to tell "genuinely nothing to review" apart from
  // "the view filters are just hiding everything" in the empty state below.
  const allUnlinkedRegardlessOfViewFilters = useMemo(
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
    () => (documents ?? []).filter(d => !linkedDocumentIds.has(d.id)),
    [documents, linkedDocumentIds],
  );

<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
  // "New Submissions" awaiting-review list -- narrowed by an optional facility filter and, by
  // default, an age cutoff (see UNLINKED_DOCUMENT_AGE_CUTOFF_DAYS above). Neither filter touches
  // the underlying documents/records; a document that ages out of view here still exists and
  // still shows up the moment the age toggle is switched off or the facility filter is cleared.
  const unlinkedDocuments = useMemo(() => {
    const cutoffMs = Date.now() - UNLINKED_DOCUMENT_AGE_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
    return (documents ?? []).filter(d => {
      if (linkedDocumentIds.has(d.id)) return false;
      if (facilityId !== "all" && d.facility_id !== facilityId) return false;
      if (hideOldDocuments && new Date(d.created_at).getTime() < cutoffMs) return false;
      return true;
    });
  }, [documents, linkedDocumentIds, facilityId, hideOldDocuments]);

>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
  const employeeById = useMemo(() => new Map((employees ?? []).map(e => [e.id, e])), [employees]);
  const trainingTypeById = useMemo(() => new Map((trainingTypes ?? []).map(t => [t.id, t])), [trainingTypes]);
  const documentById = useMemo(() => new Map((documents ?? []).map(d => [d.id, d])), [documents]);

  const busy = createRecord.isPending || updateRecord.isPending;

  const handleView = async (doc: TrainingDocument) => {
    try {
      const url = await getSignedUrl.mutateAsync(doc);
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
      window.open(url, "_blank");
=======
      window.open(url, "_blank", "noopener,noreferrer");
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
    } catch (err) {
      toast({ title: "Could not open document", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const handleDecideUnlinked = async (existing: TrainingRecord | undefined, payload: TrainingRecordInsert) => {
    try {
      if (existing) {
        await updateRecord.mutateAsync({ id: existing.id, ...payload });
      } else {
        await createRecord.mutateAsync(payload);
      }
      toast({
        title: payload.approval_status === "approved" ? "Certificate approved"
          : payload.approval_status === "rejected" ? "Certificate rejected"
          : "Saved as pending",
      });
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const handleDecideLinked = async (payload: Partial<TrainingRecord> & { id: string }) => {
    try {
      await updateRecord.mutateAsync(payload);
      toast({ title: payload.approval_status === "approved" ? "Certificate approved" : "Certificate rejected" });
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const unlinkedLoading = documentsLoading || recordsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pending Approvals</h1>
        <p className="text-muted-foreground">Review externally uploaded certificates and confirm compliance credit.</p>
      </div>

      <Tabs defaultValue="unlinked">
        <TabsList>
          <TabsTrigger value="unlinked">
            New Submissions{documents !== undefined && ` (${unlinkedDocuments.length})`}
          </TabsTrigger>
          <TabsTrigger value="linked">
            Pending Review{pendingRecords !== undefined && ` (${pendingRecords.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unlinked">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                External Certificates Awaiting Review
              </CardTitle>
            </CardHeader>
            <CardContent>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
              <div className="flex flex-wrap items-center gap-4 pb-4 mb-4 border-b">
                <Select value={facilityId} onValueChange={setFacilityId}>
                  <SelectTrigger className="w-56 h-9"><SelectValue placeholder="All Facilities" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Facilities</SelectItem>
                    {facilities?.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                  <Checkbox
                    checked={hideOldDocuments}
                    onCheckedChange={v => setHideOldDocuments(v === true)}
                  />
                  Hide documents older than {UNLINKED_DOCUMENT_AGE_CUTOFF_DAYS} days
                </label>
              </div>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
              {unlinkedLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}
                </div>
              ) : unlinkedDocuments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Inbox className="h-12 w-12 mx-auto mb-4 opacity-40" />
                  <p className="font-medium">No pending approvals</p>
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
                  <p className="text-sm mt-1">Newly uploaded external certificates will show up here for review.</p>
=======
                  <p className="text-sm mt-1">
                    {allUnlinkedRegardlessOfViewFilters.length > 0
                      ? "No submissions match the current facility filter or age cutoff. Adjust the filters above to see more."
                      : "Newly uploaded external certificates will show up here for review."}
                  </p>
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
                </div>
              ) : (
                <div className="space-y-3">
                  {unlinkedDocuments.map(doc => (
                    <UnlinkedDocumentRow
                      key={doc.id}
                      doc={doc}
                      employees={employees ?? []}
                      trainingTypes={trainingTypes ?? []}
                      allRecords={allRecords ?? []}
                      currentUserId={user?.id ?? ""}
                      busy={busy}
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
                      canManage={canManage}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
                      onDecide={handleDecideUnlinked}
                      onView={handleView}
                      viewPending={getSignedUrl.isPending}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="linked">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Linked Records Awaiting Decision
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />)}
                </div>
              ) : !pendingRecords?.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Inbox className="h-12 w-12 mx-auto mb-4 opacity-40" />
                  <p className="font-medium">No pending approvals</p>
                  <p className="text-sm mt-1">Records linked to a certificate but not yet approved or rejected will show up here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingRecords.map(record => {
                    const employee = employeeById.get(record.employee_id);
                    const doc = record.external_certificate_document_id
                      ? documentById.get(record.external_certificate_document_id)
                      : undefined;
                    return (
                      <PendingRecordRow
                        key={record.id}
                        record={record}
                        employeeName={employee ? `${employee.first_name} ${employee.last_name}` : "Unknown Employee"}
                        trainingType={trainingTypeById.get(record.training_type_id)}
                        doc={doc}
                        currentUserId={user?.id ?? ""}
                        busy={busy}
<<<<<<< HEAD:artifacts/pa-medtrack/src/pages/app/PendingApprovals.tsx
=======
                        canManage={canManage}
>>>>>>> origin/main:artifacts/caremetric-train/src/pages/app/PendingApprovals.tsx
                        onDecide={handleDecideLinked}
                        onView={handleView}
                        viewPending={getSignedUrl.isPending}
                      />
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
