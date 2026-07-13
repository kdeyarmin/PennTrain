import { useMemo, useRef, useState } from "react";
import { toLocalIsoDate } from "@/lib/dateUtils";
import {
  useListEmployeeCredentials, useCreateEmployeeCredential, useUpdateEmployeeCredential, useDeleteEmployeeCredential,
  type EmployeeCredential,
} from "@/hooks/useEmployeeCredentials";
import {
  useListCredentialDocuments, useUploadCredentialDocument, useCredentialDocumentSignedUrl, useDeleteCredentialDocument,
  type CredentialDocument,
} from "@/hooks/useCredentialDocuments";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useUrlState } from "@/hooks/useUrlState";
import { summarizeCredentialAnalytics } from "@/lib/credentialAnalytics";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, ShieldCheck, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Upload, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 15;

const CREDENTIAL_TYPE_OPTIONS: Array<{ value: EmployeeCredential["credential_type"]; label: string }> = [
  { value: "act34_criminal_history", label: "Act 34 Criminal History Clearance" },
  { value: "act73_fbi_fingerprint", label: "Act 73 FBI Fingerprint Clearance" },
  { value: "act33_child_abuse", label: "Act 33 Child Abuse Clearance" },
  { value: "rn_license", label: "RN License" },
  { value: "lpn_license", label: "LPN License" },
  { value: "nurse_aide_registry", label: "Nurse Aide Registry Status" },
  { value: "tb_screening", label: "TB Screening" },
  { value: "immunization", label: "Immunization" },
  { value: "i9_employment_eligibility", label: "I-9 Employment Eligibility" },
  { value: "other", label: "Other" },
];

function credentialTypeLabel(type: string): string {
  return CREDENTIAL_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type.replace(/_/g, " ");
}

// PATCH (Pennsylvania Access to Criminal History) and the PA Nurse Aide Registry are both
// manual, no-API web lookups -- there's nothing to integrate against, so "verification logging"
// just means recording which method + date an admin used, on the credential row itself.
const VERIFICATION_METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "patch_online", label: "PATCH Online Check (epatch.pa.gov)" },
  { value: "cna_registry_search", label: "PA Nurse Aide Registry Search" },
  { value: "paper_submission", label: "Paper Submission" },
  { value: "fbi_channeler", label: "FBI-Approved Channeler" },
  { value: "other", label: "Other" },
];

interface CredentialFormData {
  employeeId: string;
  credentialType: EmployeeCredential["credential_type"];
  credentialLabel: string;
  issuingAuthority: string;
  credentialNumber: string;
  issueDate: string;
  expirationDate: string;
  warningDays: string;
  status: EmployeeCredential["status"];
  notes: string;
  verificationMethod: string;
  lastVerifiedDate: string;
}

const EMPTY_FORM: CredentialFormData = {
  employeeId: "", credentialType: "act34_criminal_history", credentialLabel: "",
  issuingAuthority: "", credentialNumber: "", issueDate: "", expirationDate: "",
  warningDays: "90", status: "missing", notes: "",
  verificationMethod: "", lastVerifiedDate: "",
};

// Synced into the URL query string via useUrlState so navigating away from this page (or just
// reloading/sharing the link) and coming back preserves the filtered/paged view instead of
// resetting to these defaults.
const CREDENTIALS_FILTER_DEFAULTS = {
  facilityFilter: "all",
  employeeFilter: "all",
  statusFilter: "all",
  page: "1",
};

