import { useMemo, useState } from "react";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListFacilities } from "@/hooks/useFacilities";
import { useMedAdminAuthorization } from "@/hooks/useMedAdminAuthorization";
import { useListIncidents } from "@/hooks/useIncidents";
import { useListCorrectiveActions } from "@/hooks/useCorrectiveActions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { buildMedicationSafetySummary } from "@/lib/medicationSafetyAnalytics";
import { facilityToday, facilityYear } from "@/lib/dateUtils";
import { Pill, CheckCircle2, XCircle, Droplet, AlertTriangle, ClipboardCheck } from "lucide-react";
import { QueryError } from "@/components/QueryState";

export default function MedAdminRoster() {
  const [facilityId, setFacilityId] = useState<string>("all");
  const currentYear = facilityYear();

  const facilitiesQuery = useListFacilities();
  const { data: facilities } = facilitiesQuery;
  // Push the facility filter into the query so selecting a site does not download the whole
  // active roster first and then slice client-side.
  const { data: employeesAll, ...employeesQuery } = useListEmployees({
    status: "active",
    facilityId: facilityId !== "all" ? facilityId : undefined,
  });

  const medAdminEmployees = useMemo(
    () =>
      (employeesAll ?? [])
        .filter(e => e.administers_medications)
        .slice()
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [employeesAll],
  );

  // Shared with the Schedule views (ScheduleDetail.tsx) so both pages answer "is this employee
  // authorized to pass meds right now" identically -- see useMedAdminAuthorization.ts.
  const {
    byEmployeeId: medAuthByEmployeeId,
    isError: medAuthIsError,
    error: medAuthError,
    refetch: refetchMedAuth,
  } = useMedAdminAuthorization(medAdminEmployees);

  const incidentFacilityId = facilityId !== "all" ? facilityId : undefined;
  const incidentsQuery = useListIncidents({ facilityId: incidentFacilityId });
  const { data: incidents } = incidentsQuery;
  const correctiveActionsQuery = useListCorrectiveActions({ facilityId: incidentFacilityId });
  const { data: correctiveActions } = correctiveActionsQuery;

  const facilityNameById = useMemo(() => new Map((facilities ?? []).map(f => [f.id, f.name])), [facilities]);

  const authorizedCount = medAdminEmployees.filter((e) => medAuthByEmployeeId.get(e.id)?.authorizedToday).length;
  const medicationSafety = useMemo(() => buildMedicationSafetySummary({ incidents: incidents ?? [], correctiveActions: correctiveActions ?? [], today: facilityToday() }), [incidents, correctiveActions]);

  // This roster answers "is this person authorized to pass meds right now". A missing
  // training record must never quietly read as "not authorized" (or worse, a missing
  // corrective action as "clear") because a fetch failed.
  const rosterQueries = [facilitiesQuery, employeesQuery, incidentsQuery, correctiveActionsQuery];
  const rosterFailure = rosterQueries.find((query) => query.isError)
    ?? (medAuthIsError ? { isError: true as const, error: medAuthError } : undefined);

  return (
    <div className="space-y-6">
      {rosterFailure && (
        <QueryError
          what="the medication-administration roster"
          error={rosterFailure.error}
          onRetry={() => {
            void Promise.all(rosterQueries.map((query) => query.refetch()));
            refetchMedAuth();
          }}
        />
      )}
      <div>
        <h1 className="text-2xl font-bold">Who Can Pass Meds Today</h1>
        <p className="text-muted-foreground">
          Live medication-administration authorization status: current certification + this year's practicum, side by side.
        </p>
      </div>

      <div className="flex gap-3">
        <Select value={facilityId} onValueChange={setFacilityId}>
          <SelectTrigger className="w-52" aria-label="Facility">
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


      {!rosterFailure && (
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4" />Medication events</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{medicationSafety.totalEvents}</p><p className="text-xs text-muted-foreground">Filtered incident log</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><ClipboardCheck className="h-4 w-4" />Open follow-up</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{medicationSafety.unresolvedFollowUps}</p><p className="text-xs text-muted-foreground">No final report yet</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4" />Overdue actions</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-destructive">{medicationSafety.overdueFollowUps}</p><p className="text-xs text-muted-foreground">Corrective actions past due</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><Pill className="h-4 w-4" />Retraining signals</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{medicationSafety.retrainingRecommendations}</p><p className="text-xs text-muted-foreground">Review competency/course assignment</p></CardContent>
        </Card>
      </div>
      )}

      {!rosterFailure && (
      <Card>
        <CardHeader>
          <CardTitle>Medication safety pattern review</CardTitle>
          <CardDescription>Structured event analytics from incidents and corrective actions. Repeated wrong-dose, wrong-medication, wrong-resident, and documentation events flag retraining review.</CardDescription>
        </CardHeader>
        <CardContent>
          {medicationSafety.totalEvents === 0 ? (
            <p className="text-sm text-muted-foreground">No medication safety incidents found for this facility filter.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
              {Object.entries(medicationSafety.byType).filter(([, count]) => count > 0).map(([type, count]) => (
                <div key={type} className="rounded-md border p-2 text-sm">
                  <p className="font-medium">{type.replaceAll("_", " ")}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {!rosterFailure && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5" />
            Medication Administration Roster
          </CardTitle>
          <CardDescription>
            {authorizedCount} of {medAdminEmployees.length} medication-administering staff are currently authorized.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {medAdminEmployees.length === 0 ? (
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
                  {medAdminEmployees.map((employee) => {
                    const auth = medAuthByEmployeeId.get(employee.id);
                    const certStatus = auth?.certStatus ?? "missing";
                    const practicumStatus = auth?.practicumStatus ?? "missing";
                    const insulinAuthorized = auth?.insulinAuthorized ?? false;
                    const authorizedToday = auth?.authorizedToday ?? false;
                    return (
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
