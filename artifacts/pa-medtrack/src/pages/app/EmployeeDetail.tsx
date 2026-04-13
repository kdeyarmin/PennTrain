import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { ArrowLeft, User, CalendarCheck, BookOpen, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useUpdateEmployee, useListFacilities,
  useCreateTrainingRecord, useDeleteTrainingRecord,
  useCreatePracticum, useDeletePracticum,
  useListTrainingTypes,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string | null;
  status: string;
  administersMedications: boolean;
  trainerStatus: boolean;
  hireDate: string | null;
  email: string | null;
  phone: string | null;
  employeeNumber: string | null;
  facilityId: number | null;
}

interface TrainingRecord {
  id: number;
  trainingTypeId: number;
  completionDate: string | null;
  dueDate: string | null;
  status: string;
  trainingType: { name: string; category: string } | null;
}

interface Practicum {
  id: number;
  practicumYear: number;
  completionDate: string | null;
  status: string;
  observedBy: string | null;
}

interface AnnualHours {
  id: number;
  trainingYear: number;
  requiredHours: string;
  completedHours: string;
  status: string;
}

interface ComplianceSummary {
  employeeId: number;
  employeeName: string;
  status: string;
  administersMedications: boolean;
  trainerStatus: boolean;
  trainingRecords: TrainingRecord[];
  practicums: Practicum[];
  annualHours: AnnualHours[];
  overallStatus: string;
}

function statusColor(status: string): string {
  switch (status) {
    case "compliant": return "text-green-700 bg-green-50 border-green-200";
    case "due_soon": return "text-yellow-700 bg-yellow-50 border-yellow-200";
    case "expired":
    case "missing": return "text-red-700 bg-red-50 border-red-200";
    default: return "text-muted-foreground bg-muted";
  }
}

