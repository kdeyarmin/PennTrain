import { useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ArrowLeft, User, BookOpen, CalendarCheck, Clock, Pencil, Trash2, FileText, Activity, Building2,
  Download, ShieldCheck, Plus, KeyRound, ClipboardList, Check, MessageCircle, Mail,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetEmployee, useUpdateEmployee, useDeleteEmployee, useListEmployees } from "@/hooks/useEmployees";
import { usePageTitle } from "@/lib/pageTitle";
import { useGetFacility, useListFacilities } from "@/hooks/useFacilities";
import { EmployeeFormFields, EMPTY_EMPLOYEE_FORM, employeeToFormData, type EmpFormData } from "@/components/employees/EmployeeFormFields";
import {
  useListTrainingRecords, useCreateTrainingRecord, useUpdateTrainingRecord,
  type TrainingRecord, type TrainingRecordInsert,
} from "@/hooks/useTrainingRecords";
import { useListTrainingTypes, type TrainingType } from "@/hooks/useTrainingTypes";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListTrainingHourBuckets } from "@/hooks/useTrainingHourBuckets";
import { useListDocuments, useDocumentSignedUrl, type TrainingDocument } from "@/hooks/useDocuments";
import { useListEmployeeCredentials } from "@/hooks/useEmployeeCredentials";
import {
  useListEmployeeFacilityAssignments, useAddEmployeeFacilityAssignment, useRemoveEmployeeFacilityAssignment,
} from "@/hooks/useEmployeeFacilityAssignments";
import { useSetEmployeeCheckinPin } from "@/hooks/useTrainingClasses";
import {
  useListEmployeeOnboardingItems, useUpdateEmployeeOnboardingItem,
  useListEmployeeCheckinLogs, useLogEmployeeCheckin,
} from "@/hooks/useOnboarding";
import { useListAuditLogs } from "@/hooks/useAuditLogs";
import { useAuth } from "@/lib/auth";
import { useInviteUser } from "@/hooks/useProfiles";
import { useToast } from "@/hooks/use-toast";
import { todayISO, addDaysISO, computeDueDate, computeStatus } from "@/lib/complianceDates";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

function EmptyState({ icon: Icon, text }: { icon: typeof BookOpen; text: string }) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <Icon className="h-10 w-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );
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

