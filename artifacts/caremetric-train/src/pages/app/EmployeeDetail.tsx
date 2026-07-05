import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ArrowLeft, User, BookOpen, CalendarCheck, Clock, Pencil, Trash2, FileText, Activity, Building2,
  Download, ShieldCheck, Plus,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetEmployee, useUpdateEmployee, useDeleteEmployee } from "@/hooks/useEmployees";
import { useGetFacility, useListFacilities } from "@/hooks/useFacilities";
import {
  useListTrainingRecords, useCreateTrainingRecord, useUpdateTrainingRecord,
  type TrainingRecord, type TrainingRecordInsert,
} from "@/hooks/useTrainingRecords";
import { useListTrainingTypes, type TrainingType } from "@/hooks/useTrainingTypes";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListTrainingHourBuckets } from "@/hooks/useTrainingHourBuckets";
import { useListDocuments, useDocumentSignedUrl, type TrainingDocument } from "@/hooks/useDocuments";
import { useListEmployeeCredentials } from "@/hooks/useEmployeeCredentials";
import { useListAuditLogs } from "@/hooks/useAuditLogs";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

interface EmpFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  employeeNumber: string;
  facilityId: string;
  hireDate: string;
  status: "active" | "inactive" | "terminated" | "on_leave";
  administersMedications: boolean;
  trainerStatus: boolean;
  notes: string;
}

function EmptyState({ icon: Icon, text }: { icon: typeof BookOpen; text: string }) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <Icon className="h-10 w-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Mirrors the due_date formula in recalculate_all_compliance() (supabase/migrations/
// 20260704053624_compliance_rpcs_and_audit_trigger.sql), same as PendingApprovals.tsx.
function computeDueDate(completionDate: string | null, renewalIntervalDays: number | null | undefined): string | null {
  if (!completionDate || renewalIntervalDays == null) return null;
  return addDaysISO(completionDate, renewalIntervalDays);
}

// Mirrors the status formula in the same RPC, same as PendingApprovals.tsx.
function computeStatus(completionDate: string | null, dueDate: string | null, warningDays: number): string {
  if (!completionDate) return "missing";
  if (!dueDate) return "compliant";
  const today = todayISO();
  if (dueDate < today) return "expired";
  if (dueDate <= addDaysISO(today, warningDays)) return "due_soon";
  return "compliant";
}

