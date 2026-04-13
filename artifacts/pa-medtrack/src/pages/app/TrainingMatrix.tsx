import { useState } from "react";
import { useListTrainingRecords, useListEmployees, useListTrainingTypes, useListFacilities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";

type TrainingRecord = {
  id: number;
  employeeId: number;
  trainingTypeId: number;
  status: string;
  completionDate?: string | null;
  dueDate?: string | null;
};

export default function TrainingMatrix() {
  const [facilityId, setFacilityId] = useState<string>("all");

  const { data: facilities } = useListFacilities({});
  const { data: employees } = useListEmployees({
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
    status: "active",
  });
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
  const { data: records } = useListTrainingRecords({
    facilityId: facilityId && facilityId !== "all" ? Number(facilityId) : undefined,
  });

  const getRecord = (employeeId: number, trainingTypeId: number): TrainingRecord | undefined => {
    return (records as TrainingRecord[] | undefined)?.find(
      r => r.employeeId === employeeId && r.trainingTypeId === trainingTypeId
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Training Matrix</h1>
        <p className="text-muted-foreground">View compliance status across all employees and training types.</p>
      </div>

      <div className="flex gap-3">
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities?.map(f => (
              <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Compliance Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground sticky left-0 bg-background min-w-[160px]">
                    Employee
                  </th>
                  {trainingTypes?.map(tt => (
                    <th key={tt.id} className="text-center py-2 px-2 font-medium text-muted-foreground min-w-[100px] max-w-[120px]">
                      <div className="truncate text-xs" title={tt.name}>{tt.code}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees?.map(emp => (
                  <tr key={emp.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 pr-4 sticky left-0 bg-background">
                      <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                      <div className="text-xs text-muted-foreground">{emp.jobTitle}</div>
                    </td>
                    {trainingTypes?.map(tt => {
                      const record = getRecord(emp.id, tt.id);
                      return (
                        <td key={tt.id} className="py-2 px-2 text-center">
                          {record ? (
                            <StatusBadge status={record.status} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {(!employees || employees.length === 0) && (
                  <tr>
                    <td colSpan={100} className="text-center py-8 text-muted-foreground">
                      No employees found for the selected facility.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
