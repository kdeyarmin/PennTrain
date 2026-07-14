import { useEffect, useRef, useState } from "react";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEmployeesPaginated, useCreateEmployee, useUpdateEmployee, useDeleteEmployee,
  type Employee, type EmployeeSortField,
} from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useInviteUser } from "@/hooks/useProfiles";
import { useUrlState } from "@/hooks/useUrlState";
import { EmployeeFormFields, EMPTY_EMPLOYEE_FORM, employeeToFormData, type EmpFormData } from "@/components/employees/EmployeeFormFields";
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
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { QueryError } from "@/components/QueryState";
import { Users, Search, ChevronLeft, ChevronRight, UserPlus, Pencil, Trash2, Upload } from "lucide-react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";

const PAGE_SIZE = 15;

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
  // Chunked-import protocol: the client resends the same CSV with an offset/limit and
  // the function reports the slice it processed plus where to continue.
  totalRows?: number;
  offset?: number;
  nextOffset?: number | null;
}

interface BulkImportProgress {
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
}

const BULK_IMPORT_CHUNK_SIZE = 50;

// Defaults for useUrlState -- every value must be a string, so page/sortField/sortDir round-trip
// as text and get parsed/cast back where they're used below. A value matching its default here is
// omitted from the URL entirely (see useUrlState's own doc comment), so the plain /employees link
// stays clean.
const EMPLOYEES_URL_DEFAULTS = {
  search: "",
  facilityId: "all",
  status: "all",
  sortField: "lastName",
  sortDir: "asc",
  page: "1",
};

