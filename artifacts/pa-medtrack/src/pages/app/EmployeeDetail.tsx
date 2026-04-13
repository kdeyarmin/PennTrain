import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ArrowLeft, User, CalendarCheck, BookOpen, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" /> Training Records
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
                  <div className="text-right space-y-1">
                    <StatusBadge status={tr.status as "compliant" | "due_soon" | "expired" | "missing" | "not_applicable" | "pending_review"} />
                    <p className="text-xs text-muted-foreground">
                      {tr.completionDate ? `Completed: ${tr.completionDate}` : "Not completed"}
                      {tr.dueDate ? ` — Due: ${tr.dueDate}` : ""}
                    </p>
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
            <CalendarCheck className="h-5 w-5" /> Annual Practicums
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
                  <div className="text-right space-y-1">
                    <StatusBadge status={p.status as "compliant" | "due_soon" | "expired" | "missing" | "not_applicable" | "pending_review"} />
                    <p className="text-xs text-muted-foreground">
                      {p.completionDate ? `Completed: ${p.completionDate}` : "Pending"}
                    </p>
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
    </div>
  );
}
