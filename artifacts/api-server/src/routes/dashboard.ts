import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  organizationsTable, facilitiesTable, employeesTable,
  trainingRecordsTable, practicumsTable, alertsTable, trainingHourBucketsTable,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { buildComplianceSummaryForFacility } from "../lib/compliance";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const orgId = user.role === "platform_admin"
    ? (req.query.organizationId ? Number(req.query.organizationId) : null)
    : user.organizationId;

  if (user.role === "platform_admin" && !orgId) {
    const orgs = await db.select().from(organizationsTable);
    const facilities = await db.select().from(facilitiesTable);
    const employees = await db.select().from(employeesTable).where(eq(employeesTable.status, "active"));
    const openAlerts = await db.select({ count: count() }).from(alertsTable).where(eq(alertsTable.status, "open"));
    const trainingRecords = await db.select().from(trainingRecordsTable);
    const compliant = trainingRecords.filter(r => r.status === "compliant").length;
    const total = trainingRecords.length;

    res.json({
      totalOrganizations: orgs.length,
      totalFacilities: facilities.length,
      totalEmployees: employees.length,
      openAlertsCount: openAlerts[0]?.count ?? 0,
      compliancePercentage: total > 0 ? Math.round((compliant / total) * 100) : 100,
      recentActivity: [],
    });
    return;
  }

  if (!orgId) { res.status(400).json({ error: "Organization ID required" }); return; }

  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.organizationId, orgId));
  const facilityFilter = req.query.facilityId ? eq(trainingRecordsTable.facilityId, Number(req.query.facilityId)) : undefined;

  let trainingQuery = db.select().from(trainingRecordsTable).where(
    facilityFilter ? and(eq(trainingRecordsTable.organizationId, orgId), facilityFilter) : eq(trainingRecordsTable.organizationId, orgId)
  );
  const trainingRecords = await trainingQuery;

  let employeeQuery = db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.status, "active"))
  );
  const employees = await employeeQuery;
  const medAdminStaff = employees.filter(e => e.administersMedications);

  const currentYear = new Date().getFullYear();
  const practicums = await db.select().from(practicumsTable).where(
    and(eq(practicumsTable.organizationId, orgId), eq(practicumsTable.practicumYear, currentYear))
  );
  const hourBuckets = await db.select().from(trainingHourBucketsTable).where(
    and(eq(trainingHourBucketsTable.organizationId, orgId), eq(trainingHourBucketsTable.trainingYear, currentYear))
  );

  const openAlerts = await db.select({ count: count() }).from(alertsTable).where(
    and(eq(alertsTable.organizationId, orgId), eq(alertsTable.status, "open"))
  );
  const criticalAlerts = await db.select({ count: count() }).from(alertsTable).where(
    and(eq(alertsTable.organizationId, orgId), eq(alertsTable.status, "open"), eq(alertsTable.severity, "critical"))
  );

  const statuses = trainingRecords.map(r => r.status);
  const compliantCount = statuses.filter(s => s === "compliant").length;
  const dueSoonCount = statuses.filter(s => s === "due_soon").length;
  const expiredCount = statuses.filter(s => s === "expired").length;
  const missingCount = statuses.filter(s => s === "missing").length;
  const total = statuses.length;
  const complianceScore = total > 0 ? Math.round((compliantCount / total) * 100) : 100;

  res.json({
    organizationId: orgId,
    totalFacilities: facilities.length,
    totalEmployees: employees.length,
    medAdminStaff: medAdminStaff.length,
    compliantCount,
    dueSoonCount,
    expiredCount,
    missingCount,
    complianceScore,
    openAlertsCount: openAlerts[0]?.count ?? 0,
    criticalAlertsCount: criticalAlerts[0]?.count ?? 0,
    practicumsDue: practicums.filter(p => p.status === "missing" || p.status === "due_soon").length,
    practiculumsCompliant: practicums.filter(p => p.status === "compliant").length,
    annualHoursIncomplete: hourBuckets.filter(h => h.status === "incomplete").length,
    recentActivity: [],
  });
});

router.get("/dashboard/compliance-by-facility", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let facilities;
  if (user.role === "platform_admin") {
    const q = db.select().from(facilitiesTable).$dynamic();
    facilities = await (req.query.organizationId
      ? q.where(eq(facilitiesTable.organizationId, Number(req.query.organizationId)))
      : q);
  } else if (user.organizationId) {
    facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.organizationId, user.organizationId));
  } else {
    res.json([]); return;
  }

  const summaries = await Promise.all(facilities.map(f => buildComplianceSummaryForFacility(f.id)));
  res.json(summaries.filter(Boolean));
});

router.get("/dashboard/upcoming-due-dates", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const days = Math.min(Number(req.query.days) || 30, 90);
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + days);

  let trainingQuery = db.select({
    id: trainingRecordsTable.id,
    employeeId: trainingRecordsTable.employeeId,
    facilityId: trainingRecordsTable.facilityId,
    organizationId: trainingRecordsTable.organizationId,
    dueDate: trainingRecordsTable.dueDate,
    status: trainingRecordsTable.status,
  }).from(trainingRecordsTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    trainingQuery = trainingQuery.where(eq(trainingRecordsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    trainingQuery = trainingQuery.where(eq(trainingRecordsTable.organizationId, Number(req.query.organizationId)));
  }

  const records = await trainingQuery;
  const upcoming = records.filter(r => {
    if (!r.dueDate) return false;
    const dueDate = new Date(r.dueDate);
    return dueDate >= today && dueDate <= future;
  });

  res.json({ count: upcoming.length, records: upcoming, daysAhead: days });
});

router.get("/dashboard/recent-activity", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const since = new Date();
  since.setDate(since.getDate() - 30);

  let query = db.select().from(trainingRecordsTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(trainingRecordsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(trainingRecordsTable.organizationId, Number(req.query.organizationId)));
  }

  const records = await query;
  const recentActivity = records
    .filter(r => r.updatedAt && new Date(r.updatedAt) >= since)
    .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime())
    .slice(0, limit)
    .map(r => ({
      id: r.id,
      type: "training_record_update",
      employeeId: r.employeeId,
      facilityId: r.facilityId,
      status: r.status,
      updatedAt: r.updatedAt,
    }));

  res.json({ count: recentActivity.length, activities: recentActivity });
});

export default router;
