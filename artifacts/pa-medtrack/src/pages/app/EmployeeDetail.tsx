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
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetEmployee, useUpdateEmployee, useDeleteEmployee } from "@/hooks/useEmployees";
import { useGetFacility, useListFacilities } from "@/hooks/useFacilities";
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

function PlaceholderCard({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 text-muted-foreground">
          <Icon className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            This section will be available once compliance tracking is migrated to Supabase in the next phase.
          </p>
        </div>
      </CardContent>
    </Card>
  );
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

  const [showEditEmp, setShowEditEmp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

      <PlaceholderCard icon={BookOpen} title="Training Records" />
      <PlaceholderCard icon={CalendarCheck} title="Annual Practicums" />
      <PlaceholderCard icon={Clock} title="Annual Training Hours" />
      <PlaceholderCard icon={FileText} title="Documents" />
      {canManage && <PlaceholderCard icon={Activity} title="Recent Activity" />}

      <Dialog open={showEditEmp} onOpenChange={o => { if (!o) setShowEditEmp(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Employee</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
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
            <div className="col-span-2 flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={empForm.administersMedications} onChange={e => field("administersMedications", e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">Administers Medications</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={empForm.trainerStatus} onChange={e => field("trainerStatus", e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">Designated Trainer</span>
              </label>
            </div>
            <div className="col-span-2 space-y-1">
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
