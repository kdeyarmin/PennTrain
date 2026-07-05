import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEmployees, useCreateEmployee, useUpdateEmployee, useDeleteEmployee,
  type Employee,
} from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Users, Search, ChevronLeft, ChevronRight, UserPlus, Pencil, Trash2, Upload } from "lucide-react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";

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
}

const EMPTY_EMP: EmpFormData = {
  firstName: "", lastName: "", email: "", phone: "", jobTitle: "",
  department: "", employeeNumber: "", facilityId: "none", hireDate: "",
  status: "active", administersMedications: false, trainerStatus: false,
};

const PAGE_SIZE = 15;
type SortField = "lastName" | "status" | "hireDate" | "jobTitle";

// Mirrors the per-row result shape returned by supabase/functions/bulk-import-employees.
interface BulkImportRowResult {
  row: number;
  success: boolean;
  error?: string;
  employee_id?: string;
}

interface BulkImportResponse {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: BulkImportRowResult[];
}

export default function Employees() {
  const [search, setSearch] = useState("");
  const [facilityId, setFacilityId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("lastName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);
  const [deleteEmp, setDeleteEmp] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmpFormData>(EMPTY_EMP);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkImportResponse | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Query string, e.g. "?action=add" -- distinct from the free-text `search` state above,
  // which is the employee name/role/department search box.
  const locationSearch = useSearch();
  const basePath = user?.role === "platform_admin" ? "/admin/employees"
    : user?.role === "trainer" ? "/trainer/employees"
    : "/app/employees";

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: employees, isLoading } = useListEmployees({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    status: status !== "all" ? status : undefined,
    organizationId: viewingOrgId ?? undefined,
  });
  const { data: facilities } = useListFacilities({ organizationId: viewingOrgId ?? undefined });

  const { mutate: createEmployee, isPending: creating } = useCreateEmployee();
  const { mutate: updateEmployee, isPending: updating } = useUpdateEmployee();
  const { mutate: deleteEmployee, isPending: deleting } = useDeleteEmployee();

  const allEmployees = employees ?? [];

  const filtered = allEmployees.filter(e => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      e.first_name.toLowerCase().includes(s) ||
      e.last_name.toLowerCase().includes(s) ||
      (e.job_title ?? "").toLowerCase().includes(s) ||
      (e.department ?? "").toLowerCase().includes(s)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "lastName") {
      cmp = `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
    } else if (sortField === "status") {
      cmp = a.status.localeCompare(b.status);
    } else if (sortField === "jobTitle") {
      cmp = (a.job_title ?? "").localeCompare(b.job_title ?? "");
    } else if (sortField === "hireDate") {
      cmp = (a.hire_date ?? "").localeCompare(b.hire_date ?? "");
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const openCreate = () => {
    setEditEmp(null);
    setForm(EMPTY_EMP);
    setShowForm(true);
  };

  // Dashboard's "Add Employee" quick action links here with ?action=add, expecting this
  // dialog to open automatically. Runs once on mount only -- a single deep-link action
  // shouldn't reopen the dialog every time the query string changes while the user is
  // already working on this page.
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    if (params.get("action") === "add") {
      openCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (e: React.MouseEvent, emp: Employee) => {
    e.preventDefault();
    e.stopPropagation();
    setEditEmp(emp);
    setForm({
      firstName: emp.first_name,
      lastName: emp.last_name,
      email: emp.email ?? "",
      phone: emp.phone ?? "",
      jobTitle: emp.job_title ?? "",
      department: emp.department ?? "",
      employeeNumber: emp.employee_number ?? "",
      facilityId: emp.facility_id ?? "none",
      hireDate: emp.hire_date ?? "",
      status: emp.status as EmpFormData["status"],
      administersMedications: emp.administers_medications ?? false,
      trainerStatus: emp.trainer_status ?? false,
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    if (!editEmp && form.facilityId === "none") {
      toast({ title: "A facility is required", variant: "destructive" });
      return;
    }
    const payload = {
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      email: form.email || null,
      phone: form.phone || null,
      job_title: form.jobTitle || "",
      department: form.department || null,
      employee_number: form.employeeNumber || null,
      hire_date: form.hireDate || null,
      status: form.status,
      administers_medications: form.administersMedications,
      trainer_status: form.trainerStatus,
    };
    if (editEmp) {
      updateEmployee(
        { id: editEmp.id, ...payload, facility_id: form.facilityId !== "none" ? form.facilityId : editEmp.facility_id },
        {
          onSuccess: () => { toast({ title: "Employee updated" }); setShowForm(false); setEditEmp(null); },
          onError: (e: Error) => toast({ title: "Failed to update employee", description: e.message, variant: "destructive" }),
        },
      );
    } else if (user?.organizationId) {
      createEmployee(
        { ...payload, facility_id: form.facilityId, organization_id: user.organizationId },
        {
          onSuccess: () => { toast({ title: "Employee created" }); setShowForm(false); setForm(EMPTY_EMP); },
          onError: (e: Error) => toast({ title: "Failed to create employee", description: e.message, variant: "destructive" }),
        },
      );
    }
  };

  const field = (k: keyof EmpFormData, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  const openBulkImport = () => {
    setBulkFile(null);
    setBulkResult(null);
    setBulkError(null);
    setShowBulkImport(true);
  };

  const handleBulkImport = async () => {
    if (!bulkFile) {
      toast({ title: "Choose a CSV file first", variant: "destructive" });
      return;
    }
    setBulkImporting(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const csv = await bulkFile.text();
      const body: { csv: string; organization_id?: string } = { csv };
      // organization_id is only read by the function when the caller is platform_admin --
      // every other role's own profile.organization_id is used server-side automatically.
      if (user?.role === "platform_admin" && viewingOrgId) {
        body.organization_id = viewingOrgId;
      }
      const { data, error } = await supabase.functions.invoke<BulkImportResponse>("bulk-import-employees", { body });
      if (error) {
        let message = error.message ?? "Bulk import failed";
        if (error instanceof FunctionsHttpError) {
          try {
            const errBody = await error.context.json();
            if (errBody && typeof errBody.error === "string") message = errBody.error;
          } catch {
            // Response body wasn't JSON -- fall back to the generic error message above.
          }
        }
        setBulkError(message);
        return;
      }
      if (!data) {
        setBulkError("The import function returned no data.");
        return;
      }
      setBulkResult(data);
      if (data.succeeded > 0) {
        queryClient.invalidateQueries({ queryKey: ["employees"] });
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Employees</h1>
          <p>Manage staff and track their compliance status.</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={openBulkImport} className="shadow-sm">
              <Upload className="mr-2 h-4 w-4" /> Bulk Import
            </Button>
            <Button onClick={openCreate} className="shadow-sm">
              <UserPlus className="mr-2 h-4 w-4" /> Add Employee
            </Button>
          </div>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employees..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <Select value={facilityId} onValueChange={v => { setFacilityId(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-9 bg-card">
              <SelectValue placeholder="All Facilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map(f => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9 bg-card">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
              <SelectItem value="on_leave">On Leave</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No employees found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => toggleSort("lastName")} onKeyDown={e => e.key === "Enter" && toggleSort("lastName")} tabIndex={0} role="columnheader" aria-sort={sortField === "lastName" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Name{sortIndicator("lastName")}
                    </th>
                    <th className="sortable" onClick={() => toggleSort("jobTitle")} onKeyDown={e => e.key === "Enter" && toggleSort("jobTitle")} tabIndex={0} role="columnheader" aria-sort={sortField === "jobTitle" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Role{sortIndicator("jobTitle")}
                    </th>
                    <th className="sortable" onClick={() => toggleSort("status")} onKeyDown={e => e.key === "Enter" && toggleSort("status")} tabIndex={0} role="columnheader" aria-sort={sortField === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Status{sortIndicator("status")}
                    </th>
                    <th className="sortable" onClick={() => toggleSort("hireDate")} onKeyDown={e => e.key === "Enter" && toggleSort("hireDate")} tabIndex={0} role="columnheader" aria-sort={sortField === "hireDate" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      Hire Date{sortIndicator("hireDate")}
                    </th>
                    <th>Tags</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(emp => (
                    <tr key={emp.id}>
                      <td>
                        <Link href={`${basePath}/${emp.id}`}>
                          <div className="flex items-center gap-3 cursor-pointer">
                            <div className="h-8 w-8 rounded-full bg-primary/8 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0">
                              {emp.first_name[0]}{emp.last_name[0]}
                            </div>
                            <div>
                              <span className="font-medium text-foreground hover:text-primary transition-colors">
                                {emp.last_name}, {emp.first_name}
                              </span>
                              {emp.email && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">{emp.email}</p>
                              )}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="text-muted-foreground">{emp.job_title ?? "—"}</td>
                      <td>
                        <StatusBadge status={emp.status} type="employee" />
                      </td>
                      <td className="text-muted-foreground">
                        {emp.hire_date ? new Date(emp.hire_date).toLocaleDateString() : "—"}
                      </td>
                      <td>
                        <div className="flex gap-1.5">
                          {emp.administers_medications && (
                            <Badge variant="secondary" className="text-[10px] font-medium bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">Med Admin</Badge>
                          )}
                          {emp.trainer_status && (
                            <Badge variant="outline" className="text-[10px] font-medium">Trainer</Badge>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-0.5 justify-end">
                          {canManage && (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={e => openEdit(e, emp)} aria-label={`Edit ${emp.first_name} ${emp.last_name}`}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={e => { e.preventDefault(); e.stopPropagation(); setDeleteEmp(emp); }}
                                aria-label={`Delete ${emp.first_name} ${emp.last_name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Link href={`${basePath}/${emp.id}`}>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 cursor-pointer" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border/60">
              <p className="text-[13px] text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)}</span> of {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>{filtered.length} employee{filtered.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setEditEmp(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEmp ? "Edit Employee" : "Add Employee"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">First Name *</Label>
              <Input value={form.firstName} onChange={e => field("firstName", e.target.value)} placeholder="Jane" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Last Name *</Label>
              <Input value={form.lastName} onChange={e => field("lastName", e.target.value)} placeholder="Smith" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Email</Label>
              <Input type="email" value={form.email} onChange={e => field("email", e.target.value)} placeholder="jane@example.com" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Phone</Label>
              <Input value={form.phone} onChange={e => field("phone", e.target.value)} placeholder="(215) 555-0100" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Job Title</Label>
              <Input value={form.jobTitle} onChange={e => field("jobTitle", e.target.value)} placeholder="Medication Aide" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Department</Label>
              <Input value={form.department} onChange={e => field("department", e.target.value)} placeholder="Nursing" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Employee Number</Label>
              <Input value={form.employeeNumber} onChange={e => field("employeeNumber", e.target.value)} placeholder="EMP-001" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Facility{!editEmp && " *"}</Label>
              <Select value={form.facilityId} onValueChange={v => field("facilityId", v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select facility" /></SelectTrigger>
                <SelectContent>
                  {editEmp && <SelectItem value="none">Keep current</SelectItem>}
                  {facilities?.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Hire Date</Label>
              <Input type="date" value={form.hireDate} onChange={e => field("hireDate", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Status</Label>
              <Select value={form.status} onValueChange={v => field("status", v as EmpFormData["status"])}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-full flex gap-6 pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.administersMedications}
                  onChange={e => field("administersMedications", e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <span className="text-[13px]">Administers Medications</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.trainerStatus}
                  onChange={e => field("trainerStatus", e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <span className="text-[13px]">Designated Trainer</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditEmp(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updating} className="shadow-sm">
              {creating || updating ? "Saving..." : editEmp ? "Save Changes" : "Create Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkImport} onOpenChange={o => { if (!o) setShowBulkImport(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Import Employees</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Upload a CSV file with a header row. Required columns:{" "}
              <span className="font-medium text-foreground">first_name, last_name, job_title, facility_id</span>.
              Optional columns: email, phone, employee_number, department, hire_date, status, administers_medications, trainer_status.
              Up to 1,000 rows per file.
            </p>
            <div className="space-y-1.5">
              <Label className="text-[13px]">CSV File</Label>
              <input
                type="file"
                accept=".csv"
                onChange={e => { setBulkFile(e.target.files?.[0] ?? null); setBulkResult(null); setBulkError(null); }}
                className="block w-full text-[13px] text-muted-foreground file:mr-3 file:h-8 file:px-3 file:rounded-md file:border-0 file:bg-primary/10 file:text-primary file:text-[13px] file:font-medium file:cursor-pointer cursor-pointer"
              />
            </div>

            {bulkError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
                {bulkError}
              </div>
            )}

            {bulkResult && (
              <div className="space-y-2">
                <div
                  className={`rounded-md border p-3 text-[13px] font-medium ${
                    bulkResult.failed === 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : bulkResult.succeeded === 0
                        ? "border-destructive/30 bg-destructive/5 text-destructive"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {bulkResult.succeeded} of {bulkResult.total} row{bulkResult.total === 1 ? "" : "s"} imported successfully
                  {bulkResult.failed > 0 && ` — ${bulkResult.failed} failed`}
                </div>
                {bulkResult.failed > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Row Errors</Label>
                    <ScrollArea className="h-40 rounded-md border">
                      <div className="p-3 space-y-2">
                        {bulkResult.results.filter(r => !r.success).map(r => (
                          <p key={r.row} className="text-[12px] text-muted-foreground">
                            <span className="font-medium text-foreground">Row {r.row}:</span> {r.error}
                          </p>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkImport(false)}>
              {bulkResult ? "Close" : "Cancel"}
            </Button>
            <Button onClick={handleBulkImport} disabled={bulkImporting || !bulkFile} className="shadow-sm">
              {bulkImporting ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteEmp} onOpenChange={o => { if (!o) setDeleteEmp(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteEmp?.first_name} {deleteEmp?.last_name}? This will permanently remove their record and all associated training data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteEmp) return;
                deleteEmployee(deleteEmp.id, {
                  onSuccess: () => { toast({ title: "Employee deleted" }); setDeleteEmp(null); },
                  onError: (e: Error) => toast({ title: "Failed to delete employee", description: e.message, variant: "destructive" }),
                });
              }}
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