function CredentialDocuments({ credential, canManage, canDelete }: { credential: EmployeeCredential; canManage: boolean; canDelete: boolean }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: documents, isLoading } = useListCredentialDocuments({ credentialId: credential.id });
  const uploadDocument = useUploadCredentialDocument();
  const getSignedUrl = useCredentialDocumentSignedUrl();
  const deleteDocument = useDeleteCredentialDocument();
  const [deleteTarget, setDeleteTarget] = useState<CredentialDocument | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadDocument.mutateAsync({
        file,
        organizationId: credential.organization_id,
        facilityId: credential.facility_id,
        employeeId: credential.employee_id,
        credentialId: credential.id,
      });
      toast({ title: "Document uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (doc: NonNullable<typeof documents>[number]) => {
    try {
      const signedUrl = await getSignedUrl.mutateAsync(doc);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteDocument.mutate(deleteTarget, {
      onSuccess: () => { toast({ title: "Document deleted", variant: "success" }); setDeleteTarget(null); },
      onError: (err: Error) => toast({ title: "Failed to delete document", description: err.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[13px]">Evidence Documents</Label>
        {canManage && (
          <>
            <Button variant="outline" size="sm" disabled={uploadDocument.isPending} onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-3.5 w-3.5" /> {uploadDocument.isPending ? "Uploading..." : "Upload"}
            </Button>
            <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} />
          </>
        )}
      </div>
      {isLoading ? (
        <div className="h-10 bg-muted animate-pulse rounded" />
      ) : !documents?.length ? (
        <p className="text-sm text-muted-foreground">No documents uploaded for this credential.</p>
      ) : (
        <div className="space-y-1.5">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
              <span className="truncate">{doc.file_name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(doc)} aria-label="Download document">
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canDelete && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(doc)} aria-label="Delete document">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Evidence Document</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently destroy "{deleteTarget?.file_name}" as compliance evidence for this credential.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleteDocument.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteDocument.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function EmployeeCredentials() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [filters, setFilters] = useUrlState(CREDENTIALS_FILTER_DEFAULTS);
  const { facilityFilter, employeeFilter, statusFilter } = filters;
  const page = Math.max(1, Number(filters.page) || 1);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EmployeeCredential | null>(null);
  const [form, setForm] = useState<CredentialFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeCredential | null>(null);

  // Matches employee_credentials/employee_credential_documents RLS insert/update policies
  // (org_admin, facility_manager -- trainer is deliberately excluded from this module, unlike
  // most other compliance records, because clearance/license data is more sensitive).
  const canManage = ["org_admin", "facility_manager"].includes(user?.role ?? "");
  // The delete policies on both tables are narrower than insert/update -- org_admin only -- so
  // a facility_manager must not be shown a delete action that will always fail after confirmation.
  const canDelete = user?.role === "org_admin";

  const { data: facilities } = useListFacilities();
  const { data: employees } = useListEmployees();
  const { data: credentials, isLoading, isError, error, refetch } = useListEmployeeCredentials({
    facilityId: facilityFilter !== "all" ? facilityFilter : undefined,
    employeeId: employeeFilter !== "all" ? employeeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { mutate: createCredential, isPending: creating } = useCreateEmployeeCredential();
  const { mutate: updateCredential, isPending: updating } = useUpdateEmployeeCredential();
  const { mutate: deleteCredential, isPending: deleting } = useDeleteEmployeeCredential();

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const activeEmployees = useMemo(
    () => (employees ?? []).filter((e) => e.status === "active").sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employees],
  );

  const allCredentials = credentials ?? [];
  const credentialSummary = useMemo(() => summarizeCredentialAnalytics(
    allCredentials.map((c) => ({
      id: c.id,
      employee_id: c.employee_id,
      credential_type: c.credential_type,
      credential_label: c.credential_label,
      status: c.status,
      expiration_date: c.expiration_date,
      warning_days: c.warning_days,
      last_verified_date: c.last_verified_date,
    })),
    toLocalIsoDate(),
  ), [allCredentials]);
  const credentialById = useMemo(() => new Map(allCredentials.map((c) => [c.id, c])), [allCredentials]);
  const topRiskCredentials = credentialSummary.topRiskCredentialIds
    .map((id) => credentialById.get(id))
    .filter((c): c is EmployeeCredential => !!c);
  const sorted = [...allCredentials].sort((a, b) => (a.expiration_date ?? "9999").localeCompare(b.expiration_date ?? "9999"));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (credential: EmployeeCredential) => {
    setEditing(credential);
    setForm({
      employeeId: credential.employee_id,
      credentialType: credential.credential_type,
      credentialLabel: credential.credential_label ?? "",
      issuingAuthority: credential.issuing_authority ?? "",
      credentialNumber: credential.credential_number ?? "",
      issueDate: credential.issue_date ?? "",
      expirationDate: credential.expiration_date ?? "",
      warningDays: String(credential.warning_days),
      status: credential.status,
      notes: credential.notes ?? "",
      verificationMethod: credential.verification_method ?? "",
      lastVerifiedDate: credential.last_verified_date ?? "",
    });
    setShowForm(true);
  };

  const field = (k: keyof CredentialFormData, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.employeeId) {
      toast({ title: "Employee is required", variant: "destructive" });
      return;
    }
    const employee = employeeById.get(form.employeeId);
    if (!employee) return;

    const payload = {
      employee_id: employee.id,
      // organization_id/facility_id are re-stamped server-side from the employee row
      // (stamp_scope_from_employee) -- these are just placeholders satisfying the not-null
      // insert type.
      organization_id: employee.organization_id,
      facility_id: employee.facility_id,
      credential_type: form.credentialType,
      credential_label: form.credentialLabel || null,
      issuing_authority: form.issuingAuthority || null,
      credential_number: form.credentialNumber || null,
      issue_date: form.issueDate || null,
      expiration_date: form.expirationDate || null,
      warning_days: Number(form.warningDays) || 90,
      status: form.status,
      notes: form.notes || null,
      verification_method: form.verificationMethod || null,
      last_verified_date: form.lastVerifiedDate || null,
      // Stamped whenever a verification method is on the form -- "who last recorded a
      // verification, and when" (full history of prior values lives in audit_logs, same as every
      // other field on this table).
      ...(form.verificationMethod
        ? { verified_by_profile_id: user?.id ?? null, verified_at: new Date().toISOString() }
        : {}),
    };

    if (editing) {
      updateCredential(
        { id: editing.id, ...payload },
        {
          onSuccess: () => { toast({ title: "Credential updated" }); setShowForm(false); },
          onError: (e: Error) => toast({ title: "Failed to update credential", description: e.message, variant: "destructive" }),
        },
      );
    } else {
      createCredential(payload, {
        onSuccess: () => { toast({ title: "Credential added" }); setShowForm(false); setForm(EMPTY_FORM); },
        onError: (e: Error) => toast({ title: "Failed to add credential", description: e.message, variant: "destructive" }),
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteCredential(deleteTarget.id, {
      onSuccess: () => { toast({ title: "Credential deleted" }); setDeleteTarget(null); },
      onError: (e: Error) => toast({ title: "Failed to delete credential", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Credentials &amp; Clearances</h1>
          <p>Track staff background clearances, professional licensure, health screenings, and employment eligibility.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Credential
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <button type="button" className="premium-card p-4 text-left hover:border-destructive/40" onClick={() => setFilters({ statusFilter: "expired", page: "1" })}>
          <p className="text-xs font-medium text-muted-foreground">Expired</p>
          <p className="mt-1 text-2xl font-semibold text-destructive">{credentialSummary.expired}</p>
          <p className="mt-1 text-xs text-muted-foreground">Require immediate remediation.</p>
        </button>
        <button type="button" className="premium-card p-4 text-left hover:border-warning/40" onClick={() => setFilters({ statusFilter: "due_soon", page: "1" })}>
          <p className="text-xs font-medium text-muted-foreground">Due soon</p>
          <p className="mt-1 text-2xl font-semibold">{credentialSummary.dueSoon}</p>
          <p className="mt-1 text-xs text-muted-foreground">{credentialSummary.expiringWithin30Days} expire within 30 days.</p>
        </button>
        <button type="button" className="premium-card p-4 text-left hover:border-border" onClick={() => setFilters({ statusFilter: "missing", page: "1" })}>
          <p className="text-xs font-medium text-muted-foreground">Missing</p>
          <p className="mt-1 text-2xl font-semibold">{credentialSummary.missing}</p>
          <p className="mt-1 text-xs text-muted-foreground">Evidence has not been recorded.</p>
        </button>
        <div className="premium-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Employees with gaps</p>
          <p className="mt-1 text-2xl font-semibold">{credentialSummary.employeesWithGaps}</p>
          <p className="mt-1 text-xs text-muted-foreground">{credentialSummary.unverified} active records lack verification date.</p>
        </div>
      </div>

      {topRiskCredentials.length > 0 && (
        <div className="premium-card p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h2 className="text-sm font-semibold">Credential Risk Queue</h2>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {topRiskCredentials.map((credential) => {
              const emp = employeeById.get(credential.employee_id);
              return (
                <button key={credential.id} type="button" className="rounded-lg border p-3 text-left hover:bg-muted/40" onClick={() => openEdit(credential)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{emp ? `${emp.last_name}, ${emp.first_name}` : `Employee #${credential.employee_id.slice(0, 8)}`}</span>
                    <StatusBadge status={credential.status} type="training" />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{credential.credential_label || credentialTypeLabel(credential.credential_type)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Expiration: {credential.expiration_date ?? "No expiration"} · Last verified: {credential.last_verified_date ?? "Not recorded"}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="premium-card">
        <div className="filter-bar">
          <Select value={facilityFilter} onValueChange={(v) => setFilters({ facilityFilter: v, page: "1" })}>
            <SelectTrigger className="w-48 h-9 bg-card"><SelectValue placeholder="All Facilities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={employeeFilter} onValueChange={(v) => setFilters({ employeeFilter: v, page: "1" })}>
            <SelectTrigger className="w-48 h-9 bg-card"><SelectValue placeholder="All Employees" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {(employees ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setFilters({ statusFilter: v, page: "1" })}>
            <SelectTrigger className="w-48 h-9 bg-card"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["compliant", "due_soon", "expired", "missing", "not_applicable"].map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isError ? (
          <div className="p-6">
            <QueryError what="credentials" error={error} onRetry={() => refetch()} />
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No credentials found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {canManage ? "Add a credential to get started." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Credential</th>
                    <th>Number</th>
                    <th>Expiration</th>
                    <th>Status</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((c) => {
                    const emp = employeeById.get(c.employee_id);
                    return (
                      <tr key={c.id}>
                        <td>
                          <span className="font-medium text-foreground">
                            {emp ? `${emp.last_name}, ${emp.first_name}` : `Employee #${c.employee_id.slice(0, 8)}`}
                          </span>
                        </td>
                        <td className="text-muted-foreground">{c.credential_label || credentialTypeLabel(c.credential_type)}</td>
                        <td className="text-muted-foreground">{c.credential_number || "—"}</td>
                        <td className="text-muted-foreground">{c.expiration_date ?? "No expiration"}</td>
                        <td><StatusBadge status={c.status} type="training" /></td>
                        <td>
                          {(canManage || canDelete) && (
                            <div className="flex items-center gap-1">
                              {canManage && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)} aria-label="Edit credential">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canDelete && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(c)} aria-label="Delete credential">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)}</span> of {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setFilters({ page: String(Math.max(1, page - 1)) })} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setFilters({ page: String(Math.min(totalPages, page + 1)) })} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Credential" : "Add Credential"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Employee *</Label>
              <Select value={form.employeeId} onValueChange={(v) => field("employeeId", v)} disabled={!!editing}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.last_name}, {e.first_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Credential Type *</Label>
              <Select value={form.credentialType} onValueChange={(v) => field("credentialType", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREDENTIAL_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Label</Label>
              <Input value={form.credentialLabel} onChange={(e) => field("credentialLabel", e.target.value)} placeholder="e.g. Flu Shot 2026" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Issuing Authority</Label>
              <Input value={form.issuingAuthority} onChange={(e) => field("issuingAuthority", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Credential/License Number</Label>
              <Input value={form.credentialNumber} onChange={(e) => field("credentialNumber", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Issue Date</Label>
              <Input type="date" value={form.issueDate} onChange={(e) => field("issueDate", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Expiration Date</Label>
              <Input type="date" value={form.expirationDate} onChange={(e) => field("expirationDate", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Warning Days</Label>
              <Input type="number" min={1} value={form.warningDays} onChange={(e) => field("warningDays", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Verification Method</Label>
              <Select value={form.verificationMethod || "none"} onValueChange={(v) => field("verificationMethod", v === "none" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Not yet verified" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not yet verified</SelectItem>
                  {VERIFICATION_METHOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Last Verified Date</Label>
              <Input type="date" value={form.lastVerifiedDate} onChange={(e) => field("lastVerifiedDate", e.target.value)} className="h-9" />
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Status</Label>
              <Select value={form.status} onValueChange={(v) => field("status", v as CredentialFormData["status"])}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["compliant", "due_soon", "expired", "missing", "not_applicable"].map((s) => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Recalculated automatically overnight from the expiration date; set manually only to override.</p>
            </div>
            <div className="col-span-full space-y-1.5">
              <Label className="text-[13px]">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => field("notes", e.target.value)} placeholder="Optional notes" />
            </div>
            {editing && (
              <div className="col-span-full pt-2 border-t">
                <CredentialDocuments credential={editing} canManage={canManage} canDelete={canDelete} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updating} className="shadow-sm">
              {creating || updating ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this credential record and its attached documents. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