// Employees can accumulate multiple employee_training_records rows for the same training type
// over successive renewal cycles (see TrainingMatrix.tsx) -- pick the current one using the same
// due_date -> completion_date -> created_at tiebreak used there and in PendingApprovals.tsx.
function findCurrentRecord(records: TrainingRecord[], trainingTypeId: string): TrainingRecord | undefined {
  const matches = records.filter(r => r.training_type_id === trainingTypeId);
  if (matches.length === 0) return undefined;
  return matches.reduce((current, candidate) => {
    const cDue = candidate.due_date ?? "", curDue = current.due_date ?? "";
    if (cDue !== curDue) return cDue > curDue ? candidate : current;
    const cComp = candidate.completion_date ?? "", curComp = current.completion_date ?? "";
    if (cComp !== curComp) return cComp > curComp ? candidate : current;
    return (candidate.created_at ?? "") > (current.created_at ?? "") ? candidate : current;
  });
}

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const basePath = user?.role === "platform_admin" ? "/admin/employees"
    : user?.role === "trainer" ? "/trainer/employees"
    : "/app/employees";

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  // Matches employee_credentials_select RLS -- trainer is excluded (clearance/license data is
  // more sensitive than the training records shown above), unlike every other card here.
  const canViewCredentials = ["platform_admin", "org_admin", "facility_manager", "auditor"].includes(user?.role ?? "");

  const [showEditEmp, setShowEditEmp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRecordTraining, setShowRecordTraining] = useState(false);
  const [trainingForm, setTrainingForm] = useState({
    trainingTypeId: "", completionDate: todayISO(), hours: "", trainerName: "", documentId: "",
  });

  const [empForm, setEmpForm] = useState<EmpFormData>({
    firstName: "", lastName: "", email: "", phone: "", jobTitle: "",
    department: "", employeeNumber: "", facilityId: "", hireDate: "",
    status: "active", administersMedications: false, trainerStatus: false, notes: "",
  });

  const { data: employee, isLoading: empLoading } = useGetEmployee(id);
  const { data: facility } = useGetFacility(employee?.facility_id);
  const { data: facilities } = useListFacilities();

  const { mutate: updateEmployee, isPending: updating } = useUpdateEmployee();
  const { mutate: deleteEmployee, isPending: deleting } = useDeleteEmployee();
  const createTrainingRecord = useCreateTrainingRecord();
  const updateTrainingRecord = useUpdateTrainingRecord();

  const { data: trainingRecords, isLoading: recordsLoading } = useListTrainingRecords({ employeeId: id });
  const { data: trainingTypes } = useListTrainingTypes();
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({ employeeId: id });
  const { data: hourBuckets, isLoading: hoursLoading } = useListTrainingHourBuckets({ employeeId: id });
  const { data: documents, isLoading: documentsLoading } = useListDocuments({ employeeId: id });
  const { data: credentials, isLoading: credentialsLoading } = useListEmployeeCredentials({ employeeId: id });
  const { data: auditLogs, isLoading: activityLoading } = useListAuditLogs({ entityId: id, limit: 20 });
  const getSignedUrl = useDocumentSignedUrl();

  const trainingTypeName = (typeId: string) => trainingTypes?.find(t => t.id === typeId)?.name ?? "Unknown requirement";

  const handleDownloadDocument = async (doc: TrainingDocument) => {
    try {
      const signedUrl = await getSignedUrl.mutateAsync(doc);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const openEditEmp = () => {
    if (!employee) return;
    setEmpForm({
      firstName: employee.first_name,
      lastName: employee.last_name,
      email: employee.email ?? "",
      phone: employee.phone ?? "",
      jobTitle: employee.job_title ?? "",
      department: employee.department ?? "",
      employeeNumber: employee.employee_number ?? "",
      facilityId: employee.facility_id,
      hireDate: employee.hire_date ?? "",
      status: employee.status as EmpFormData["status"],
      administersMedications: employee.administers_medications ?? false,
      trainerStatus: employee.trainer_status ?? false,
      notes: employee.notes ?? "",
    });
    setShowEditEmp(true);
  };

  const handleEmpSave = () => {
    if (!employee) return;
    if (!empForm.firstName.trim() || !empForm.lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    updateEmployee(
      {
        id: employee.id,
        first_name: empForm.firstName.trim(),
        last_name: empForm.lastName.trim(),
        email: empForm.email || null,
        phone: empForm.phone || null,
        job_title: empForm.jobTitle || "",
        department: empForm.department || null,
        employee_number: empForm.employeeNumber || null,
        facility_id: empForm.facilityId,
        hire_date: empForm.hireDate || null,
        status: empForm.status,
        administers_medications: empForm.administersMedications,
        trainer_status: empForm.trainerStatus,
        notes: empForm.notes || null,
      },
      {
        onSuccess: () => { toast({ title: "Employee updated" }); setShowEditEmp(false); },
        onError: (e: Error) => toast({ title: "Failed to update employee", description: e.message, variant: "destructive" }),
      },
    );
  };

  const openRecordTraining = () => {
    setTrainingForm({ trainingTypeId: "", completionDate: todayISO(), hours: "", trainerName: "", documentId: "" });
    setShowRecordTraining(true);
  };

  const trainingFormType: TrainingType | undefined = trainingTypes?.find(t => t.id === trainingForm.trainingTypeId);

  const handleSaveTrainingRecord = () => {
    if (!employee) return;
    if (!trainingForm.trainingTypeId) {
      toast({ title: "Select a training type first", variant: "destructive" });
      return;
    }
    if (!trainingForm.completionDate) {
      toast({ title: "Completion date is required", variant: "destructive" });
      return;
    }
    const dueDate = computeDueDate(trainingForm.completionDate, trainingFormType?.renewal_interval_days ?? null);
    const status = computeStatus(trainingForm.completionDate, dueDate, trainingFormType?.warning_days_default ?? 90);
    const hoursValue = trainingForm.hours.trim() ? Number(trainingForm.hours) : (trainingFormType?.required_hours ?? null);
    const payload: TrainingRecordInsert = {
      organization_id: employee.organization_id,
      facility_id: employee.facility_id,
      employee_id: employee.id,
      training_type_id: trainingForm.trainingTypeId,
      completion_date: trainingForm.completionDate,
      due_date: dueDate,
      status,
      hours: hoursValue,
      trainer_name: trainingForm.trainerName.trim() || null,
      completion_method: "manual_entry",
      external_certificate_document_id: trainingForm.documentId || null,
      document_required: !!trainingForm.documentId,
    };
    const existing = findCurrentRecord(trainingRecords ?? [], trainingForm.trainingTypeId);
    const onDone = {
      onSuccess: () => { toast({ title: "Training recorded" }); setShowRecordTraining(false); },
      onError: (e: Error) => toast({ title: "Failed to record training", description: e.message, variant: "destructive" }),
    };
    if (existing) updateTrainingRecord.mutate({ id: existing.id, ...payload }, onDone);
    else createTrainingRecord.mutate(payload, onDone);
  };

  const handleDelete = () => {
    if (!employee) return;
    deleteEmployee(employee.id, {
      onSuccess: () => {
        toast({ title: "Employee deleted" });
        setShowDeleteConfirm(false);
        navigate(basePath);
      },
      onError: (e: Error) => toast({ title: "Failed to delete employee", description: e.message, variant: "destructive" }),
    });
  };

  const field = (k: keyof EmpFormData, v: string | boolean) =>
    setEmpForm(f => ({ ...f, [k]: v }));

  if (empLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Employee not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={basePath}>Back to Employees</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={basePath}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{employee.first_name} {employee.last_name}</h1>
            <p className="text-muted-foreground">{employee.job_title}{employee.department ? ` — ${employee.department}` : ""}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusBadge status={employee.status} type="employee" />
              {employee.administers_medications && <Badge variant="outline">Medication Administrator</Badge>}
              {employee.trainer_status && <Badge variant="outline">Trainer</Badge>}
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={openEditEmp}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Employee Number</p>
            <p className="font-semibold">{employee.employee_number ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Hire Date</p>
            <p className="font-semibold">{employee.hire_date ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Contact</p>
            <p className="font-semibold text-sm">{employee.email ?? "—"}</p>
            <p className="text-sm">{employee.phone ?? ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Facility</p>
            <p className="font-semibold text-sm flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {facility?.name ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {employee.notes ? (
            <p className="text-sm whitespace-pre-wrap">{employee.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes on file.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" /> Training Records
          </CardTitle>
          {canManage && (
            <Button size="sm" onClick={openRecordTraining}>
              <Plus className="mr-2 h-3.5 w-3.5" /> Record Training
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : !trainingRecords?.length ? (
            <EmptyState icon={BookOpen} text="No training requirements on record for this employee." />
          ) : (
            <div className="space-y-2">
              {trainingRecords.map(r => (
                <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{trainingTypeName(r.training_type_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.completion_date ? `Completed ${r.completion_date}` : "Not yet completed"}
                      {r.due_date ? ` · Due ${r.due_date}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={r.status} type="training" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" /> Annual Practicums
          </CardTitle>
        </CardHeader>
        <CardContent>
          {practicumsLoading ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : !practicums?.length ? (
            <EmptyState icon={CalendarCheck} text="No practicums on record for this employee." />
          ) : (
            <div className="space-y-2">
              {practicums.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">Practicum Year {p.practicum_year}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.completion_date ? `Completed ${p.completion_date}` : "Not yet completed"}
                      {p.due_date ? ` · Due ${p.due_date}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={p.status} type="training" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Annual Training Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hoursLoading ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : !hourBuckets?.length ? (
            <EmptyState icon={Clock} text="No annual training-hour tracking on record for this employee." />
          ) : (
            <div className="space-y-2">
              {hourBuckets.map(b => (
                <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{b.training_year}</p>
                    <p className="text-xs text-muted-foreground">
                      {Number(b.completed_hours ?? 0)} of {Number(b.required_hours ?? 0)} hours completed
                    </p>
                  </div>
                  <StatusBadge status={b.status} type="training" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          {documentsLoading ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : !documents?.length ? (
            <EmptyState icon={FileText} text="No documents on file for this employee." />
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.document_type.replace(/_/g, " ")} · {new Date(doc.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(doc)}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canViewCredentials && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Credentials &amp; Clearances
            </CardTitle>
          </CardHeader>
          <CardContent>
            {credentialsLoading ? (
              <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : !credentials?.length ? (
              <EmptyState icon={ShieldCheck} text="No credentials on record for this employee." />
            ) : (
              <div className="space-y-2">
                {credentials.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="font-medium text-sm">{c.credential_label || c.credential_type.replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.expiration_date ? `Expires ${c.expiration_date}` : "No expiration on file"}
                      </p>
                    </div>
                    <StatusBadge status={c.status} type="training" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : !auditLogs?.length ? (
              <EmptyState icon={Activity} text="No recorded activity for this employee yet." />
            ) : (
              <div className="space-y-2">
                {auditLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                    <span>{log.action.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showEditEmp} onOpenChange={o => { if (!o) setShowEditEmp(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Employee</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label>First Name *</Label>
              <Input value={empForm.firstName} onChange={e => field("firstName", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Last Name *</Label>
              <Input value={empForm.lastName} onChange={e => field("lastName", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={empForm.email} onChange={e => field("email", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={empForm.phone} onChange={e => field("phone", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Job Title</Label>
              <Input value={empForm.jobTitle} onChange={e => field("jobTitle", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Department</Label>
              <Input value={empForm.department} onChange={e => field("department", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Employee Number</Label>
              <Input value={empForm.employeeNumber} onChange={e => field("employeeNumber", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Facility</Label>
              <Select value={empForm.facilityId} onValueChange={v => field("facilityId", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {facilities?.map(fa => (
                    <SelectItem key={fa.id} value={fa.id}>{fa.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={empForm.status} onValueChange={v => field("status", v as EmpFormData["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Hire Date</Label>
              <Input type="date" value={empForm.hireDate} onChange={e => field("hireDate", e.target.value)} />
            </div>
            <div className="col-span-full flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={empForm.administersMedications} onChange={e => field("administersMedications", e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">Administers Medications</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={empForm.trainerStatus} onChange={e => field("trainerStatus", e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">Designated Trainer</span>
              </label>
            </div>
            <div className="col-span-full space-y-1">
              <Label>Notes</Label>
              <Textarea value={empForm.notes} onChange={e => field("notes", e.target.value)} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditEmp(false)}>Cancel</Button>
            <Button onClick={handleEmpSave} disabled={updating}>{updating ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRecordTraining} onOpenChange={o => { if (!o) setShowRecordTraining(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Training</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Training Type *</Label>
              <Select
                value={trainingForm.trainingTypeId}
                onValueChange={v => setTrainingForm(f => ({ ...f, trainingTypeId: v }))}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="Select training type" /></SelectTrigger>
                <SelectContent>
                  {trainingTypes?.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Completion Date *</Label>
              <Input
                type="date" className="h-9" value={trainingForm.completionDate}
                onChange={e => setTrainingForm(f => ({ ...f, completionDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Hours</Label>
              <Input
                type="number" step="0.25" min="0" className="h-9"
                placeholder={trainingFormType?.required_hours != null ? String(trainingFormType.required_hours) : "0"}
                value={trainingForm.hours}
                onChange={e => setTrainingForm(f => ({ ...f, hours: e.target.value }))}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[13px]">Trainer Name</Label>
              <Input
                className="h-9" placeholder="Optional" value={trainingForm.trainerName}
                onChange={e => setTrainingForm(f => ({ ...f, trainerName: e.target.value }))}
              />
            </div>
            {!!documents?.length && (
              <div className="col-span-2 space-y-1.5">
                <Label className="text-[13px]">Evidence Document</Label>
                <Select
                  value={trainingForm.documentId || "none"}
                  onValueChange={v => setTrainingForm(f => ({ ...f, documentId: v === "none" ? "" : v }))}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {documents.map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.file_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pick from this employee's already-uploaded documents, or upload a new one from the Documents page first.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRecordTraining(false)}>Cancel</Button>
            <Button
              onClick={handleSaveTrainingRecord}
              disabled={createTrainingRecord.isPending || updateTrainingRecord.isPending}
            >
              {(createTrainingRecord.isPending || updateTrainingRecord.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {employee.first_name} {employee.last_name}? This will permanently remove their record. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