export default function Employees() {
  const [urlState, setUrlState] = useUrlState(EMPLOYEES_URL_DEFAULTS);
  const facilityId = urlState.facilityId;
  const status = urlState.status;
  const sortField = urlState.sortField as EmployeeSortField;
  const sortDir = urlState.sortDir as "asc" | "desc";
  const page = Number(urlState.page) || 1;

  // Mirrors the free-text search box's current (undebounced) value so the input stays snappy;
  // the debounced copy below is what actually drives the server query.
  const [debouncedSearch, setDebouncedSearch] = useState(urlState.search);
  const [showForm, setShowForm] = useState(false);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);
  const [deleteEmp, setDeleteEmp] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmpFormData>(EMPTY_EMPLOYEE_FORM);
  const [sendPortalInvite, setSendPortalInvite] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkImportResponse | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkImportProgress | null>(null);
  const bulkCancelRef = useRef(false);

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
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  // Debounce the free-text box before it drives a server request, so typing doesn't fire a query
  // per keystroke; the page-reset on change below still happens immediately. The box's raw value
  // itself lives in the URL (urlState.search) so Back/Forward and reopening the page preserve it.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(urlState.search), 300);
    return () => clearTimeout(t);
  }, [urlState.search]);

  const {
    data: employeesPage,
    isLoading,
    isError: employeesError,
    error: employeesErrorDetail,
    refetch: refetchEmployees,
  } = useListEmployeesPaginated({
    facilityId: facilityId !== "all" ? facilityId : undefined,
    status: status !== "all" ? status : undefined,
    organizationId: viewingOrgId ?? undefined,
    search: debouncedSearch,
    sortField,
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: facilities } = useListFacilities({ organizationId: viewingOrgId ?? undefined });

  const { mutate: createEmployee, isPending: creating } = useCreateEmployee();
  const { mutate: updateEmployee, isPending: updating } = useUpdateEmployee();
  const { mutate: deleteEmployee, isPending: deleting } = useDeleteEmployee();
  const { mutate: inviteUser, isPending: inviting } = useInviteUser();

  const rows = employeesPage?.rows ?? [];
  const totalCount = employeesPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function toggleSort(field: EmployeeSortField) {
    if (sortField === field) setUrlState({ sortDir: sortDir === "asc" ? "desc" : "asc", page: "1" });
    else setUrlState({ sortField: field, sortDir: "asc", page: "1" });
  }

  const sortIndicator = (field: EmployeeSortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // Defaults the new-employee form's facility to whichever Facility filter is currently active
  // (when one is selected), instead of always resetting to none -- an admin who has filtered the
  // roster down to one facility is almost always about to add someone at that same facility.
  const openCreate = (withPortalInvite = false) => {
    setEditEmp(null);
    setForm({ ...EMPTY_EMPLOYEE_FORM, facilityId: facilityId !== "all" ? facilityId : "none" });
    setSendPortalInvite(withPortalInvite);
    setShowForm(true);
  };

  const closeEmployeeForm = () => {
    setShowForm(false);
    setEditEmp(null);
    setForm(EMPTY_EMPLOYEE_FORM);
    setSendPortalInvite(false);
  };

  // Dashboard's "Add Employee" quick action links here with ?action=add, expecting this
  // dialog to open automatically. Runs once on mount only -- a single deep-link action
  // shouldn't reopen the dialog every time the query string changes while the user is
  // already working on this page.
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const action = params.get("action");
    if (action === "add") {
      // The guided/dashboard onboarding action opens the practical combined
      // flow by default: roster record plus a linked self-service login.
      openCreate(true);
    } else if (action === "bulk-import" && canManage) {
      openBulkImport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (e: React.MouseEvent, emp: Employee) => {
    e.preventDefault();
    e.stopPropagation();
    setEditEmp(emp);
    setForm(employeeToFormData(emp));
    setSendPortalInvite(false);
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
    if (!editEmp && sendPortalInvite && !form.email.trim()) {
      toast({ title: "An email is required to send a portal invite", variant: "destructive" });
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
      notes: form.notes || null,
      scheduled_hours_per_week: form.scheduledHoursPerWeek.trim() ? Number(form.scheduledHoursPerWeek) : null,
      worker_type: form.workerType,
    };
    if (editEmp) {
      updateEmployee(
        { id: editEmp.id, ...payload, facility_id: form.facilityId !== "none" ? form.facilityId : editEmp.facility_id },
        {
          onSuccess: () => { toast({ title: "Employee updated" }); setShowForm(false); setEditEmp(null); },
          onError: (e: Error) => toast({ title: "Failed to update employee", description: e.message, variant: "destructive" }),
        },
      );
    } else {
      const selectedFacility = facilities?.find((facility) => facility.id === form.facilityId);
      const organizationId = user?.role === "platform_admin"
        ? selectedFacility?.organization_id
        : user?.organizationId;
      if (!organizationId) {
        toast({
          title: "Select a facility in an organization first",
          description: "The employee must belong to an organization before they can be created.",
          variant: "destructive",
        });
        return;
      }
      createEmployee(
        { ...payload, facility_id: form.facilityId, organization_id: organizationId },
        {
          onSuccess: (createdEmployee) => {
            if (!sendPortalInvite) {
              toast({ title: "Employee created" });
              closeEmployeeForm();
              return;
            }

            const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
            inviteUser(
              {
                email: createdEmployee.email!,
                firstName: createdEmployee.first_name,
                lastName: createdEmployee.last_name,
                role: "employee",
                organizationId: createdEmployee.organization_id,
                employeeId: createdEmployee.id,
                redirectTo: `${window.location.origin}${baseUrl}/reset-password`,
              },
              {
                onSuccess: () => {
                  toast({
                    title: "Employee created and portal invite sent",
                    description: `${createdEmployee.email} can use the invite to set a password and access self-service.`,
                  });
                  closeEmployeeForm();
                },
                onError: (e: Error) => {
                  toast({
                    title: "Employee created, but the portal invite failed",
                    description: `${e.message} Open the employee record to retry the invite.`,
                    variant: "destructive",
                  });
                  closeEmployeeForm();
                },
              },
            );
          },
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

  // Imports run in chunks of BULK_IMPORT_CHUNK_SIZE rows: the same CSV is sent each call
  // with an offset, so no single request has to survive a thousand row inserts, the
  // progress bar advances as each slice lands, and Cancel takes effect between chunks
  // (rows already imported stay imported -- each row is independent).
  const handleBulkImport = async () => {
    if (!bulkFile) {
      toast({ title: "Choose a CSV file first", variant: "destructive" });
      return;
    }
    setBulkImporting(true);
    setBulkResult(null);
    setBulkError(null);
    setBulkProgress(null);
    bulkCancelRef.current = false;
    const aggregate: BulkImportResponse = { success: true, total: 0, succeeded: 0, failed: 0, results: [] };
    let anySucceeded = false;
    try {
      const csv = await bulkFile.text();
      let offset = 0;
      let totalRows: number | null = null;
      for (;;) {
        const body: { csv: string; organization_id?: string; offset: number; limit: number } = {
          csv,
          offset,
          limit: BULK_IMPORT_CHUNK_SIZE,
        };
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
          setBulkError(aggregate.total > 0 ? `${message} (stopped after ${aggregate.total} rows)` : message);
          if (aggregate.total > 0) setBulkResult({ ...aggregate });
          return;
        }
        if (!data) {
          setBulkError("The import function returned no data.");
          return;
        }
        aggregate.total += data.total;
        aggregate.succeeded += data.succeeded;
        aggregate.failed += data.failed;
        aggregate.results = aggregate.results.concat(data.results);
        anySucceeded = anySucceeded || data.succeeded > 0;
        totalRows = data.totalRows ?? totalRows ?? data.total;
        setBulkProgress({
          processed: aggregate.total,
          total: totalRows ?? aggregate.total,
          succeeded: aggregate.succeeded,
          failed: aggregate.failed,
        });
        if (data.nextOffset === null || data.nextOffset === undefined) break;
        offset = data.nextOffset;
        if (bulkCancelRef.current) {
          setBulkError(`Import cancelled after ${aggregate.total} of ${totalRows ?? "?"} rows. Rows already imported were kept.`);
          break;
        }
      }
      setBulkResult({ ...aggregate });
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    } finally {
      if (anySucceeded) {
        queryClient.invalidateQueries({ queryKey: ["employees"] });
      }
      setBulkImporting(false);
      setBulkProgress(null);
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
            <Button onClick={() => openCreate()} className="shadow-sm">
              <UserPlus className="mr-2 h-4 w-4" /> Add Employee
            </Button>
          </div>
        )}
      </div>

      <div className="premium-card">
        <div className="filter-bar">
          <div className="relative w-full min-w-0 flex-1 sm:min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employees..."
              value={urlState.search}
              onChange={e => setUrlState({ search: e.target.value, page: "1" })}
              className="pl-9 h-9 bg-card"
            />
          </div>
          <Select value={facilityId} onValueChange={v => setUrlState({ facilityId: v, page: "1" })}>
            <SelectTrigger className="w-full h-9 bg-card sm:w-48">
              <SelectValue placeholder="All Facilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities?.map(f => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => setUrlState({ status: v, page: "1" })}>
            <SelectTrigger className="w-full h-9 bg-card sm:w-40">
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

        {employeesError ? (
          <div className="p-6">
            <QueryError what="employees" error={employeesErrorDetail} onRetry={() => refetchEmployees()} />
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No employees found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4 md:hidden">
              {rows.map((emp) => (
                <Link key={emp.id} href={`${basePath}/${emp.id}`}>
                  <article className="rounded-lg border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium">{emp.first_name} {emp.last_name}</h3>
                        <p className="truncate text-sm text-muted-foreground">{emp.job_title ?? "No role listed"}</p>
                      </div>
                      <StatusBadge status={emp.status} type="employee" />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Hire date</dt>
                        <dd className="mt-0.5 font-medium">{formatDateForDisplay(emp.hire_date)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Workforce flags</dt>
                        <dd className="mt-0.5 font-medium">
                          {[emp.administers_medications && "Med Admin", emp.trainer_status && "Trainer"].filter(Boolean).join(", ") || "None"}
                        </dd>
                      </div>
                    </dl>
                  </article>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
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
                  {rows.map(emp => (
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
                        {formatDateForDisplay(emp.hire_date)}
                      </td>
                      <td>
                        <div className="flex gap-1.5">
                          {emp.administers_medications && (
                            <Badge variant="secondary" className="text-[10px] font-medium bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">Med Admin</Badge>
                          )}
                          {emp.trainer_status && (
                            <Badge variant="outline" className="text-[10px] font-medium">Trainer</Badge>
                          )}
                          {emp.worker_type !== "regular" && (
                            <Badge variant="outline" className="text-[10px] font-medium capitalize">{emp.worker_type}</Badge>
                          )}
                          {!emp.cleared_for_unsupervised_duty && (
                            <Badge className="text-[10px] font-medium bg-warning text-warning-foreground hover:bg-warning/80" variant="outline">
                              Onboarding
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-0.5 justify-end">
                          {canManage && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={e => openEdit(e, emp)} aria-label={`Edit ${emp.first_name} ${emp.last_name}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={e => { e.preventDefault(); e.stopPropagation(); setDeleteEmp(emp); }}
                              aria-label={`Delete ${emp.first_name} ${emp.last_name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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
                Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)}</span> of {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setUrlState({ page: String(Math.max(1, page - 1)) })} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[13px] text-muted-foreground px-2">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setUrlState({ page: String(Math.min(totalPages, page + 1)) })} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>{totalCount} employee{totalCount !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showForm} onOpenChange={o => { if (!o) closeEmployeeForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEmp ? "Edit Employee" : "Add Employee"}</DialogTitle>
          </DialogHeader>
          <EmployeeFormFields
            form={form}
            onChange={field}
            facilities={facilities}
            facilityFieldMode={editEmp ? "edit-keep-current" : "create"}
          />
          {!editEmp && (
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox
                id="send-portal-invite"
                checked={sendPortalInvite}
                onCheckedChange={(checked) => setSendPortalInvite(checked === true)}
              />
              <label htmlFor="send-portal-invite" className="cursor-pointer text-[13px] leading-snug">
                <span className="font-medium">Send portal invite</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Create and link the employee's self-service account so they can set a password,
                  view training, schedules, credentials, and assigned work. An email is required.
                </span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeEmployeeForm}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updating || inviting} className="shadow-sm">
              {inviting ? "Sending invite..." : creating || updating ? "Saving..." : editEmp ? "Save Changes" : sendPortalInvite ? "Create & Send Invite" : "Create Employee"}
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
              <span className="font-medium text-foreground">first_name, last_name, job_title, facility_name</span>.
              Facility names are matched case-insensitively against your organization's facilities (e.g. "Sunrise Manor").
              A raw <span className="font-medium text-foreground">facility_id</span> column is also still accepted in place of
              facility_name, for already-integrated callers. Optional columns: email, phone, employee_number, department,
              hire_date, status, administers_medications, trainer_status. Up to 1,000 rows per file.
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

            {bulkImporting && bulkProgress && (
              <div className="space-y-1.5">
                <Progress value={bulkProgress.total > 0 ? (bulkProgress.processed / bulkProgress.total) * 100 : 0} />
                <p className="text-[12px] text-muted-foreground">
                  Imported {bulkProgress.processed} of {bulkProgress.total} rows
                  {" "}({bulkProgress.succeeded} succeeded{bulkProgress.failed > 0 ? `, ${bulkProgress.failed} failed` : ""})...
                </p>
              </div>
            )}

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
            <Button
              variant="outline"
              onClick={() => {
                if (bulkImporting) bulkCancelRef.current = true;
                else setShowBulkImport(false);
              }}
            >
              {bulkImporting ? "Stop Import" : bulkResult ? "Close" : "Cancel"}
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
