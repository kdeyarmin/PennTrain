import { useState, useMemo, useRef, useEffect } from "react";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useUrlState } from "@/hooks/useUrlState";
import { useListEmployees } from "@/hooks/useEmployees";
import type { Employee } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListTrainingTypes, type TrainingType } from "@/hooks/useTrainingTypes";
import {
  useListTrainingRecords, useCreateTrainingRecord, useUpdateTrainingRecord,
  type TrainingRecord, type TrainingRecordInsert,
} from "@/hooks/useTrainingRecords";
import { useUploadDocument } from "@/hooks/useDocuments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ChevronUp, ChevronDown, ChevronsUpDown, Download, Users, ExternalLink, Pencil, Search, Upload, X,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth, type Role } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { todayISO, addDaysISO, computeDueDate, computeStatus } from "@/lib/complianceDates";
import { QueryError, QueryLoading } from "@/components/QueryState";

// Matches employee_training_records_insert/_update RLS.
const TRAINING_RECORD_MANAGE_ROLES: Role[] = ["org_admin", "facility_manager", "trainer"];

const PAGE_SIZE = 15;

type SortDir = "asc" | "desc";

interface MatrixCell {
  trainingTypeId: string;
  trainingRecordId: string | null;
  status: string;
  completionDate: string | null;
  dueDate: string | null;
  trainerName: string | null;
  hours: number | null;
}

interface MatrixTrainingType {
  id: string;
  code: string;
  name: string;
  applies_to_facility_type: string;
}

interface MatrixRow {
  employee: Employee;
  cells: MatrixCell[];
}

const STATUS_COLORS: Record<string, string> = {
  compliant: "#22c55e",
  due_soon: "#f59e0b",
  expired: "#ef4444",
  missing: "#94a3b8",
  not_applicable: "#cbd5e1",
};

// Compliance-bearing statuses, mirroring Dashboard.tsx's computeDashboardSummary convention:
// "not_applicable" and "pending_review" records are excluded from compliance math entirely --
// they aren't yet (or never will be) part of the compliant/non-compliant split.
const RELEVANT_STATUSES = new Set(["compliant", "due_soon", "expired", "missing"]);

// Employees routinely accumulate multiple employee_training_records rows for the same
// training_type_id over time (e.g. complete_training_class() inserts a fresh row each renewal
// cycle rather than updating the prior one). due_date is recalculated server-side as
// completion_date + training_type.renewal_interval_days, so it advances forward each cycle --
// the record with the latest due_date is the current one. Fall back to completion_date, then
// created_at, for cases where due_date ties or is null (e.g. one-time trainings with no
// renewal_interval_days).
function isMoreCurrent(a: TrainingRecord, b: TrainingRecord): boolean {
  const aDue = a.due_date ?? "";
  const bDue = b.due_date ?? "";
  if (aDue !== bDue) return aDue > bDue;
  const aCompletion = a.completion_date ?? "";
  const bCompletion = b.completion_date ?? "";
  if (aCompletion !== bCompletion) return aCompletion > bCompletion;
  return (a.created_at ?? "") > (b.created_at ?? "");
}

function pickCurrentRecord(records: TrainingRecord[]): TrainingRecord | null {
  return records.reduce<TrainingRecord | null>(
    (current, candidate) => (!current || isMoreCurrent(candidate, current) ? candidate : current),
    null,
  );
}

function getStatusColor(status: string | undefined): string {
  if (!status) return STATUS_COLORS.missing;
  return STATUS_COLORS[status] ?? STATUS_COLORS.missing;
}

function getStatusLabel(status: string | undefined): string {
  if (!status) return "No Record";
  switch (status) {
    case "compliant": return "Compliant";
    case "due_soon": return "Due Soon";
    case "expired": return "Expired";
    case "missing": return "No Record";
    default: return status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }
}

function StatusDot({ entry, onClick }: { entry: MatrixCell | undefined; onClick?: () => void }) {
  const color = getStatusColor(entry?.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center w-6 h-6 rounded-full hover:ring-2 hover:ring-offset-1 hover:ring-primary/50 transition-all focus:outline-none focus:ring-2 focus:ring-primary"
      title={getStatusLabel(entry?.status)}
      aria-label={getStatusLabel(entry?.status)}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 12,
          height: 12,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
    </button>
  );
}

