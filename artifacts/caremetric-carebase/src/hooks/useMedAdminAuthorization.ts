import { useMemo } from "react";
import { useListTrainingRecords, type TrainingRecord } from "@/hooks/useTrainingRecords";
import { useListPracticums, type Practicum } from "@/hooks/usePracticums";
import { useListTrainingTypes } from "@/hooks/useTrainingTypes";
import type { Employee } from "@/hooks/useEmployees";
import { facilityYear } from "@/lib/dateUtils";

// "Authorized today" reads compliant OR due_soon as still-currently-valid -- due_soon means
// "expiring within the warning window", not "already expired". Only missing/expired disqualify.
// Canonical definition -- mirrors MedAdminRoster.tsx ("Who Can Pass Meds Today"), which this hook
// was extracted from so every consumer of the signal (the roster page, the Schedule views) computes
// it identically instead of drifting apart.
export const MED_ADMIN_CURRENTLY_VALID_STATUSES = new Set(["compliant", "due_soon"]);

// Same "most recent by due_date, then completion_date, then created_at" ordering used by the
// separate findCurrentRecord/pickCurrentRecord copies in EmployeeDetail.tsx, PendingApprovals.tsx,
// and (previously) MedAdminRoster.tsx -- picks the current row when more than one exists for a
// training_type. Not consolidated with those other copies here; this ticket only extracts the one
// MedAdminRoster.tsx was using.
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

// Practicums get their own picker rather than reusing pickCurrentRecord above: the ranking is a
// different order (completion_date outranks due_date, not the other way around) and adds a
// missing-last/id tie-break that pickCurrentRecord doesn't have. Mirrors the canonical
// `current_practicums` CTE in get_org_dashboard_summary() (see
// supabase/migrations/20260727010100_the_facility_day_is_not_the_utc_day.sql, and originally
// supabase/migrations/20260724161000_..._count_current_training_records.sql): within a year, a row
// with actual completion evidence must outrank the rulepack engine's auto-instantiated 'missing'
// placeholder -- the schema permits both to exist for the same employee/year at once (save_practicum
// inserts a new row rather than upserting, and there is no unique(employee_id, practicum_year)
// constraint), so a plain `.find()` over an array that's merely due_date-ordered (useListPracticums)
// can hand back the placeholder instead of the completed row. The trailing missing-then-id tie-break
// keeps the pick fully deterministic even on a complete tie, same as the SQL.
function pickCurrentPracticum(records: Practicum[]): Practicum | undefined {
  if (records.length === 0) return undefined;
  return records.reduce((current, candidate) => {
    const cComp = candidate.completion_date ?? "", curComp = current.completion_date ?? "";
    if (cComp !== curComp) return cComp > curComp ? candidate : current;
    const cDue = candidate.due_date ?? "", curDue = current.due_date ?? "";
    if (cDue !== curDue) return cDue > curDue ? candidate : current;
    const cCreated = candidate.created_at ?? "", curCreated = current.created_at ?? "";
    if (cCreated !== curCreated) return cCreated > curCreated ? candidate : current;
    const cMissing = candidate.status === "missing", curMissing = current.status === "missing";
    if (cMissing !== curMissing) return curMissing ? candidate : current;
    return candidate.id < current.id ? candidate : current;
  });
}

export interface MedAdminAuthorization {
  employeeId: string;
  /** Mirrors employees.administers_medications. Staff not flagged here were never in scope for
   *  MED-INIT/MED-RENEW/practicum tracking, so authorizedToday is always false for them -- it means
   *  "not applicable", not "lapsed". */
  administersMedications: boolean;
  certStatus: string;
  practicumStatus: string;
  insulinAuthorized: boolean;
  /** Currently authorized to pass medications: flagged as administering medications, and both the
   *  current MED-INIT/MED-RENEW certification and this year's practicum are compliant or due_soon. */
  authorizedToday: boolean;
}

interface MedAdminTrainingTypeIds {
  medInitTypeId?: string;
  medRenewTypeId?: string;
  diabetesEduTypeId?: string;
}

// Pure computation, split out from the hook below purely so it can be unit tested without mocking
// Supabase/react-query (mirrors buildTrainingMatrixArgs in useTrainingMatrix.ts). Takes whatever
// training-type ids resolved (any of them may be absent if that training type doesn't exist yet in
// a tenant) and the training records / practicums already scoped to the employees in question.
export function computeMedAdminAuthorization(
  employees: Pick<Employee, "id" | "administers_medications">[],
  trainingRecords: TrainingRecord[],
  practicums: Practicum[],
  { medInitTypeId, medRenewTypeId, diabetesEduTypeId }: MedAdminTrainingTypeIds,
): MedAdminAuthorization[] {
  return employees.map((emp) => {
    if (!emp.administers_medications) {
      return {
        employeeId: emp.id,
        administersMedications: false,
        certStatus: "missing",
        practicumStatus: "missing",
        insulinAuthorized: false,
        authorizedToday: false,
      };
    }

    const empRecords = trainingRecords.filter((r) => r.employee_id === emp.id);
    // Prefer the renewal record once one exists; an employee who has only ever completed the
    // initial certification is still tracked against MED-INIT.
    const renewRecord = medRenewTypeId
      ? pickCurrentRecord(empRecords.filter((r) => r.training_type_id === medRenewTypeId))
      : undefined;
    const initRecord = medInitTypeId
      ? pickCurrentRecord(empRecords.filter((r) => r.training_type_id === medInitTypeId))
      : undefined;
    const certRecord = renewRecord && renewRecord.status !== "missing" ? renewRecord : (initRecord ?? renewRecord);
    const certStatus = certRecord?.status ?? "missing";

    const practicum = pickCurrentPracticum(practicums.filter((p) => p.employee_id === emp.id));
    const practicumStatus = practicum?.status ?? "missing";

    const diabetesRecord = diabetesEduTypeId
      ? pickCurrentRecord(empRecords.filter((r) => r.training_type_id === diabetesEduTypeId))
      : undefined;
    const insulinAuthorized = MED_ADMIN_CURRENTLY_VALID_STATUSES.has(diabetesRecord?.status ?? "");

    const authorizedToday =
      MED_ADMIN_CURRENTLY_VALID_STATUSES.has(certStatus) && MED_ADMIN_CURRENTLY_VALID_STATUSES.has(practicumStatus);

    return {
      employeeId: emp.id,
      administersMedications: true,
      certStatus,
      practicumStatus,
      insulinAuthorized,
      authorizedToday,
    };
  });
}

