import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Employee } from "@/hooks/useEmployees";
import type { Facility } from "@/hooks/useFacilities";

// Shared by Employees.tsx (roster create/edit dialog) and EmployeeDetail.tsx (full-profile edit
// dialog) -- both used to define their own local copy of this shape, and it had already drifted
// (Employees.tsx's copy was missing `notes`, silently dropping it on every roster-page edit).
// Single source of truth for the field set going forward.
export interface EmpFormData {
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
  scheduledHoursPerWeek: string;
  workerType: "regular" | "agency" | "substitute" | "volunteer";
}

export const EMPTY_EMPLOYEE_FORM: EmpFormData = {
  firstName: "", lastName: "", email: "", phone: "", jobTitle: "",
  department: "", employeeNumber: "", facilityId: "none", hireDate: "",
  status: "active", administersMedications: false, trainerStatus: false, notes: "",
  scheduledHoursPerWeek: "", workerType: "regular",
};

// Maps an existing employee row onto the edit-form shape. Both pages need this (Employees.tsx's
// row-edit dialog and EmployeeDetail.tsx's profile-edit dialog) -- keeping one copy means a field
// added to the form later can't be forgotten in one of the two open-edit handlers again.
export function employeeToFormData(emp: Employee): EmpFormData {
  return {
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
    notes: emp.notes ?? "",
    scheduledHoursPerWeek: emp.scheduled_hours_per_week != null ? String(emp.scheduled_hours_per_week) : "",
    workerType: (emp.worker_type ?? "regular") as EmpFormData["workerType"],
  };
}

export interface EmployeeFormFieldsProps {
  form: EmpFormData;
  onChange: (key: keyof EmpFormData, value: string | boolean) => void;
  facilities: Facility[] | undefined;
  /**
   * Controls how the Facility field behaves -- the one place the two call sites genuinely differ:
   *  - "create": no existing facility to keep, so it's required (label gets a "*") and every
   *    option is a real facility.
   *  - "edit-keep-current": optional -- a "Keep current" sentinel is offered first, for the
   *    Employees roster's row-edit dialog, which lets an admin change other fields without being
   *    forced to also re-pick a facility.
   *  - "edit-fixed": no sentinel/asterisk -- for EmployeeDetail's full single-employee editor,
   *    where the field always already holds a real value.
   */
  facilityFieldMode: "create" | "edit-keep-current" | "edit-fixed";
}

export function EmployeeFormFields({ form, onChange, facilities, facilityFieldMode }: EmployeeFormFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
      <div className="space-y-1.5">
        <Label className="text-[13px]">First Name *</Label>
        <Input value={form.firstName} onChange={e => onChange("firstName", e.target.value)} placeholder="Jane" className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Last Name *</Label>
        <Input value={form.lastName} onChange={e => onChange("lastName", e.target.value)} placeholder="Smith" className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Email</Label>
        <Input type="email" value={form.email} onChange={e => onChange("email", e.target.value)} placeholder="jane@example.com" className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Phone</Label>
        <Input value={form.phone} onChange={e => onChange("phone", e.target.value)} placeholder="(215) 555-0100" className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Job Title</Label>
        <Input value={form.jobTitle} onChange={e => onChange("jobTitle", e.target.value)} placeholder="Medication Aide" className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Department</Label>
        <Input value={form.department} onChange={e => onChange("department", e.target.value)} placeholder="Nursing" className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Employee Number</Label>
        <Input value={form.employeeNumber} onChange={e => onChange("employeeNumber", e.target.value)} placeholder="EMP-001" className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Facility{facilityFieldMode === "create" && " *"}</Label>
        <Select value={form.facilityId} onValueChange={v => onChange("facilityId", v)}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Select facility" /></SelectTrigger>
          <SelectContent>
            {facilityFieldMode === "edit-keep-current" && <SelectItem value="none">Keep current</SelectItem>}
            {facilities?.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Hire Date</Label>
        <Input type="date" value={form.hireDate} onChange={e => onChange("hireDate", e.target.value)} className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Scheduled Hours / Week</Label>
        <Input
          type="number" min="1" step="0.5" value={form.scheduledHoursPerWeek}
          onChange={e => onChange("scheduledHoursPerWeek", e.target.value)}
          placeholder="e.g. 32" className="h-9"
        />
        <p className="text-xs text-muted-foreground">Drives the 40-scheduled-hour orientation deadline.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Worker Type</Label>
        <Select value={form.workerType} onValueChange={v => onChange("workerType", v as EmpFormData["workerType"])}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="regular">Regular</SelectItem>
            <SelectItem value="agency">Agency</SelectItem>
            <SelectItem value="substitute">Substitute</SelectItem>
            <SelectItem value="volunteer">Volunteer</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Agency/substitute/volunteer get the rapid-orientation checklist.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px]">Status</Label>
        <Select value={form.status} onValueChange={v => onChange("status", v as EmpFormData["status"])}>
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
            onChange={e => onChange("administersMedications", e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-[13px]">Administers Medications</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.trainerStatus}
            onChange={e => onChange("trainerStatus", e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-[13px]">Designated Trainer</span>
        </label>
      </div>
      <div className="col-span-full space-y-1.5">
        <Label className="text-[13px]">Notes</Label>
        <Textarea value={form.notes} onChange={e => onChange("notes", e.target.value)} placeholder="Optional notes" className="min-h-20" />
      </div>
    </div>
  );
}
