import { useMemo, useState } from "react";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Pill, CheckCircle2, XCircle, Droplet } from "lucide-react";

// "Authorized today" reads compliant OR due_soon as still-currently-valid -- due_soon means
// "expiring within the warning window", not "already expired". Only missing/expired disqualify.
const CURRENTLY_VALID_STATUSES = new Set(["compliant", "due_soon"]);

// Same "most recent by due_date, then completion_date, then created_at" ordering used by
// findCurrentRecord/pickCurrentRecord elsewhere (EmployeeDetail.tsx, TrainingMatrix.tsx,
// PendingApprovals.tsx) -- picks the current row when more than one exists for a training_type.
function pickCurrentRecord(records: TrainingRecord[]): TrainingRecord | undefined {
  if (records.length === 0) return undefined;
  return records.reduce((current, candidate) => {
    const cDue = candidate.due_date ?? "", curDue = current.due_date ?? "";
    if (cDue !== curDue) return cDue > curDue ? candidate : current;
    const cComp = candidate.completion_date ?? "", curComp = current.completion_date ?? "";
    if (cComp !== curComp) return cComp > curComp ? candidate : current;
    return (candidate.created_at ?? "") > (current.created_at ?? "") ? candidate : current;
  });
}

export default function MedAdminRoster() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const currentYear = new Date().getFullYear();

  const { data: facilities } = useListFacilities();
  const { data: employeesAll } = useListEmployees({ status: "active" });
  const { data: trainingTypes } = useListTrainingTypes({ isActive: true });
  const { data: trainingRecords } = useListTrainingRecords({});
  const { data: practicums } = useListPracticums({ year: currentYear });

  const facilityNameById = useMemo(() => new Map((facilities ?? []).map(f => [f.id, f.name])), [facilities]);

  const medInitTypeId = useMemo(() => trainingTypes?.find(t => t.code === "MED-INIT")?.id, [trainingTypes]);
  const medRenewTypeId = useMemo(() => trainingTypes?.find(t => t.code === "MED-RENEW")?.id, [trainingTypes]);
  const diabetesEduTypeId = useMemo(() => trainingTypes?.find(t => t.code === "DIABETES-EDU")?.id, [trainingTypes]);

  const medAdminEmployees = useMemo(
    () =>
      (employeesAll ?? [])
        .filter(e => e.administers_medications)
        .filter(e => facilityId === "all" || e.facility_id === facilityId)
        .slice()
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employeesAll, facilityId],
  );

  const rows = useMemo(() => {
    const records = trainingRecords ?? [];
    const practicumRows = practicums ?? [];
    return medAdminEmployees.map(emp => {
      const empRecords = records.filter(r => r.employee_id === emp.id);
      // Prefer the renewal record once one exists; an employee who has only ever completed the
      // initial certification is still tracked against MED-INIT.
      const renewRecord = medRenewTypeId ? pickCurrentRecord(empRecords.filter(r => r.training_type_id === medRenewTypeId)) : undefined;
      const initRecord = medInitTypeId ? pickCurrentRecord(empRecords.filter(r => r.training_type_id === medInitTypeId)) : undefined;
      const certRecord = (renewRecord && renewRecord.status !== "missing") ? renewRecord : (initRecord ?? renewRecord);
      const certStatus = certRecord?.status ?? "missing";

      const practicum = practicumRows.find(p => p.employee_id === emp.id);
      const practicumStatus = practicum?.status ?? "missing";

      const diabetesRecord = diabetesEduTypeId ? pickCurrentRecord(empRecords.filter(r => r.training_type_id === diabetesEduTypeId)) : undefined;
      const insulinAuthorized = CURRENTLY_VALID_STATUSES.has(diabetesRecord?.status ?? "");

      const authorizedToday = CURRENTLY_VALID_STATUSES.has(certStatus) && CURRENTLY_VALID_STATUSES.has(practicumStatus);

      return { employee: emp, certStatus, practicumStatus, insulinAuthorized, authorizedToday };
    });
  }, [medAdminEmployees, trainingRecords, practicums, medRenewTypeId, medInitTypeId, diabetesEduTypeId]);

  const authorizedCount = rows.filter(r => r.authorizedToday).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Who Can Pass Meds Today</h1>
        <p className="text-muted-foreground">
          Live medication-administration authorization status: current certification + this year's practicum, side by side.
        </p>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5" />
            Medication Administration Roster
          </CardTitle>
          <CardDescription>
            {authorizedCount} of {rows.length} medication-administering staff are currently authorized.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Pill className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No medication-administering staff found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Staff must have "Administers Medications" set on their employee record to appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Facility</th>
                    <th>Certification</th>
                    <th>{currentYear} Practicum</th>
                    <th>Insulin</th>
                    <th>Authorized Today</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ employee, certStatus, practicumStatus, insulinAuthorized, authorizedToday }) => (
                    <tr key={employee.id}>
                      <td className="font-medium">{employee.first_name} {employee.last_name}</td>
                      <td className="text-muted-foreground">{facilityNameById.get(employee.facility_id) ?? "—"}</td>
                      <td><StatusBadge status={certStatus} /></td>
                      <td><StatusBadge status={practicumStatus} /></td>
                      <td>
                        {insulinAuthorized ? (
                          <Badge variant="outline" className="bg-info text-info-foreground">
                            <Droplet className="h-3 w-3 mr-1" /> Authorized
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td>
                        {authorizedToday ? (
                          <Badge className="bg-success text-success-foreground hover:bg-success/80">
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Yes
                          </Badge>
                        ) : (
                          <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/80">
                            <XCircle className="h-3.5 w-3.5 mr-1" /> No
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