function SortButton({ field, sortField, sortDir, onSort }: {
  field: string;
  sortField: string;
  sortDir: SortDir;
  onSort: (f: string) => void;
}) {
  const active = sortField === field;
  return (
    <button
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {active ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3" />}
    </button>
  );
}

// employee_training_records.trainer_name is a plain text column (no FK -- see
// database.types.ts), so free typing lets one trainer's history silently split across
// misspellings. These sentinels back a Select of employees flagged trainer_status (mirroring
// Practicums.tsx's qualifiedObservers pattern) while still keeping a free-text escape hatch for a
// trainer who legitimately isn't in the system (e.g. a contracted instructor).
const TRAINER_NONE = "__none__";
const TRAINER_CUSTOM = "__custom__";

function resolveTrainerName(selection: string, customName: string, trainers: Employee[]): string | null {
  if (selection === TRAINER_CUSTOM) return customName.trim() || null;
  if (!selection || selection === TRAINER_NONE) return null;
  const trainer = trainers.find(t => t.id === selection);
  return trainer ? `${trainer.first_name} ${trainer.last_name}` : null;
}

// Best-effort reverse mapping for editing an existing record: if the stored free-text name
// exactly matches a currently-qualified trainer, preselect them; otherwise treat it as a
// custom/external name rather than silently discarding it.
function trainerSelectionFromName(name: string | null, trainers: Employee[]): { selection: string; customName: string } {
  if (!name) return { selection: TRAINER_NONE, customName: "" };
  const match = trainers.find(t => `${t.first_name} ${t.last_name}` === name);
  return match ? { selection: match.id, customName: "" } : { selection: TRAINER_CUSTOM, customName: name };
}

function TrainerSelectField({
  trainers, selection, customName, onSelectionChange, onCustomNameChange,
}: {
  trainers: Employee[];
  selection: string;
  customName: string;
  onSelectionChange: (v: string) => void;
  onCustomNameChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Select value={selection || TRAINER_NONE} onValueChange={onSelectionChange}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Select trainer" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TRAINER_NONE}>—</SelectItem>
          {trainers.map(t => <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>)}
          <SelectItem value={TRAINER_CUSTOM}>Other (not in system)…</SelectItem>
        </SelectContent>
      </Select>
      {selection === TRAINER_CUSTOM && (
        <Input
          className="h-9" placeholder="Trainer name"
          value={customName} onChange={e => onCustomNameChange(e.target.value)}
        />
      )}
    </div>
  );
}

function CellDetailDialog({
  open,
  onClose,
  entry,
  trainingType,
  employee,
  canManage,
  qualifiedTrainers,
}: {
  open: boolean;
  onClose: () => void;
  entry: MatrixCell | null;
  trainingType: TrainingType | null;
  employee: Employee | null;
  canManage: boolean;
  qualifiedTrainers: Employee[];
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [completionDate, setCompletionDate] = useState(todayISO());
  const [hours, setHours] = useState("");
  const [trainerSelection, setTrainerSelection] = useState(TRAINER_NONE);
  const [customTrainerName, setCustomTrainerName] = useState("");
  const createRecord = useCreateTrainingRecord();
  const updateRecord = useUpdateTrainingRecord();

  if (!entry || !trainingType || !employee) return null;

  const statusColor = getStatusColor(entry.status);

  const openEdit = () => {
    setCompletionDate(entry.completionDate ?? todayISO());
    setHours(entry.hours != null ? String(entry.hours) : "");
    const resolved = trainerSelectionFromName(entry.trainerName, qualifiedTrainers);
    setTrainerSelection(resolved.selection);
    setCustomTrainerName(resolved.customName);
    setEditing(true);
  };

  const handleSave = () => {
    if (!completionDate) {
      toast({ title: "Completion date is required", variant: "destructive" });
      return;
    }
    const dueDate = computeDueDate(completionDate, trainingType.renewal_interval_days);
    const status = computeStatus(completionDate, dueDate, trainingType.warning_days_default);
    const payload: TrainingRecordInsert = {
      organization_id: employee.organization_id,
      facility_id: employee.facility_id,
      employee_id: employee.id,
      training_type_id: trainingType.id,
      completion_date: completionDate,
      due_date: dueDate,
      status,
      hours: hours.trim() ? Number(hours) : (trainingType.required_hours ?? null),
      trainer_name: resolveTrainerName(trainerSelection, customTrainerName, qualifiedTrainers),
      completion_method: "manual_entry",
    };
    const onDone = {
      onSuccess: () => { toast({ title: "Training recorded" }); setEditing(false); },
      onError: (e: Error) => toast({ title: "Failed to record training", description: e.message, variant: "destructive" }),
    };
    if (entry.trainingRecordId) updateRecord.mutate({ id: entry.trainingRecordId, ...payload }, onDone);
    else createRecord.mutate(payload, onDone);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setEditing(false); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{trainingType.name}</DialogTitle>
        </DialogHeader>
        {editing ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">{employee.first_name} {employee.last_name}</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Completion Date *</Label>
                <Input type="date" className="h-9" value={completionDate} onChange={e => setCompletionDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Hours</Label>
                <Input
                  type="number" step="0.25" min="0" className="h-9"
                  placeholder={trainingType.required_hours != null ? String(trainingType.required_hours) : "0"}
                  value={hours} onChange={e => setHours(e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-[13px]">Trainer</Label>
                <TrainerSelectField
                  trainers={qualifiedTrainers}
                  selection={trainerSelection}
                  customName={customTrainerName}
                  onSelectionChange={setTrainerSelection}
                  onCustomNameChange={setCustomTrainerName}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createRecord.isPending || updateRecord.isPending}>
                {(createRecord.isPending || updateRecord.isPending) ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">{employee.first_name} {employee.last_name}</div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs mb-1">Status</div>
                <Badge variant="outline" className="gap-1.5">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: statusColor, display: "inline-block" }} />
                  {getStatusLabel(entry.status)}
                </Badge>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">Training Type</div>
                <div>{trainingType.name}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">Last Completed</div>
                <div>{formatDateForDisplay(entry.completionDate)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">Due Date</div>
                <div>{formatDateForDisplay(entry.dueDate)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">Trainer</div>
                <div>{entry.trainerName ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">Hours</div>
                <div>{entry.hours ?? "—"}</div>
              </div>
            </div>

            <div className="flex gap-2">
              {canManage && (
                <Button variant="outline" size="sm" className="flex-1" onClick={openEdit}>
                  <Pencil className="w-3.5 h-3.5 mr-2" />
                  Record Training
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => { onClose(); navigate(`/app/employees/${employee.id}`); }}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-2" />
                View Employee
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Batch/cohort entry -- records ONE training event (type, date, hours, trainer, optional shared
// evidence document) against MULTIPLE employees at once, e.g. a 15-person in-service that would
// otherwise be 15 separate CellDetailDialog round-trips. Same fan-out-over-mutateAsync +
// Promise.allSettled + one settled-summary toast shape as PolicyDocumentDetail.tsx's
// AssignCampaignDialog.
// ---------------------------------------------------------------------------

function RecordForMultipleDialog({
  open, onClose, employees, trainingTypes, qualifiedTrainers,
}: {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  trainingTypes: TrainingType[];
  qualifiedTrainers: Employee[];
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createRecord = useCreateTrainingRecord();
  const uploadDocument = useUploadDocument();

  const [search, setSearch] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [trainingTypeId, setTrainingTypeId] = useState("");
  const [completionDate, setCompletionDate] = useState(todayISO());
  const [hours, setHours] = useState("");
  const [trainerSelection, setTrainerSelection] = useState(TRAINER_NONE);
  const [customTrainerName, setCustomTrainerName] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees],
  );
  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedEmployees;
    return sortedEmployees.filter(e => `${e.first_name} ${e.last_name}`.toLowerCase().includes(q));
  }, [sortedEmployees, search]);
  const sortedTrainingTypes = useMemo(
    () => [...trainingTypes].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [trainingTypes],
  );
  const selectedTrainingType = sortedTrainingTypes.find(t => t.id === trainingTypeId) ?? null;

  const toggleEmployee = (id: string) => setSelectedEmployeeIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allVisibleSelected = filteredEmployees.length > 0 && filteredEmployees.every(e => selectedEmployeeIds.has(e.id));
  const toggleSelectAllVisible = () => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) filteredEmployees.forEach(e => next.delete(e.id));
      else filteredEmployees.forEach(e => next.add(e.id));
      return next;
    });
  };

  const handleClose = () => {
    setSearch("");
    setSelectedEmployeeIds(new Set());
    setTrainingTypeId("");
    setCompletionDate(todayISO());
    setHours("");
    setTrainerSelection(TRAINER_NONE);
    setCustomTrainerName("");
    setEvidenceFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  const handleSubmit = async () => {
    const targets = Array.from(selectedEmployeeIds)
      .map(id => employeeById.get(id))
      .filter((e): e is Employee => !!e);
    if (targets.length === 0) {
      toast({ title: "Select at least one employee", variant: "destructive" });
      return;
    }
    if (!selectedTrainingType) {
      toast({ title: "Training type is required", variant: "destructive" });
      return;
    }
    if (!completionDate) {
      toast({ title: "Completion date is required", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    // Evidence is optional and shared across the whole batch (one sign-in sheet/roster covering
    // every selected employee). training_documents.facility_id is NOT NULL and RLS ties
    // facility_manager/trainer visibility to that exact facility (is_assigned_to_facility(facility_id)) --
    // uploading a single copy scoped to just one employee's facility would make it unreadable to
    // facility_manager/trainer staff at any other facility represented in this batch (a real,
    // silent read-access gap for a "All Facilities" multi-select), so this uploads one copy per
    // distinct facility among the selected employees instead, and links each employee's record to
    // their own facility's copy.
    const distinctFacilities = new Map(targets.map(e => [e.facility_id, e] as const));
    const documentIdByFacility = new Map<string, string>();
    if (evidenceFile) {
      try {
        await Promise.all(
          Array.from(distinctFacilities.values()).map(async (representative) => {
            const uploaded = await uploadDocument.mutateAsync({
              file: evidenceFile,
              bucket: "signin-sheets",
              organizationId: representative.organization_id,
              facilityId: representative.facility_id,
              documentType: "roster",
            });
            documentIdByFacility.set(representative.facility_id, uploaded.id);
          }),
        );
      } catch (err) {
        setSubmitting(false);
        toast({
          title: "Failed to upload evidence document",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return;
      }
    }

    const dueDate = computeDueDate(completionDate, selectedTrainingType.renewal_interval_days);
    const status = computeStatus(completionDate, dueDate, selectedTrainingType.warning_days_default);
    const hoursValue = hours.trim() ? Number(hours) : (selectedTrainingType.required_hours ?? null);
    const trainerName = resolveTrainerName(trainerSelection, customTrainerName, qualifiedTrainers);

    const settled = await Promise.allSettled(
      targets.map(employee => {
        const evidenceDocumentId = documentIdByFacility.get(employee.facility_id) ?? null;
        return createRecord.mutateAsync({
          organization_id: employee.organization_id,
          facility_id: employee.facility_id,
          employee_id: employee.id,
          training_type_id: selectedTrainingType.id,
          completion_date: completionDate,
          due_date: dueDate,
          status,
          hours: hoursValue,
          trainer_name: trainerName,
          completion_method: "manual_entry",
          external_certificate_document_id: evidenceDocumentId,
          document_required: !!evidenceDocumentId,
        });
      }),
    );
    setSubmitting(false);

    const succeeded = settled.filter(r => r.status === "fulfilled").length;
    const failed = settled.length - succeeded;

    toast({
      title: `Recorded training for ${succeeded} employee${succeeded === 1 ? "" : "s"}`,
      description: failed > 0 ? `${failed} failed` : undefined,
      variant: failed > 0 ? "destructive" : "success",
    });
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Record Training for Multiple Employees</DialogTitle>
          <DialogDescription>Records the same training event for every employee selected below.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="space-y-1.5">
            <Label className="text-[13px]">Employees *</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <label className="flex items-center gap-2 px-1 pt-1 cursor-pointer">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAllVisible} />
              <span className="text-xs text-muted-foreground">
                Select all visible{filteredEmployees.length ? ` (${filteredEmployees.length})` : ""}
              </span>
            </label>
            <div className="border rounded-md max-h-[220px] overflow-y-auto">
              {filteredEmployees.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No employees found.</p>
              ) : (
                <div className="divide-y">
                  {filteredEmployees.map(e => (
                    <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                      <Checkbox checked={selectedEmployeeIds.has(e.id)} onCheckedChange={() => toggleEmployee(e.id)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{e.first_name} {e.last_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{e.job_title ?? "—"}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{selectedEmployeeIds.size} selected</p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Training Type *</Label>
              <Select value={trainingTypeId} onValueChange={setTrainingTypeId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select training type" /></SelectTrigger>
                <SelectContent>
                  {sortedTrainingTypes.map(tt => <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Completion Date *</Label>
              <Input type="date" className="h-9" value={completionDate} onChange={e => setCompletionDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Hours</Label>
              <Input
                type="number" step="0.25" min="0" className="h-9"
                placeholder={selectedTrainingType?.required_hours != null ? String(selectedTrainingType.required_hours) : "0"}
                value={hours} onChange={e => setHours(e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Trainer</Label>
              <TrainerSelectField
                trainers={qualifiedTrainers}
                selection={trainerSelection}
                customName={customTrainerName}
                onSelectionChange={setTrainerSelection}
                onCustomNameChange={setCustomTrainerName}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Evidence Document</Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-2" /> {evidenceFile ? "Change File" : "Choose File"}
                </Button>
                {evidenceFile && (
                  <>
                    <span className="text-xs text-muted-foreground truncate max-w-[160px]">{evidenceFile.name}</span>
                    <Button
                      type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => { setEvidenceFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      aria-label="Remove file"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                onChange={e => setEvidenceFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Optional shared roster/sign-in sheet, attached as evidence to every selected employee's record.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || selectedEmployeeIds.size === 0}>
            {submitting
              ? "Recording..."
              : `Record for ${selectedEmployeeIds.size} Employee${selectedEmployeeIds.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MATRIX_URL_DEFAULTS = {
  facilityId: "all", search: "", statusFilter: "all", trainerOnly: "false",
  medsOnly: "false", dueWindow: "all", sortField: "lastName", sortDir: "asc", page: "1",
};

export default function TrainingMatrix() {
  const [urlState, setUrlState] = useUrlState(MATRIX_URL_DEFAULTS);
  const facilityId = urlState.facilityId;
  const statusFilter = urlState.statusFilter;
  const trainerOnly = urlState.trainerOnly === "true";
  const medsOnly = urlState.medsOnly === "true";
  const dueWindow = urlState.dueWindow;
  const sortField = urlState.sortField;
  const sortDir = urlState.sortDir as SortDir;
  const page = Number(urlState.page) || 1;
  const setPage = (updater: number | ((p: number) => number)) => {
    const next = typeof updater === "function" ? updater(page) : updater;
    setUrlState({ page: String(next) });
  };

  // Mirrors the free-text box's current (undebounced) value so typing stays snappy; committed to
  // the URL 300ms after the user stops, same pattern as Employees.tsx/Incidents.tsx.
  const [search, setSearchInput] = useState(urlState.search);
  const commitSearchRef = useRef(() => {});
  commitSearchRef.current = () => {
    if (search !== urlState.search) setUrlState({ search, page: "1" });
  };
  useEffect(() => {
    const t = setTimeout(() => commitSearchRef.current(), 300);
    return () => clearTimeout(t);
  }, [search]);
  // Resyncs the local mirror when urlState.search changes for a reason other than the commit
  // above (browser Back/Forward, a bookmarked/deep link) -- the matrix filters off this local
  // value directly (see filteredRows below), so without this both the input AND the filtered
  // rows would keep showing/matching a stale search term after navigating.
  useEffect(() => {
    setSearchInput(urlState.search);
  }, [urlState.search]);

  const [selectedCell, setSelectedCell] = useState<{ entry: MatrixCell; trainingType: TrainingType; employee: Employee } | null>(null);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const { user } = useAuth();
  const canManage = !!user && TRAINING_RECORD_MANAGE_ROLES.includes(user.role);

  const facilitiesQuery = useListFacilities({});
  const employeesQuery = useListEmployees({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    status: "active",
  });
  const trainingTypesQuery = useListTrainingTypes({ isActive: true });
  const trainingRecordsQuery = useListTrainingRecords({
    facilityId: facilityId !== "all" ? facilityId : undefined,
  });
  const facilities = facilitiesQuery.data;
  const employees = employeesQuery.data;
  const trainingTypes = trainingTypesQuery.data;
  const trainingRecords = trainingRecordsQuery.data;
  const matrixQueries = [facilitiesQuery, employeesQuery, trainingTypesQuery, trainingRecordsQuery];
  const matrixLoading = matrixQueries.some((query) => query.isLoading);
  const matrixError = matrixQueries.find((query) => query.isError)?.error;
  const refetchMatrix = () => {
    void Promise.all(matrixQueries.map((query) => query.refetch()));
  };

  const matrixTrainingTypes: MatrixTrainingType[] = useMemo(
    () => [...(trainingTypes ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [trainingTypes],
  );

  // "Who can plausibly serve as trainer" for the Trainer Select on both the single-cell and
  // batch record dialogs -- scoped to this page's own active/facility-filtered roster (like the
  // matrix itself) and narrowed to employees flagged trainer_status, mirroring how
  // Practicums.tsx builds its qualifiedObservers list. A trainer outside this list (external
  // contractor, or simply out of the current facility filter) still has the dialogs' free-text
  // fallback.
  const qualifiedTrainers = useMemo(
    () => (employees ?? [])
      .filter(e => e.trainer_status)
      .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees],
  );

  const facilityTypeById = useMemo(
    () => new Map((facilities ?? []).map(f => [f.id, f.facility_type])),
    [facilities],
  );

  const matrixRows: MatrixRow[] = useMemo(() => {
    const emps = employees ?? [];
    const records = trainingRecords ?? [];
    return emps.map(emp => {
      const empRecords = records.filter(r => r.employee_id === emp.id);
      const empFacilityType = emp.facility_id ? facilityTypeById.get(emp.facility_id) : undefined;
      const cells: MatrixCell[] = matrixTrainingTypes.map(tt => {
        const record = pickCurrentRecord(empRecords.filter(r => r.training_type_id === tt.id));
        // A training type not scoped to this employee's facility type shouldn't count as a
        // missing requirement -- only synthesize "not_applicable" when there's no real record;
        // an existing record (e.g. a manually-tracked one) always wins regardless of scope.
        const applies = tt.applies_to_facility_type === "BOTH" || tt.applies_to_facility_type === empFacilityType;
        return {
          trainingTypeId: tt.id,
          trainingRecordId: record?.id ?? null,
          status: record?.status ?? (applies ? "missing" : "not_applicable"),
          completionDate: record?.completion_date ?? null,
          dueDate: record?.due_date ?? null,
          trainerName: record?.trainer_name ?? null,
          hours: record?.hours ?? null,
        };
      });
      return { employee: emp, cells };
    });
  }, [employees, trainingRecords, matrixTrainingTypes, facilityTypeById]);

  const getWorstStatus = (row: MatrixRow): string => {
    // Exclude not_applicable/pending_review cells from classification, matching
    // Dashboard.tsx's computeDashboardSummary convention -- those cells aren't part of the
    // compliant/non-compliant split and shouldn't drag a row down to "missing".
    const relevantCells = row.cells.filter(c => RELEVANT_STATUSES.has(c.status));
    if (relevantCells.some(c => c.status === "expired")) return "expired";
    if (relevantCells.some(c => c.status === "missing")) return "missing";
    if (relevantCells.some(c => c.status === "due_soon")) return "due_soon";
    if (relevantCells.length > 0 && relevantCells.every(c => c.status === "compliant")) return "compliant";
    return "compliant";
  };

  const isDueWithinWindow = (row: MatrixRow, days: number): boolean => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return row.cells.some(c => {
      if (!c.dueDate) return false;
      const due = new Date(c.dueDate);
      return due >= now && due <= cutoff;
    });
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setUrlState({ sortDir: sortDir === "asc" ? "desc" : "asc", page: "1" });
    } else {
      setUrlState({ sortField: field, sortDir: "asc", page: "1" });
    }
  };

  const clearFilters = () => {
    setSearchInput("");
    setUrlState({
      facilityId: "all", search: "", statusFilter: "all",
      trainerOnly: "false", medsOnly: "false", dueWindow: "all", page: "1",
    });
  };

  const filteredRows = useMemo(() => {
    let rows = [...matrixRows];
    if (trainerOnly) rows = rows.filter(r => r.employee.trainer_status);
    if (medsOnly) rows = rows.filter(r => r.employee.administers_medications);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        `${r.employee.first_name} ${r.employee.last_name}`.toLowerCase().includes(q) ||
        (r.employee.job_title?.toLowerCase() ?? "").includes(q)
      );
    }
    if (statusFilter !== "all") {
      rows = rows.filter(r => getWorstStatus(r) === statusFilter);
    }
    if (dueWindow !== "all") {
      const days = Number(dueWindow);
      rows = rows.filter(r => isDueWithinWindow(r, days));
    }
    rows = rows.sort((a, b) => {
      let va = "", vb = "";
      if (sortField === "firstName") { va = a.employee.first_name; vb = b.employee.first_name; }
      else if (sortField === "jobTitle") { va = a.employee.job_title ?? ""; vb = b.employee.job_title ?? ""; }
      else { va = a.employee.last_name; vb = b.employee.last_name; }
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return rows;
  }, [matrixRows, trainerOnly, medsOnly, search, statusFilter, dueWindow, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const complianceSummary = useMemo(() => {
    const summary: Record<string, { compliant: number; total: number }> = {};
    for (const tt of matrixTrainingTypes) {
      let compliant = 0;
      let total = 0;
      for (const row of filteredRows) {
        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
        // Exclude not_applicable/pending_review cells from the denominator, matching
        // Dashboard.tsx's computeDashboardSummary convention.
        if (cell && RELEVANT_STATUSES.has(cell.status)) {
          total++;
          if (cell.status === "compliant") compliant++;
        }
      }
      summary[tt.id] = { compliant, total };
    }
    return summary;
  }, [matrixTrainingTypes, filteredRows]);

  const handleExportCSV = () => {
    if (matrixTrainingTypes.length === 0) return;
    const headers = ["Employee Name", "Job Title", ...matrixTrainingTypes.map(tt => tt.code)];
    const rows = filteredRows.map(row => {
      const name = `${row.employee.first_name} ${row.employee.last_name}`;
      const jobTitle = row.employee.job_title ?? "";
      const statuses = matrixTrainingTypes.map(tt => {
        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
        return cell ? getStatusLabel(cell.status) : "No Record";
      });
      return [name, jobTitle, ...statuses];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "training-matrix.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Training Matrix</h1>
        <p className="text-muted-foreground">View compliance status across all employees and training types.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center" aria-label="Training matrix filters">
        <Select value={facilityId} onValueChange={v => setUrlState({ facilityId: v, page: "1" })}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={v => setUrlState({ statusFilter: v, page: "1" })}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="compliant">Compliant</SelectItem>
            <SelectItem value="due_soon">Due Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
          </SelectContent>
        </Select>

        <Select value={dueWindow} onValueChange={v => setUrlState({ dueWindow: v, page: "1" })}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Due Within" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Due Dates</SelectItem>
            <SelectItem value="30">Due Within 30 Days</SelectItem>
            <SelectItem value="60">Due Within 60 Days</SelectItem>
            <SelectItem value="90">Due Within 90 Days</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search by name or job title..."
          value={search}
          onChange={e => { setSearchInput(e.target.value); setUrlState({ page: "1" }); }}
          className="w-full sm:w-64"
        />

        <div className="flex w-full flex-col gap-3 rounded-md border bg-background px-3 py-2 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={trainerOnly}
              onCheckedChange={(checked) => setUrlState({ trainerOnly: checked ? "true" : "false", page: "1" })}
            />
            Trainer Only
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={medsOnly}
              onCheckedChange={(checked) => setUrlState({ medsOnly: checked ? "true" : "false", page: "1" })}
            />
            Administers Meds
          </label>
        </div>

        {canManage && (
          <Button size="sm" onClick={() => setShowBatchDialog(true)} className="w-full sm:ml-auto sm:w-auto">
            <Users className="w-4 h-4 mr-2" />
            Record for Multiple
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleExportCSV} className={`w-full sm:w-auto ${canManage ? "" : "sm:ml-auto"}`}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">
              Compliance Matrix
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({filteredRows.length} employees)
              </span>
            </CardTitle>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#22c55e" }} />
                Compliant
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#f59e0b" }} />
                Due Soon
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#ef4444" }} />
                Expired
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#94a3b8" }} />
                No Record
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {matrixError ? (
            <QueryError what="the training matrix" error={matrixError} onRetry={refetchMatrix} />
          ) : matrixLoading ? (
            <QueryLoading what="the training matrix" />
          ) : pageRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-16 h-16 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold mb-1">No matching employees</h3>
              <p className="text-sm text-muted-foreground mb-4">Try adjusting your filters or search terms</p>
              <Button variant="outline" size="sm" onClick={clearFilters}>Clear Filters</Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {pageRows.map((row) => (
                  <article key={row.employee.id} className="rounded-lg border p-4">
                    <div className="mb-3">
                      <h3 className="font-medium">{row.employee.first_name} {row.employee.last_name}</h3>
                      <p className="text-xs text-muted-foreground">{row.employee.job_title || "No role listed"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {matrixTrainingTypes.map((tt) => {
                        const cell = row.cells.find((candidate) => candidate.trainingTypeId === tt.id);
                        const fullTrainingType = trainingTypes?.find((type) => type.id === tt.id);
                        return (
                          <button
                            key={tt.id}
                            type="button"
                            className="flex min-h-11 items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-xs"
                            aria-label={`${tt.name}: ${getStatusLabel(cell?.status)}`}
                            onClick={() => {
                              if (!fullTrainingType) return;
                              setSelectedCell({
                                entry: cell ?? { trainingTypeId: tt.id, trainingRecordId: null, status: "missing", completionDate: null, dueDate: null, trainerName: null, hours: null },
                                trainingType: fullTrainingType,
                                employee: row.employee,
                              });
                            }}
                          >
                            <span className="truncate font-medium">{tt.code}</span>
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: getStatusColor(cell?.status) }}
                                aria-hidden="true"
                              />
                              {getStatusLabel(cell?.status)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground sticky left-0 bg-background min-w-[180px]">
                      <span>Employee</span>
                      <SortButton field="lastName" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground min-w-[140px] bg-background">
                      <span>Role</span>
                      <SortButton field="jobTitle" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    {matrixTrainingTypes.map(tt => (
                      <th key={tt.id} className="text-center py-2 px-2 font-medium text-muted-foreground min-w-[90px] max-w-[110px] bg-background">
                        <div className="truncate text-xs" title={tt.name}>{tt.code}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(row => (
                    <tr key={row.employee.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 pr-4 sticky left-0 bg-background">
                        <div className="font-medium">{row.employee.first_name} {row.employee.last_name}</div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">{row.employee.job_title}</td>
                      {matrixTrainingTypes.map(tt => {
                        const cell = row.cells.find(c => c.trainingTypeId === tt.id);
                        const fullTrainingType = trainingTypes?.find(t => t.id === tt.id);
                        return (
                          <td key={tt.id} className="py-2 px-2 text-center">
                            <StatusDot
                              entry={cell}
                              onClick={() => {
                                if (!fullTrainingType) return;
                                setSelectedCell({
                                  entry: cell ?? { trainingTypeId: tt.id, trainingRecordId: null, status: "missing", completionDate: null, dueDate: null, trainerName: null, hours: null },
                                  trainingType: fullTrainingType,
                                  employee: row.employee,
                                });
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/20">
                    <td className="py-2 pr-4 sticky left-0 bg-muted/20 font-medium text-xs text-muted-foreground">Summary</td>
                    <td className="py-2 pr-4"></td>
                    {matrixTrainingTypes.map(tt => {
                      const s = complianceSummary[tt.id];
                      return (
                        <td key={tt.id} className="py-2 px-2 text-center text-xs font-medium text-muted-foreground" title={`${s?.compliant ?? 0} compliant out of ${s?.total ?? 0} with records`}>
                          {s ? `${s.compliant}/${s.total}` : "-"}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
              </div>
            </>
          )}

          {!matrixError && !matrixLoading && totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <span className="text-sm flex items-center px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CellDetailDialog
        open={!!selectedCell}
        onClose={() => setSelectedCell(null)}
        entry={selectedCell?.entry ?? null}
        trainingType={selectedCell?.trainingType ?? null}
        employee={selectedCell?.employee ?? null}
        canManage={canManage}
        qualifiedTrainers={qualifiedTrainers}
      />

      <RecordForMultipleDialog
        open={showBatchDialog}
        onClose={() => setShowBatchDialog(false)}
        employees={employees ?? []}
        trainingTypes={trainingTypes ?? []}
        qualifiedTrainers={qualifiedTrainers}
      />
    </div>
  );
}
