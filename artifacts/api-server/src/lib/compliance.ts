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

export async function generateAlertsForOrganization(organizationId: number, facilityId?: number) {
  const today = new Date();
  const alertWindows = [90, 60, 30, 14, 7];

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
