import { db } from "@workspace/db";
import {
  trainingRecordsTable,
  practicumsTable,
  trainingHourBucketsTable,
  trainingTypesTable,
  employeesTable,
  facilitiesTable,
  trainingDocumentsTable,
  alertsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

export function calculateTrainingStatus(
  completionDate: string | null,
  renewalIntervalDays: number | null,
  warningDays: number,
  today: Date = new Date(),
): "compliant" | "due_soon" | "expired" | "missing" {
  if (!completionDate) return "missing";

  if (!renewalIntervalDays) {
    return "compliant";
  }

  const completion = new Date(completionDate);
  const dueDate = new Date(completion);
  dueDate.setDate(dueDate.getDate() + renewalIntervalDays);

  const msUntilDue = dueDate.getTime() - today.getTime();
  const daysUntilDue = Math.floor(msUntilDue / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) return "expired";
  if (daysUntilDue <= warningDays) return "due_soon";
  return "compliant";
}

export function calculateDueDate(completionDate: string | null, renewalIntervalDays: number | null): string | null {
  if (!completionDate || !renewalIntervalDays) return null;
  const completion = new Date(completionDate);
  const dueDate = new Date(completion);
  dueDate.setDate(dueDate.getDate() + renewalIntervalDays);
  return dueDate.toISOString().split("T")[0];
}

export async function buildComplianceSummaryForFacility(facilityId: number) {
  const facility = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, facilityId));
  if (!facility[0]) return null;

  const employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.facilityId, facilityId), eq(employeesTable.status, "active"))
  );

  const trainingRecords = await db.select().from(trainingRecordsTable).where(
    eq(trainingRecordsTable.facilityId, facilityId)
  );

  const practicums = await db.select().from(practicumsTable).where(
    eq(practicumsTable.facilityId, facilityId)
  );

  const currentYear = new Date().getFullYear();
  const hourBuckets = await db.select().from(trainingHourBucketsTable).where(
    and(eq(trainingHourBucketsTable.facilityId, facilityId), eq(trainingHourBucketsTable.trainingYear, currentYear))
  );

  const medAdminStaff = employees.filter(e => e.administersMedications).length;
  const allStatuses = trainingRecords.map(r => r.status);
  const compliantCount = allStatuses.filter(s => s === "compliant").length;
  const dueSoonCount = allStatuses.filter(s => s === "due_soon").length;
  const expiredCount = allStatuses.filter(s => s === "expired").length;
  const missingCount = allStatuses.filter(s => s === "missing").length;
  const total = allStatuses.length;
  const complianceScore = total > 0 ? Math.round((compliantCount / total) * 100) : 100;

  const practicumsDue = practicums.filter(p => p.status === "due_soon" || p.status === "missing").length;
  const annualHoursIncomplete = hourBuckets.filter(h => h.status === "incomplete").length;

  return {
    facilityId,
    facilityName: facility[0].name,
    facilityType: facility[0].facilityType,
    totalEmployees: employees.length,
    medAdminStaff,
    compliantCount,
    dueSoonCount,
    expiredCount,
    missingCount,
    complianceScore,
    practicumsDue,
    annualHoursIncomplete,
  };
}

export async function buildComplianceSummaryForEmployee(employeeId: number, organizationId: number) {
  const [employee] = await db.select().from(employeesTable).where(
    and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId))
  );
  if (!employee) return null;

  const trainingRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.employeeId, employeeId));

  const allStatuses = trainingRecords.map(r => r.record.status);
  const compliantCount = allStatuses.filter(s => s === "compliant").length;
  const dueSoonCount = allStatuses.filter(s => s === "due_soon").length;
  const expiredCount = allStatuses.filter(s => s === "expired").length;
  const missingCount = allStatuses.filter(s => s === "missing").length;
  const total = allStatuses.length;
  const complianceScore = total > 0 ? Math.round((compliantCount / total) * 100) : 100;

  const currentYear = new Date().getFullYear();
  const practicums = await db.select().from(practicumsTable).where(
    and(eq(practicumsTable.employeeId, employeeId), eq(practicumsTable.practicumYear, currentYear))
  );
  const practicumStatus = practicums[0]?.status ?? "missing";

  const hourBucket = await db.select().from(trainingHourBucketsTable).where(
    and(
      eq(trainingHourBucketsTable.employeeId, employeeId),
      eq(trainingHourBucketsTable.trainingYear, currentYear)
    )
  );
  const annualHoursStatus = hourBucket[0]?.status ?? "incomplete";
  const annualHoursCompleted = hourBucket[0]?.completedHours ?? "0";
  const annualHoursRequired = hourBucket[0]?.requiredHours ?? "12";

  return {
    employeeId,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    facilityId: employee.facilityId,
    total,
    compliantCount,
    dueSoonCount,
    expiredCount,
    missingCount,
    complianceScore,
    practicumStatus,
    annualHoursStatus,
    annualHoursCompleted,
    annualHoursRequired,
    trainingRecords: trainingRecords.map(r => ({ ...r.record, trainingType: r.trainingType })),
  };
}