export interface UseMedAdminAuthorizationResult {
  /** Lookup by employee id -- one entry per employee passed in. */
  byEmployeeId: Map<string, MedAdminAuthorization>;
  rows: MedAdminAuthorization[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Shared "is this employee authorized to pass medications right now" signal -- the same
 * cert + this year's practicum join MedAdminRoster.tsx ("Who Can Pass Meds Today") uses, pulled out
 * here so any other page that needs the same per-employee authorization signal (e.g. the Schedule
 * views) computes it identically instead of maintaining a second copy of the query/join logic.
 *
 * Pass the specific employees you need this for (e.g. everyone scheduled in a period, or an
 * already facility/status-filtered roster) -- this hook does not fetch the tenant's employees
 * itself, so it never re-downloads a roster the caller already has.
 */
export function useMedAdminAuthorization(
  employees: Employee[],
  options: { enabled?: boolean } = {},
): UseMedAdminAuthorizationResult {
  const enabled = options.enabled ?? true;
  const currentYear = facilityYear();

  // Only employees flagged as administering medications were ever in scope for MED-INIT/MED-RENEW/
  // DIABETES-EDU tracking -- scoping the training-records fetch to just them keeps the payload
  // proportional to actual med-admin staff instead of the full (possibly much larger) employee set
  // a caller like the Schedule grid passes in. Mirrors MedAdminRoster.tsx's medAdminEmployeeIds.
  const medAdminEmployeeIds = useMemo(
    () => [...new Set(employees.filter((e) => e.administers_medications).map((e) => e.id))].sort(),
    [employees],
  );

  const trainingTypesQuery = useListTrainingTypes({ isActive: true });
  const { data: trainingTypes } = trainingTypesQuery;

  const medInitTypeId = useMemo(() => trainingTypes?.find((t) => t.code === "MED-INIT")?.id, [trainingTypes]);
  const medRenewTypeId = useMemo(() => trainingTypes?.find((t) => t.code === "MED-RENEW")?.id, [trainingTypes]);
  const diabetesEduTypeId = useMemo(() => trainingTypes?.find((t) => t.code === "DIABETES-EDU")?.id, [trainingTypes]);
  const medTrainingTypeIds = useMemo(
    () => [medInitTypeId, medRenewTypeId, diabetesEduTypeId].filter((id): id is string => Boolean(id)),
    [medInitTypeId, medRenewTypeId, diabetesEduTypeId],
  );

  const trainingRecordsQuery = useListTrainingRecords(
    { employeeIds: medAdminEmployeeIds, trainingTypeIds: medTrainingTypeIds },
    { enabled: enabled && medAdminEmployeeIds.length > 0 && medTrainingTypeIds.length > 0 },
  );
  const { data: trainingRecords } = trainingRecordsQuery;

  // Not employee-scoped (matches MedAdminRoster.tsx) -- practicums are cheap to pull for the whole
  // tenant-year and matched by employee id below, rather than adding an employeeIds filter that
  // useListPracticums doesn't currently support.
  const practicumsQuery = useListPracticums({ year: currentYear }, { enabled });
  const { data: practicums } = practicumsQuery;

  const rows = useMemo(
    () => computeMedAdminAuthorization(employees, trainingRecords ?? [], practicums ?? [], {
      medInitTypeId, medRenewTypeId, diabetesEduTypeId,
    }),
    [employees, trainingRecords, practicums, medInitTypeId, medRenewTypeId, diabetesEduTypeId],
  );

  const byEmployeeId = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);

  // A missing training record must never quietly read as "not authorized" (or an unfetched
  // practicum as "clear") because a fetch failed -- surface the failure instead of a silently wrong
  // authorization answer. Mirrors MedAdminRoster.tsx's rosterFailure handling.
  const queries = [trainingTypesQuery, trainingRecordsQuery, practicumsQuery];
  const failingQuery = queries.find((q) => q.isError);

  return {
    byEmployeeId,
    rows,
    isLoading: queries.some((q) => q.isLoading),
    isError: Boolean(failingQuery),
    error: (failingQuery?.error as Error | undefined) ?? null,
    refetch: () => {
      void Promise.all(queries.map((q) => q.refetch()));
    },
  };
}
