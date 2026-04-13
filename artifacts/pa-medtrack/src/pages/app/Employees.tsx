import { useState } from "react";
import {
  useListEmployees, useListFacilities,
  useCreateEmployee, useUpdateEmployee, useDeleteEmployee
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Users, Search, ChevronLeft, ChevronRight, UserPlus, Pencil, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  department?: string | null;
  status: string;
  facilityId?: number | null;
  administersMedications?: boolean;
  trainerStatus?: boolean;
  hireDate?: string | null;
  email?: string | null;
  phone?: string | null;
  employeeNumber?: string | null;
};

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

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const basePath = user?.role === "platform_admin" ? "/admin/employees"
    : user?.role === "trainer" ? "/trainer/employees"
    : "/app/employees";

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");

  const { data: employees, isLoading } = useListEmployees({
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
    status: status && status !== "all" ? status as "active" | "inactive" | "terminated" | "on_leave" : undefined,
  });
  const { data: facilities } = useListFacilities({});

  const { mutate: createEmployee, isPending: creating } = useCreateEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee created" });
        queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
        setShowForm(false);
        setForm(EMPTY_EMP);
      },
      onError: (e: unknown) => {
        toast({ title: "Failed to create employee", description: (e as Error).message, variant: "destructive" });
      },
    },
  });

  const { mutate: updateEmployee, isPending: updating } = useUpdateEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee updated" });
        queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
        setShowForm(false);
        setEditEmp(null);
      },
      onError: (e: unknown) => {
        toast({ title: "Failed to update employee", description: (e as Error).message, variant: "destructive" });
      },
    },
  });

  const { mutate: deleteEmployee, isPending: deleting } = useDeleteEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
        setDeleteEmp(null);
      },
      onError: (e: unknown) => {
        toast({ title: "Failed to delete employee", description: (e as Error).message, variant: "destructive" });
      },
    },
  });

  const allEmployees = (employees as Employee[] | undefined) ?? [];

  const filtered = allEmployees.filter(e => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      e.firstName.toLowerCase().includes(s) ||
      e.lastName.toLowerCase().includes(s) ||
      (e.jobTitle ?? "").toLowerCase().includes(s) ||
      (e.department ?? "").toLowerCase().includes(s)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "lastName") {
      cmp = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    } else if (sortField === "status") {
      cmp = a.status.localeCompare(b.status);
    } else if (sortField === "jobTitle") {
      cmp = (a.jobTitle ?? "").localeCompare(b.jobTitle ?? "");
    } else if (sortField === "hireDate") {
      cmp = (a.hireDate ?? "").localeCompare(b.hireDate ?? "");
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

  const openEdit = (e: React.MouseEvent, emp: Employee) => {
    e.preventDefault();
    e.stopPropagation();
    setEditEmp(emp);
    setForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email ?? "",
      phone: emp.phone ?? "",
      jobTitle: emp.jobTitle ?? "",
      department: emp.department ?? "",
      employeeNumber: emp.employeeNumber ?? "",
      facilityId: emp.facilityId ? String(emp.facilityId) : "none",
      hireDate: emp.hireDate ?? "",
      status: emp.status as EmpFormData["status"],
      administersMedications: emp.administersMedications ?? false,
      trainerStatus: emp.trainerStatus ?? false,
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email || undefined,
      phone: form.phone || undefined,
      jobTitle: form.jobTitle || undefined,
      department: form.department || undefined,
      employeeNumber: form.employeeNumber || undefined,
      facilityId: form.facilityId && form.facilityId !== "none" ? Number(form.facilityId) : undefined,
      hireDate: form.hireDate || undefined,
      status: form.status,
      administersMedications: form.administersMedications,
      trainerStatus: form.trainerStatus,
    };
    if (editEmp) {
      updateEmployee({ id: editEmp.id, data: payload });
    } else {
      createEmployee({ data: payload as Parameters<typeof createEmployee>[0]["data"] });
    }
  };

  const field = (k: keyof EmpFormData, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-muted-foreground">Manage staff and track their compliance status.</p>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <UserPlus className="mr-2 h-4 w-4" /> Add Employee
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employees..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={facilityId} onValueChange={v => { setFacilityId(v); setPage(1); }}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Facilities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities</SelectItem>
                {facilities?.map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-40">
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
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : paginated.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No employees found.</p>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("lastName")}>
                        Name{sortIndicator("lastName")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("jobTitle")}>
                        Role{sortIndicator("jobTitle")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("status")}>
                        Status{sortIndicator("status")}
                      </th>
                      <th className="text-left p-3 cursor-pointer hover:bg-muted" onClick={() => toggleSort("hireDate")}>
                        Hire Date{sortIndicator("hireDate")}
                      </th>
                      <th className="text-left p-3">Tags</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(emp => (
                      <tr key={emp.id} className="border-t hover:bg-muted/30">
                        <td className="p-3">
                          <Link href={`${basePath}/${emp.id}`}>
                            <span className="font-medium hover:underline cursor-pointer">
                              {emp.lastName}, {emp.firstName}
                            </span>
                          </Link>
                        </td>
                        <td className="p-3 text-muted-foreground">{emp.jobTitle ?? "—"}</td>
                        <td className="p-3">
                          <StatusBadge status={emp.status} type="employee" />
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {emp.hireDate ? new Date(emp.hireDate).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {emp.administersMedications && <Badge variant="secondary" className="text-xs">Med Admin</Badge>}
                            {emp.trainerStatus && <Badge variant="outline" className="text-xs">Trainer</Badge>}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1 justify-end">
                            {canManage && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => openEdit(e, emp)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={e => { e.preventDefault(); e.stopPropagation(); setDeleteEmp(emp); }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            <Link href={`${basePath}/${emp.id}`}>
                              <ChevronRight className="h-4 w-4 text-muted-foreground cursor-pointer" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length} employees
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>{filtered.length} employee{filtered.length !== 1 ? "s" : ""} total</span>
      </div>

      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setEditEmp(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEmp ? "Edit Employee" : "Add Employee"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label>First Name *</Label>
              <Input value={form.firstName} onChange={e => field("firstName", e.target.value)} placeholder="Jane" />
            </div>
            <div className="space-y-1">
              <Label>Last Name *</Label>
              <Input value={form.lastName} onChange={e => field("lastName", e.target.value)} placeholder="Smith" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => field("email", e.target.value)} placeholder="jane@example.com" />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => field("phone", e.target.value)} placeholder="(215) 555-0100" />
            </div>
            <div className="space-y-1">
              <Label>Job Title</Label>
              <Input value={form.jobTitle} onChange={e => field("jobTitle", e.target.value)} placeholder="Medication Aide" />
            </div>
            <div className="space-y-1">
              <Label>Department</Label>
              <Input value={form.department} onChange={e => field("department", e.target.value)} placeholder="Nursing" />
            </div>
            <div className="space-y-1">
              <Label>Employee Number</Label>
              <Input value={form.employeeNumber} onChange={e => field("employeeNumber", e.target.value)} placeholder="EMP-001" />
            </div>
            <div className="space-y-1">
              <Label>Facility</Label>
              <Select value={form.facilityId} onValueChange={v => field("facilityId", v)}>
                <SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No facility</SelectItem>
                  {facilities?.map(f => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Hire Date</Label>
              <Input type="date" value={form.hireDate} onChange={e => field("hireDate", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => field("status", v as EmpFormData["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.administersMedications}
                  onChange={e => field("administersMedications", e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">Administers Medications</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.trainerStatus}
                  onChange={e => field("trainerStatus", e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">Designated Trainer</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditEmp(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={creating || updating}>
              {creating || updating ? "Saving..." : editEmp ? "Save Changes" : "Create Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteEmp} onOpenChange={o => { if (!o) setDeleteEmp(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteEmp?.firstName} {deleteEmp?.lastName}? This will permanently remove their record and all associated training data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteEmp) deleteEmployee({ id: deleteEmp.id }); }}
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