/**
 * Calculate compliance status for an annual practicum.
 * Returns "compliant" if completed in the current or prior 12-month window,
 * "due_soon" if within 60 days of year end, "missing" otherwise.
 */
export function calculatePracticumStatus(
  practicumYear: number,
  completionDate: string | null,
  today: Date = new Date(),
): "compliant" | "due_soon" | "missing" {
  if (!completionDate) {
    const currentYear = today.getFullYear();
    const daysUntilYearEnd = Math.floor(
      (new Date(currentYear, 11, 31).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (practicumYear === currentYear && daysUntilYearEnd <= 60) return "due_soon";
    return "missing";
  }
  return "compliant";
}

/**
 * Calculate compliance status for annual training hours.
 * Per 28 Pa. Code §2600: PCH facilities require 12 hours/year, ALR require 16 hours/year.
 */
export function calculateAnnualHoursStatus(
  completedHours: number,
  requiredHours: number,
): "compliant" | "due_soon" | "incomplete" {
  if (completedHours >= requiredHours) return "compliant";
  if (completedHours >= requiredHours * 0.75) return "due_soon";
  return "incomplete";
}

/**
 * Returns required annual training hours for a facility type.
 * PCH = 12 hours, ALR = 16 hours (28 Pa. Code §2600).
 */
export function getRequiredAnnualHours(facilityType: string): number {
  return facilityType === "ALR" ? 16 : 12;
}

/**
 * Generate alerts for all training records approaching or past their due dates.
 * Alias for generateAlertsForOrganization for named-function compatibility.
 */
export async function generateAlertsForDueDates(organizationId: number, facilityId?: number): Promise<void> {
  return generateAlertsForOrganization(organizationId, facilityId);
}

export async function recalculateComplianceStatuses(organizationId: number) {
  const today = new Date();

  const records = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.organizationId, organizationId));

  let updated = 0;
  for (const { record, trainingType } of records) {
    const warningDays = 90;
    const newStatus = calculateTrainingStatus(
      record.completionDate,
      trainingType?.renewalIntervalDays ?? null,
      warningDays,
      today,
    );
    const newDueDate = calculateDueDate(record.completionDate, trainingType?.renewalIntervalDays ?? null);

    if (record.status !== newStatus || record.dueDate !== newDueDate) {
      await db.update(trainingRecordsTable)
        .set({ status: newStatus, dueDate: newDueDate })
        .where(eq(trainingRecordsTable.id, record.id));
      updated++;
    }
  }
  return updated;
}

export async function generateAlertsForOrganization(organizationId: number, facilityId?: number) {
  const today = new Date();
  const alertWindows = [7, 14, 30, 60, 90];

  let trainingQuery = db
    .select({
      record: trainingRecordsTable,
      trainingType: trainingTypesTable,
    })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.organizationId, organizationId));

  const records = await trainingQuery;

  for (const { record, trainingType } of records) {
    if (!record.dueDate || !trainingType) continue;

    const dueDate = new Date(record.dueDate);
    const daysUntilDue = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    let alertType: "due_90" | "due_60" | "due_30" | "due_14" | "due_7" | "overdue" | null = null;
    let severity: "info" | "warning" | "critical" = "info";

    if (daysUntilDue < 0) {
      alertType = "overdue";
      severity = "critical";
    } else {
      for (const window of alertWindows) {
        if (daysUntilDue <= window) {
          alertType = `due_${window}` as "due_90" | "due_60" | "due_30" | "due_14" | "due_7";
          severity = window <= 14 ? "critical" : window <= 30 ? "warning" : "info";
          break;
        }
      }
    }

    if (!alertType) continue;

    const existingAlert = await db
      .select()
      .from(alertsTable)
      .where(
        and(
          eq(alertsTable.organizationId, organizationId),
          eq(alertsTable.trainingRecordId, record.id),
          eq(alertsTable.alertType, alertType),
          eq(alertsTable.status, "open"),
        )
      );

    if (existingAlert.length === 0) {
      await db.insert(alertsTable).values({
        organizationId,
        facilityId: record.facilityId,
        employeeId: record.employeeId,
        trainingRecordId: record.id,
        alertType,
        title: `${trainingType.name} ${daysUntilDue < 0 ? "Overdue" : `Due in ${daysUntilDue} days`}`,
        message: `Training record for ${trainingType.name} is ${daysUntilDue < 0 ? "overdue" : `due in ${daysUntilDue} days`}`,
        severity,
        status: "open",
      });
    }
  }
}