// Sentinel values for the Record Training dialog's trainer picker (see qualifiedTrainers below):
// "none" leaves trainer_name blank, "__other__" reveals a free-text fallback for a trainer who
// isn't a designated employee in the system (e.g. an outside vendor/instructor).
const NONE_TRAINER = "none";
const OTHER_TRAINER = "__other__";

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const basePath = user?.role === "platform_admin" ? "/admin/employees"
    : user?.role === "trainer" ? "/trainer/employees"
    : "/app/employees";

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");
  // Matches employee_credentials_select RLS -- trainer is excluded (clearance/license data is
  // more sensitive than the training records shown above), unlike every other card here.
  const canViewCredentials = ["platform_admin", "org_admin", "facility_manager", "auditor"].includes(user?.role ?? "");

  const [showEditEmp, setShowEditEmp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [removeFacilityAssignmentTarget, setRemoveFacilityAssignmentTarget] = useState<{ id: string; facilityName: string } | null>(null);
  const [showRecordTraining, setShowRecordTraining] = useState(false);
  const [showSetPin, setShowSetPin] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const { mutate: setCheckinPin, isPending: settingPin } = useSetEmployeeCheckinPin();
  const [trainingForm, setTrainingForm] = useState({
    trainingTypeId: "", completionDate: todayISO(), hours: "", trainerName: "", documentId: "",
  });
  // Drives the trainer Select in the Record Training dialog -- either NONE_TRAINER, OTHER_TRAINER
  // (reveals the free-text fallback below), or a qualified trainer's employee id.
  const [trainerSelection, setTrainerSelection] = useState<string>(NONE_TRAINER);

  const [empForm, setEmpForm] = useState<EmpFormData>(EMPTY_EMPLOYEE_FORM);

  const { data: employee, isLoading: empLoading } = useGetEmployee(id);
  usePageTitle(employee ? `${employee.first_name} ${employee.last_name}` : undefined);
  const { data: facility } = useGetFacility(employee?.facility_id);
  const { data: facilities } = useListFacilities();
  // Scoped to this employee's own org (unlike Practicums.tsx's equivalent qualifiedObservers list,
  // which is left unfiltered) so a platform_admin viewing one org's employee doesn't get another
  // org's trainers mixed into the picker below.
  const { data: employeesAll } = useListEmployees(
    { organizationId: employee?.organization_id },
    { enabled: !!employee?.organization_id },
  );

  const { mutate: updateEmployee, isPending: updating } = useUpdateEmployee();
  const { mutate: deleteEmployee, isPending: deleting } = useDeleteEmployee();
  const { mutate: inviteUser, isPending: inviting } = useInviteUser();
  const createTrainingRecord = useCreateTrainingRecord();
  const updateTrainingRecord = useUpdateTrainingRecord();

  const { data: trainingRecords, isLoading: recordsLoading } = useListTrainingRecords({ employeeId: id });
  const { data: trainingTypes } = useListTrainingTypes();
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({ employeeId: id });
  const { data: hourBuckets, isLoading: hoursLoading } = useListTrainingHourBuckets({ employeeId: id });
  const { data: documents, isLoading: documentsLoading } = useListDocuments({ employeeId: id });
  const { data: credentials, isLoading: credentialsLoading } = useListEmployeeCredentials({ employeeId: id });
  const { data: auditLogs, isLoading: activityLoading } = useListAuditLogs({ entityId: id, limit: 20 });
  const { data: onboardingItems, isLoading: onboardingLoading } = useListEmployeeOnboardingItems(id);
  const { data: checkinLogs } = useListEmployeeCheckinLogs(id);
  const { mutate: updateOnboardingItem } = useUpdateEmployeeOnboardingItem();
  const { mutate: logCheckin, isPending: loggingCheckin } = useLogEmployeeCheckin();
  const getSignedUrl = useDocumentSignedUrl();

  const { data: facilityAssignments, isLoading: facilityAssignmentsLoading } = useListEmployeeFacilityAssignments({ employeeId: id });
  const addFacilityAssignment = useAddEmployeeFacilityAssignment();
  const removeFacilityAssignment = useRemoveEmployeeFacilityAssignment();
  const [addFacilityId, setAddFacilityId] = useState("");

  const trainingTypeName = (typeId: string) => trainingTypes?.find(t => t.id === typeId)?.name ?? "Unknown requirement";

  // "Trainer" picker for the Record Training dialog below -- designated trainers only (mirrors the
  // pattern Practicums.tsx uses to build its qualifiedObservers list off the same employees query,
  // but scoped to trainer_status specifically since this field records who *taught* a training,
  // not who's merely qualified to observe medication administration).
  const qualifiedTrainers = useMemo(() => (employeesAll ?? []).filter(e => e.trainer_status), [employeesAll]);
  const qualifiedTrainerNameById = useMemo(
    () => new Map(qualifiedTrainers.map(e => [e.id, `${e.first_name} ${e.last_name}`])),
    [qualifiedTrainers],
  );

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
    setEmpForm(employeeToFormData(employee));
    setShowEditEmp(true);
  };

  const handlePortalInvite = () => {
    if (!employee?.email) {
      openEditEmp();
      return;
    }
    const publicBasePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    inviteUser(
      {
        email: employee.email,
        firstName: employee.first_name,
        lastName: employee.last_name,
        role: "employee",
        organizationId: employee.organization_id,
        employeeId: employee.id,
        redirectTo: `${window.location.origin}${publicBasePath}/reset-password`,
      },
      {
        onSuccess: () => toast({
          title: "Portal invite sent",
          description: `${employee.email} can use the invite to set a password and access self-service.`,
        }),
        onError: (e: Error) => toast({ title: "Failed to send portal invite", description: e.message, variant: "destructive" }),
      },
    );
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
        scheduled_hours_per_week: empForm.scheduledHoursPerWeek.trim() ? Number(empForm.scheduledHoursPerWeek) : null,
        worker_type: empForm.workerType,
      },
      {
        onSuccess: () => { toast({ title: "Employee updated" }); setShowEditEmp(false); },
        onError: (e: Error) => toast({ title: "Failed to update employee", description: e.message, variant: "destructive" }),
      },
    );
  };

  const openRecordTraining = () => {
    setTrainingForm({ trainingTypeId: "", completionDate: todayISO(), hours: "", trainerName: "", documentId: "" });
    setTrainerSelection(NONE_TRAINER);
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

  const handleAddFacilityAssignment = () => {
    if (!employee || !addFacilityId) return;
    addFacilityAssignment.mutate(
      { organization_id: employee.organization_id, employee_id: employee.id, facility_id: addFacilityId, is_primary: false },
      {
        onSuccess: () => { setAddFacilityId(""); toast({ title: "Facility assignment added" }); },
        onError: (e: Error) => toast({ title: "Failed to add facility assignment", description: e.message, variant: "destructive" }),
      },
    );
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
              {employee.worker_type !== "regular" && <Badge variant="outline">{employee.worker_type}</Badge>}
              <Badge variant="outline" className={employee.profile_id ? "border-success/40 text-success" : "text-muted-foreground"}>
                {employee.profile_id ? "Portal access active" : "No portal access"}
              </Badge>
              <Badge className={employee.cleared_for_unsupervised_duty ? "bg-success text-success-foreground hover:bg-success/80" : "bg-warning text-warning-foreground hover:bg-warning/80"} variant="outline">
                {employee.cleared_for_unsupervised_duty ? "Cleared for Unsupervised Duty" : "Onboarding In Progress"}
              </Badge>
            </div>
          </div>
        </div>
        {(canManage || canDelete) && (
          <div className="flex items-center gap-2 flex-wrap">
            {canManage && (
              <>
                {!employee.profile_id && (
                  <Button variant="outline" size="sm" onClick={handlePortalInvite} disabled={inviting}>
                    <Mail className="mr-2 h-3.5 w-3.5" />
                    {inviting ? "Sending Invite..." : employee.email ? "Invite to Portal" : "Add Email for Portal"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={openEditEmp}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setPinValue(""); setShowSetPin(true); }}>
                  <KeyRound className="mr-2 h-3.5 w-3.5" /> Set Check-In PIN
                </Button>
              </>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </Button>
            )}
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

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="training">Training &amp; Compliance</TabsTrigger>
          {canViewCredentials && <TabsTrigger value="credentials">Credentials</TabsTrigger>}
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {canManage && <TabsTrigger value="activity">Activity</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Facility Assignments</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Facilities this employee can be scheduled at. Their primary facility is kept in sync with the
                  Facility field above and can't be removed here.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {facilityAssignmentsLoading ? (
                  <Skeleton className="h-10" />
                ) : !facilityAssignments?.length ? (
                  <EmptyState icon={Building2} text="No facility assignments on record for this employee." />
                ) : (
                  <div className="space-y-2">
                    {facilityAssignments.map(fa => (
                      <div key={fa.id} className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {facilities?.find(f => f.id === fa.facility_id)?.name ?? "Unknown facility"}
                          </span>
                          {fa.is_primary && <Badge variant="outline">Primary</Badge>}
                        </div>
                        {!fa.is_primary && (
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => setRemoveFacilityAssignmentTarget({
                              id: fa.id,
                              facilityName: facilities?.find(f => f.id === fa.facility_id)?.name ?? "this facility",
                            })}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {(() => {
                  const assignedFacilityIds = new Set((facilityAssignments ?? []).map(fa => fa.facility_id));
                  const availableFacilities = (facilities ?? []).filter(f => !assignedFacilityIds.has(f.id));
                  if (!availableFacilities.length) return null;
                  return (
                    <div className="flex gap-2 pt-1">
                      <Select value={addFacilityId} onValueChange={setAddFacilityId}>
                        <SelectTrigger className="max-w-xs"><SelectValue placeholder="Add a facility" /></SelectTrigger>
                        <SelectContent>
                          {availableFacilities.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={handleAddFacilityAssignment} disabled={!addFacilityId || addFacilityAssignment.isPending}>
                        <Plus className="mr-2 h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> New-Hire Onboarding Checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {onboardingLoading ? (
                <Skeleton className="h-10" />
              ) : !onboardingItems?.length ? (
                <p className="text-sm text-muted-foreground">No onboarding checklist instantiated for this hire.</p>
              ) : (
                <div className="space-y-2">
                  {onboardingItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                      <div>
                        <div className="flex items-center gap-1.5">
                          {item.label}
                          {item.is_blocking && <Badge variant="outline" className="text-[10px]">Blocking</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {item.category}{item.due_date ? ` · Due ${item.due_date}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          className={
                            item.status === "completed" ? "bg-success text-success-foreground hover:bg-success/80"
                            : item.status === "not_applicable" ? "bg-muted text-muted-foreground"
                            : "bg-warning text-warning-foreground hover:bg-warning/80"
                          }
                          variant="outline"
                        >
                          {item.status.replace(/_/g, " ")}
                        </Badge>
                        {canManage && item.status === "pending" && (
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => updateOnboardingItem({
                              id: item.id, status: "completed", completed_at: new Date().toISOString(), completed_by_profile_id: user?.id ?? null,
                            })}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" /> Retention Check-Ins</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Half of first-year quits happen inside 90 days -- log a 7/14/30/60/90-day check-in conversation here.
              </p>
              <div className="grid grid-cols-5 gap-2">
                {[7, 14, 30, 60, 90].map((day) => {
                  const log = checkinLogs?.find((c) => c.check_in_day === day);
                  return (
                    <div key={day} className="flex flex-col items-center gap-1 p-2 rounded-lg border text-center">
                      <span className="text-xs font-medium">Day {day}</span>
                      {log ? (
                        <Badge className="bg-success text-success-foreground hover:bg-success/80 text-[10px]" variant="outline">
                          Logged {new Date(log.completed_at).toLocaleDateString()}
                        </Badge>
                      ) : canManage ? (
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs px-2" disabled={loggingCheckin}
                          onClick={() => logCheckin({
                            employee_id: employee.id, organization_id: employee.organization_id, facility_id: employee.facility_id,
                            check_in_day: day, completed_by_profile_id: user?.id ?? null,
                          })}
                        >
                          Log
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

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
        </TabsContent>

        <TabsContent value="training" className="space-y-6">
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
        </TabsContent>

        <TabsContent value="documents" className="space-y-6">
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
        </TabsContent>

        {canViewCredentials && (
          <TabsContent value="credentials" className="space-y-6">
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
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="activity" className="space-y-6">
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
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={showEditEmp} onOpenChange={o => { if (!o) setShowEditEmp(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Employee</DialogTitle></DialogHeader>
          <EmployeeFormFields form={empForm} onChange={field} facilities={facilities} facilityFieldMode="edit-fixed" />
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
              <Label className="text-[13px]">Trainer</Label>
              <Select
                value={trainerSelection}
                onValueChange={v => {
                  setTrainerSelection(v);
                  setTrainingForm(f => ({
                    ...f,
                    trainerName: v === NONE_TRAINER || v === OTHER_TRAINER ? "" : (qualifiedTrainerNameById.get(v) ?? ""),
                  }));
                }}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_TRAINER}>None</SelectItem>
                  {qualifiedTrainers.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
                  ))}
                  <SelectItem value={OTHER_TRAINER}>Other (type name)</SelectItem>
                </SelectContent>
              </Select>
              {trainerSelection === OTHER_TRAINER && (
                <Input
                  className="h-9 mt-1.5" placeholder="Trainer name" value={trainingForm.trainerName}
                  onChange={e => setTrainingForm(f => ({ ...f, trainerName: e.target.value }))}
                  autoFocus
                />
              )}
              <p className="text-xs text-muted-foreground">
                Designated trainers only -- choose "Other" for an outside vendor or instructor.
              </p>
            </div>
            {!!documents?.length && (
              <div className="col-span-2 space-y-1.5">
                <Label className="text-[13px]">Documentation Document</Label>
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

      <Dialog open={showSetPin} onOpenChange={setShowSetPin}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Check-In PIN</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-[13px]">4-6 Digit PIN</Label>
            <Input
              type="text" inputMode="numeric" maxLength={6} value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
              className="h-10 text-center text-lg tracking-widest"
            />
            <p className="text-xs text-muted-foreground">
              Used at a kiosk-mode tablet to self check in/out for training classes. Not a login password.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSetPin(false)}>Cancel</Button>
            <Button
              disabled={!/^\d{4,6}$/.test(pinValue) || settingPin}
              onClick={() => setCheckinPin(
                { employeeId: employee.id, pin: pinValue },
                {
                  onSuccess: () => { toast({ title: "Check-in PIN set" }); setShowSetPin(false); },
                  onError: (e: Error) => toast({ title: "Failed to set PIN", description: e.message, variant: "destructive" }),
                },
              )}
            >
              {settingPin ? "Saving..." : "Save"}
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

      <AlertDialog open={!!removeFacilityAssignmentTarget} onOpenChange={(o) => { if (!o) setRemoveFacilityAssignmentTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Facility Assignment</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {employee.first_name} {employee.last_name}'s assignment to {removeFacilityAssignmentTarget?.facilityName}?
              They will no longer be schedulable at that facility. You can re-add the assignment later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!removeFacilityAssignmentTarget) return;
                removeFacilityAssignment.mutate(removeFacilityAssignmentTarget.id, {
                  onError: (e: Error) => toast({ title: "Failed to remove facility assignment", description: e.message, variant: "destructive" }),
                });
                setRemoveFacilityAssignmentTarget(null);
              }}
              disabled={removeFacilityAssignment.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeFacilityAssignment.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
