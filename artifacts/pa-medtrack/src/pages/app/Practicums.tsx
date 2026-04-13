import { useState } from "react";
import { useListPracticums, useListFacilities, useListEmployees } from "@workspace/api-client-react";
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
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
    year: currentYear,
    status: status && status !== "all" ? status as "compliant" | "due_soon" | "expired" | "missing" : undefined,
  });

  const { data: facilities } = useListFacilities({});
  const { data: employees } = useListEmployees({ administersMedications: true });

  const getEmployee = (id: number) => employees?.find(e => e.id === id);

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
              <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
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
                const emp = getEmployee(p.employeeId);
                return (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                        <FileCheck className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${p.employeeId}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.completionDate ? `Completed: ${new Date(p.completionDate).toLocaleDateString()}` : `Due: ${p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "N/A"}`}
                          {p.observedBy && ` · Observed by: ${p.observedBy}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span title="MAR Review">{p.marReviewCompleted ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-gray-300" />}</span>
                        <span>MAR</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span title="Direct Observation">{p.directObservationCompleted ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-gray-300" />}</span>
                        <span>Obs</span>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                );
              })}
              {(!practicums || practicums.length === 0) && (
                <p className="text-center text-muted-foreground py-8">No practicum records found.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
