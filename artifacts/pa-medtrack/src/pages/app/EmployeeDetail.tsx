import { useState, useRef } from "react";
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
import { ArrowLeft, User, CalendarCheck, BookOpen, Clock, Pencil, Plus, Trash2, FileText, Upload, Download, Printer, Activity } from "lucide-react";
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

interface TrainingDocument {
  id: number;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number | null;
  documentType: string;
  createdAt: string;
  uploadedByUserId: number | null;
  uploadedByName: string | null;
}

interface AuditLogEntry {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
  userId: number | null;
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
  documents: TrainingDocument[];
  overallStatus: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  certificate: "Certificate",
  roster: "Roster",
  practicum_form: "Practicum Form",
  transcript: "Transcript",
  other: "Other",
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAuditAction(entry: AuditLogEntry): string {
  const entityLabel = entry.entityType.replace(/_/g, " ");
  switch (entry.action) {
    case "create": return `Created ${entityLabel} record`;
    case "update": return `Updated ${entityLabel} record`;
    case "delete": return `Deleted ${entityLabel} record`;
    case "verify": return `Verified ${entityLabel} record`;
    default: return `${entry.action} on ${entityLabel}`;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
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
  const [showUploadCert, setShowUploadCert] = useState(false);
  const [uploadDocType, setUploadDocType] = useState("certificate");
  const [uploading, setUploading] = useState(false);
  const [printingTranscript, setPrintingTranscript] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const { data: auditLogs } = useQuery<AuditLogEntry[]>({
    queryKey: ["employee-audit-logs", id],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs?entityType=employee&entityId=${id}&limit=20`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && canManage,
  });

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

  const handleUploadCert = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !employee) return;
    if (!employee.facilityId) {
      toast({ title: "Employee has no facility assigned", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("facilityId", String(employee.facilityId));
      formData.append("employeeId", String(employee.id));
      formData.append("documentType", uploadDocType);
      const res = await fetch("/api/documents", { method: "POST", credentials: "include", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      toast({ title: "Document uploaded successfully" });
      queryClient.invalidateQueries({ queryKey: ["employee-compliance", id] });
      setShowUploadCert(false);
      setUploadDocType("certificate");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePrintTranscript = async () => {
    if (!employee || !id) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast({ title: "Please allow popups to print", variant: "destructive" }); return; }
    printWindow.document.write("<p>Loading transcript...</p>");
    setPrintingTranscript(true);
    try {
      const res = await fetch(`/api/employees/${id}/transcript`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch transcript");
      const data = await res.json();
      const esc = (s: string | null | undefined) => {
        if (!s) return "—";
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      };
      const rows = (data.trainingRecords || []).map((r: { trainingType?: { name: string }; completionDate?: string; dueDate?: string; status?: string }) =>
        `<tr><td style="padding:6px 12px;border:1px solid #ddd">${esc(r.trainingType?.name)}</td><td style="padding:6px 12px;border:1px solid #ddd">${esc(r.completionDate)}</td><td style="padding:6px 12px;border:1px solid #ddd">${esc(r.dueDate)}</td><td style="padding:6px 12px;border:1px solid #ddd">${esc(r.status)}</td></tr>`
      ).join("");
      const practicumRows = (data.practicums || []).map((p: { practicumYear: number; completionDate?: string; status?: string; observedBy?: string }) =>
        `<tr><td style="padding:6px 12px;border:1px solid #ddd">${esc(String(p.practicumYear))}</td><td style="padding:6px 12px;border:1px solid #ddd">${p.completionDate ? esc(p.completionDate) : "Pending"}</td><td style="padding:6px 12px;border:1px solid #ddd">${esc(p.status)}</td><td style="padding:6px 12px;border:1px solid #ddd">${esc(p.observedBy)}</td></tr>`
      ).join("");
      const empName = esc(`${data.employee.firstName} ${data.employee.lastName}`);
      const empTitle = esc(data.employee.jobTitle);
      const empNum = esc(data.employee.employeeNumber) || "N/A";
      printWindow.document.write(`<!DOCTYPE html><html><head><title>Training Transcript — ${empName}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#333}h1{font-size:18px;margin-bottom:4px}h2{font-size:15px;margin-top:24px;margin-bottom:8px;color:#555}table{border-collapse:collapse;width:100%}th{background:#f5f5f5;text-align:left;padding:8px 12px;border:1px solid #ddd;font-size:13px}td{font-size:13px}.meta{color:#666;font-size:13px;margin-bottom:16px}@media print{body{padding:0}}</style></head><body><h1>Training Transcript</h1><p class="meta">${empName} — ${empTitle}<br/>Employee #${empNum} | Generated ${new Date().toLocaleDateString()}</p><h2>Training Records</h2><table><thead><tr><th>Training Type</th><th>Completed</th><th>Due Date</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#999">No training records</td></tr>'}</tbody></table><h2>Annual Practicums</h2><table><thead><tr><th>Year</th><th>Completed</th><th>Status</th><th>Observer</th></tr></thead><tbody>${practicumRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#999">No practicums</td></tr>'}</tbody></table></body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (err) {
      toast({ title: "Failed to print transcript", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPrintingTranscript(false);
    }
  };

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
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={openEditEmp}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowUploadCert(true)}>
              <Upload className="mr-2 h-3.5 w-3.5" /> Upload Certificate
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrintTranscript} disabled={printingTranscript}>
              <Printer className="mr-2 h-3.5 w-3.5" /> {printingTranscript ? "Loading..." : "Print Transcript"}
            </Button>
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!summary?.documents?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium text-sm">No documents uploaded</p>
              <p className="text-xs mt-1">Upload certificates and compliance documents using the "Upload Certificate" button above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {summary.documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-8 w-8 shrink-0 text-primary/70" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{doc.fileName}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}</Badge>
                        <span className="text-xs text-muted-foreground">{formatFileSize(doc.fileSize)}</span>
                        <span className="text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</span>
                        {doc.uploadedByName && <span className="text-xs text-muted-foreground">by {doc.uploadedByName}</span>}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = doc.fileUrl;
                      a.download = doc.fileName;
                      a.click();
                    }}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogs && auditLogs.length > 0 ? (
              <div className="relative">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-4">
                  {auditLogs.slice(0, 10).map(log => (
                    <div key={log.id} className="flex items-start gap-4 relative pl-8">
                      <div className="absolute left-1.5 top-1 h-3 w-3 rounded-full bg-primary/20 border-2 border-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{formatAuditAction(log)}</p>
                        <p className="text-xs text-muted-foreground">{timeAgo(log.createdAt)} — {new Date(log.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No recent activity recorded</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showUploadCert} onOpenChange={o => { if (!o) setShowUploadCert(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Document Type</Label>
              <Select value={uploadDocType} onValueChange={setUploadDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="certificate">Certificate</SelectItem>
                  <SelectItem value="roster">Roster</SelectItem>
                  <SelectItem value="practicum_form">Practicum Form</SelectItem>
                  <SelectItem value="transcript">Transcript</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Choose File (PDF, JPG, PNG)"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleUploadCert}
            />
            <p className="text-xs text-muted-foreground text-center">Max 20MB. Accepted: PDF, JPG, PNG</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadCert(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