export default function EmployeeDetail() {
  const [, params] = useRoute("/app/employees/:id");
  const id = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");

  const [showEditEmp, setShowEditEmp] = useState(false);
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [showAddPracticum, setShowAddPracticum] = useState(false);
  const [deleteRecordId, setDeleteRecordId] = useState<number | null>(null);
  const [deletePracticumId, setDeletePracticumId] = useState<number | null>(null);

  const [empForm, setEmpForm] = useState({
    firstName: "", lastName: "", jobTitle: "", department: "",
    email: "", phone: "", status: "active" as const, facilityId: "none",
    administersMedications: false, trainerStatus: false, hireDate: "",
  });

  const [recordForm, setRecordForm] = useState({
    trainingTypeId: "none", completionDate: "", dueDate: "", status: "compliant" as const,
    trainerName: "", notes: "",
  });

  const [practicumForm, setPracticumForm] = useState({
    practicumYear: String(new Date().getFullYear()),
    completionDate: "", observedBy: "",
    marReviewCompleted: false, directObservationCompleted: false,
  });

  const { data: employee, isLoading: empLoading } = useQuery<Employee>({
    queryKey: ["employee", id],
    queryFn: async () => {
      const res = await fetch(`/api/employees/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Employee not found");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: summary, isLoading: sumLoading } = useQuery<ComplianceSummary>({
    queryKey: ["employee-compliance", id],
    queryFn: async () => {
      const res = await fetch(`/api/employees/${id}/compliance-summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load compliance summary");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: trainingTypes } = useListTrainingTypes({});
  const { data: facilities } = useListFacilities({});

  const { mutate: updateEmployee, isPending: updating } = useUpdateEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee updated" });
        queryClient.invalidateQueries({ queryKey: ["employee", id] });
        queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
        setShowEditEmp(false);
      },
      onError: (e: unknown) => toast({ title: "Failed to update", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const { mutate: createTrainingRecord, isPending: creatingRecord } = useCreateTrainingRecord({
    mutation: {
      onSuccess: () => {
        toast({ title: "Training record added" });
        queryClient.invalidateQueries({ queryKey: ["employee-compliance", id] });
        setShowAddRecord(false);
        setRecordForm({ trainingTypeId: "none", completionDate: "", dueDate: "", status: "compliant", trainerName: "", notes: "" });
      },
      onError: (e: unknown) => toast({ title: "Failed to add record", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const { mutate: deleteTrainingRecord, isPending: deletingRecord } = useDeleteTrainingRecord({
    mutation: {
      onSuccess: () => {
        toast({ title: "Training record deleted" });
        queryClient.invalidateQueries({ queryKey: ["employee-compliance", id] });
        setDeleteRecordId(null);
      },
      onError: (e: unknown) => toast({ title: "Failed to delete record", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const { mutate: createPracticum, isPending: creatingPracticum } = useCreatePracticum({
    mutation: {
      onSuccess: () => {
        toast({ title: "Practicum added" });
        queryClient.invalidateQueries({ queryKey: ["employee-compliance", id] });
        setShowAddPracticum(false);
        setPracticumForm({ practicumYear: String(new Date().getFullYear()), completionDate: "", observedBy: "", marReviewCompleted: false, directObservationCompleted: false });
      },
      onError: (e: unknown) => toast({ title: "Failed to add practicum", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const { mutate: deletePracticum, isPending: deletingPracticum } = useDeletePracticum({
    mutation: {
      onSuccess: () => {
        toast({ title: "Practicum deleted" });
        queryClient.invalidateQueries({ queryKey: ["employee-compliance", id] });
        setDeletePracticumId(null);
      },
      onError: (e: unknown) => toast({ title: "Failed to delete practicum", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const openEditEmp = () => {
    if (!employee) return;
    setEmpForm({
      firstName: employee.firstName,
      lastName: employee.lastName,
      jobTitle: employee.jobTitle ?? "",
      department: employee.department ?? "",
      email: employee.email ?? "",
      phone: employee.phone ?? "",
      status: employee.status as typeof empForm.status,
      facilityId: employee.facilityId ? String(employee.facilityId) : "none",
      administersMedications: employee.administersMedications,
      trainerStatus: employee.trainerStatus,
      hireDate: employee.hireDate ?? "",
    });
    setShowEditEmp(true);
  };

  const handleEmpSave = () => {
    if (!employee) return;
    updateEmployee({
      id: employee.id,
      data: {
        firstName: empForm.firstName,
        lastName: empForm.lastName,
        jobTitle: empForm.jobTitle || undefined,
        department: empForm.department || undefined,
        email: empForm.email || undefined,
        phone: empForm.phone || undefined,
        status: empForm.status,
        facilityId: empForm.facilityId !== "none" ? Number(empForm.facilityId) : undefined,
        administersMedications: empForm.administersMedications,
        trainerStatus: empForm.trainerStatus,
        hireDate: empForm.hireDate || undefined,
      },
    });
  };

  const handleAddRecord = () => {
    if (!employee || !id) return;
    if (recordForm.trainingTypeId === "none") {
      toast({ title: "Select a training type", variant: "destructive" });
      return;
    }
    createTrainingRecord({
      data: {
        employeeId: employee.id,
        trainingTypeId: Number(recordForm.trainingTypeId),
        completionDate: recordForm.completionDate || undefined,
        dueDate: recordForm.dueDate || undefined,
        trainerName: recordForm.trainerName || undefined,
        notes: recordForm.notes || undefined,
        documentRequired: false,
      } as Parameters<typeof createTrainingRecord>[0]["data"],
    });
  };

  const handleAddPracticum = () => {
    if (!employee) return;
    createPracticum({
      data: {
        employeeId: employee.id,
        practicumYear: Number(practicumForm.practicumYear),
        completionDate: practicumForm.completionDate || undefined,
        observedBy: practicumForm.observedBy || undefined,
        marReviewCompleted: practicumForm.marReviewCompleted,
        directObservationCompleted: practicumForm.directObservationCompleted,
        remediationRequired: false,
      } as Parameters<typeof createPracticum>[0]["data"],
    });
  };

  const isLoading = empLoading || sumLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
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
          <Link href="/app/employees">Back to Employees</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/employees">
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
            <h1 className="text-2xl font-bold">{employee.firstName} {employee.lastName}</h1>
            <p className="text-muted-foreground">{employee.jobTitle}{employee.department ? ` — ${employee.department}` : ""}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant={employee.status === "active" ? "default" : "secondary"}>{employee.status}</Badge>
              {employee.administersMedications && <Badge variant="outline">Medication Administrator</Badge>}
              {employee.trainerStatus && <Badge variant="outline">Trainer</Badge>}
              {summary && (
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${statusColor(summary.overallStatus)}`}>
                  {summary.overallStatus === "compliant" ? "Compliant" :
                    summary.overallStatus === "due_soon" ? "Due Soon" :
                    summary.overallStatus === "expired" ? "Expired" :
                    summary.overallStatus === "missing" ? "Missing Training" : summary.overallStatus}
                </span>
              )}
            </div>
          </div>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" onClick={openEditEmp}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Employee Number</p>
            <p className="font-semibold">{employee.employeeNumber ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Hire Date</p>
            <p className="font-semibold">{employee.hireDate ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Contact</p>
            <p className="font-semibold text-sm">{employee.email ?? "—"}</p>
            <p className="text-sm">{employee.phone ?? ""}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><BookOpen className="h-5 w-5" /> Training Records</span>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setShowAddRecord(true)}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add Record
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!summary?.trainingRecords.length ? (
            <p className="text-sm text-muted-foreground">No training records.</p>
          ) : (
            <div className="space-y-2">
              {summary.trainingRecords.map(tr => (
                <div key={tr.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{tr.trainingType?.name ?? `Training #${tr.trainingTypeId}`}</p>
                    <p className="text-xs text-muted-foreground">{tr.trainingType?.category}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right space-y-1">
                      <StatusBadge status={tr.status as "compliant" | "due_soon" | "expired" | "missing" | "not_applicable" | "pending_review"} />
                      <p className="text-xs text-muted-foreground">
                        {tr.completionDate ? `Completed: ${tr.completionDate}` : "Not completed"}
                        {tr.dueDate ? ` — Due: ${tr.dueDate}` : ""}
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteRecordId(tr.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><CalendarCheck className="h-5 w-5" /> Annual Practicums</span>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setShowAddPracticum(true)}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add Practicum
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!summary?.practicums.length ? (
            <p className="text-sm text-muted-foreground">No practicums on record.</p>
          ) : (
            <div className="space-y-2">
              {summary.practicums.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{p.practicumYear} Annual Practicum</p>
                    {p.observedBy && <p className="text-xs text-muted-foreground">Observed by: {p.observedBy}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right space-y-1">
                      <StatusBadge status={p.status as "compliant" | "due_soon" | "expired" | "missing" | "not_applicable" | "pending_review"} />
                      <p className="text-xs text-muted-foreground">
                        {p.completionDate ? `Completed: ${p.completionDate}` : "Pending"}
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeletePracticumId(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Annual Training Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!summary?.annualHours.length ? (
            <p className="text-sm text-muted-foreground">No annual hour buckets recorded.</p>
          ) : (
            <div className="space-y-2">
              {summary.annualHours.map(h => (
                <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{h.trainingYear} Training Hours</p>
                    <p className="text-xs text-muted-foreground">{h.completedHours} / {h.requiredHours} hours completed</p>
                  </div>
                  <StatusBadge status={h.status as "compliant" | "due_soon" | "expired" | "missing" | "not_applicable" | "pending_review"} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEditEmp} onOpenChange={o => { if (!o) setShowEditEmp(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Employee</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label>First Name *</Label>
              <Input value={empForm.firstName} onChange={e => setEmpForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Last Name *</Label>
              <Input value={empForm.lastName} onChange={e => setEmpForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={empForm.email} onChange={e => setEmpForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={empForm.phone} onChange={e => setEmpForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Job Title</Label>
              <Input value={empForm.jobTitle} onChange={e => setEmpForm(f => ({ ...f, jobTitle: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Department</Label>
              <Input value={empForm.department} onChange={e => setEmpForm(f => ({ ...f, department: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Facility</Label>
              <Select value={empForm.facilityId} onValueChange={v => setEmpForm(f => ({ ...f, facilityId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No facility</SelectItem>
                  {facilities?.map(fa => (
                    <SelectItem key={fa.id} value={String(fa.id)}>{fa.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={empForm.status} onValueChange={v => setEmpForm(f => ({ ...f, status: v as typeof empForm.status }))}>
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
              <Input type="date" value={empForm.hireDate} onChange={e => setEmpForm(f => ({ ...f, hireDate: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={empForm.administersMedications} onChange={e => setEmpForm(f => ({ ...f, administersMedications: e.target.checked }))} className="h-4 w-4" />
                <span className="text-sm">Administers Medications</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={empForm.trainerStatus} onChange={e => setEmpForm(f => ({ ...f, trainerStatus: e.target.checked }))} className="h-4 w-4" />
                <span className="text-sm">Designated Trainer</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditEmp(false)}>Cancel</Button>
            <Button onClick={handleEmpSave} disabled={updating}>{updating ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRecord} onOpenChange={o => { if (!o) setShowAddRecord(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Training Record</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Training Type *</Label>
              <Select value={recordForm.trainingTypeId} onValueChange={v => setRecordForm(f => ({ ...f, trainingTypeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select training type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select training type...</SelectItem>
                  {(trainingTypes as Array<{ id: number; name: string; category?: string }> | undefined)?.map(t => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Completion Date</Label>
                <Input type="date" value={recordForm.completionDate} onChange={e => setRecordForm(f => ({ ...f, completionDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Due Date</Label>
                <Input type="date" value={recordForm.dueDate} onChange={e => setRecordForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={recordForm.status} onValueChange={v => setRecordForm(f => ({ ...f, status: v as typeof recordForm.status }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="compliant">Compliant</SelectItem>
                  <SelectItem value="due_soon">Due Soon</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="missing">Missing</SelectItem>
                  <SelectItem value="pending_review">Pending Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Trainer Name</Label>
              <Input value={recordForm.trainerName} onChange={e => setRecordForm(f => ({ ...f, trainerName: e.target.value }))} placeholder="Jane Smith" />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={recordForm.notes} onChange={e => setRecordForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRecord(false)}>Cancel</Button>
            <Button onClick={handleAddRecord} disabled={creatingRecord}>{creatingRecord ? "Adding..." : "Add Record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddPracticum} onOpenChange={o => { if (!o) setShowAddPracticum(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Annual Practicum</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Practicum Year *</Label>
              <Input type="number" value={practicumForm.practicumYear} onChange={e => setPracticumForm(f => ({ ...f, practicumYear: e.target.value }))} min={2000} max={2100} />
            </div>
            <div className="space-y-1">
              <Label>Completion Date</Label>
              <Input type="date" value={practicumForm.completionDate} onChange={e => setPracticumForm(f => ({ ...f, completionDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Observed By</Label>
              <Input value={practicumForm.observedBy} onChange={e => setPracticumForm(f => ({ ...f, observedBy: e.target.value }))} placeholder="Trainer name" />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={practicumForm.marReviewCompleted} onChange={e => setPracticumForm(f => ({ ...f, marReviewCompleted: e.target.checked }))} className="h-4 w-4" />
                <span className="text-sm">MAR Review Completed</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={practicumForm.directObservationCompleted} onChange={e => setPracticumForm(f => ({ ...f, directObservationCompleted: e.target.checked }))} className="h-4 w-4" />
                <span className="text-sm">Direct Observation</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddPracticum(false)}>Cancel</Button>
            <Button onClick={handleAddPracticum} disabled={creatingPracticum}>{creatingPracticum ? "Adding..." : "Add Practicum"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRecordId} onOpenChange={o => { if (!o) setDeleteRecordId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Training Record</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this training record? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteRecordId) deleteTrainingRecord({ id: deleteRecordId }); }}
              disabled={deletingRecord}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingRecord ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletePracticumId} onOpenChange={o => { if (!o) setDeletePracticumId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Practicum</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this practicum record? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deletePracticumId) deletePracticum({ id: deletePracticumId }); }}
              disabled={deletingPracticum}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingPracticum ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
