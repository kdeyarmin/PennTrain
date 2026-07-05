import { useMemo, useState } from "react";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { FileCheck, Plus, CheckCircle, XCircle } from "lucide-react";

export default function Practicums() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const currentYear = new Date().getFullYear();

  const { data: practicums, isLoading } = useListPracticums({
    facilityId: facilityId && facilityId !== "all" ? facilityId : undefined,
    year: currentYear,
    status: status && status !== "all" ? status : undefined,
  });

  const { data: facilities } = useListFacilities();
  const { data: employeesAll } = useListEmployees();
  const employees = useMemo(() => employeesAll?.filter(e => e.administers_medications), [employeesAll]);
  const employeeMap = useMemo(() => new Map((employees ?? []).map(e => [e.id, e])), [employees]);

  const getEmployee = (id: string) => employeeMap.get(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Annual Practicums</h1>
          <p className="text-muted-foreground">Track {currentYear} annual medication administration practicums.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Record Practicum
        </Button>
      </div>

      <div className="flex gap-3">
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="compliant">Compliant</SelectItem>
            <SelectItem value="due_soon">Due Soon</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{currentYear} Practicum Status</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {practicums?.map(p => {
                const emp = getEmployee(p.employee_id);
                return (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                        <FileCheck className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {emp ? `${emp.first_name} ${emp.last_name}` : `Employee #${p.employee_id}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.completion_date ? `Completed: ${new Date(p.completion_date).toLocaleDateString()}` : `Due: ${p.due_date ? new Date(p.due_date).toLocaleDateString() : "N/A"}`}
                          {p.observed_by && ` · Observed by: ${p.observed_by}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span title="MAR Review">{p.mar_review_completed ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-gray-300" />}</span>
                        <span>MAR</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span title="Direct Observation">{p.direct_observation_completed ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-gray-300" />}</span>
                        <span>Obs</span>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                );
              })}
              {(!practicums || practicums.length === 0) && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <CheckCircle className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-muted-foreground">No practicum records found</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">Practicum records will appear here once scheduled.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
