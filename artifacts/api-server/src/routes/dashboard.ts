import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  organizationsTable, facilitiesTable, employeesTable,
  trainingRecordsTable, practicumsTable, alertsTable, trainingHourBucketsTable,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { buildComplianceSummaryForFacility } from "../lib/compliance";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role === "employee") { res.status(403).json({ error: "Forbidden" }); return; }

  const effectiveUser = user as { _realRole?: string; role: string; organizationId: number | null };
  const orgId = (effectiveUser._realRole === "platform_admin" || effectiveUser.role === "platform_admin")
    ? (req.query.organizationId ? Number(req.query.organizationId) : (effectiveUser.organizationId ?? null))
    : effectiveUser.organizationId;

  if (effectiveUser._realRole === "platform_admin" && !orgId) {
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

  let allFacilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.organizationId, orgId));

  // Restrict facility_manager and trainer to only their assigned facilities
  let assignedFacilityIds: number[] | null = null;
  if (["facility_manager", "trainer"].includes(user.role)) {
    assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null) {
      allFacilities = allFacilities.filter(f => assignedFacilityIds!.includes(f.id));
    }
  }

  const facilityIdFilter = req.query.facilityId
    ? Number(req.query.facilityId)
    : (assignedFacilityIds?.length === 1 ? assignedFacilityIds[0] : undefined);

  const facilityFilter = facilityIdFilter ? eq(trainingRecordsTable.facilityId, facilityIdFilter) : undefined;

  let trainingRecords: (typeof trainingRecordsTable.$inferSelect)[];
  if (assignedFacilityIds !== null && assignedFacilityIds.length > 0) {
    const records = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.organizationId, orgId));
    trainingRecords = records.filter(r => r.facilityId !== null && assignedFacilityIds!.includes(r.facilityId));
  } else if (assignedFacilityIds !== null && assignedFacilityIds.length === 0) {
    trainingRecords = [];
  } else {
    trainingRecords = await db.select().from(trainingRecordsTable).where(
      facilityFilter ? and(eq(trainingRecordsTable.organizationId, orgId), facilityFilter) : eq(trainingRecordsTable.organizationId, orgId)
    );
  }

  let employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.status, "active"))
  );
  if (assignedFacilityIds !== null) {
    employees = employees.filter(e => e.facilityId !== null && assignedFacilityIds!.includes(e.facilityId));
  }
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
  const expiredCount = statuses.filter(s => s === "expired").length;
  const missingDocumentCount = statuses.filter(s => s === "missing").length;
  const dueSoon30Count = statuses.filter(s => s === "due_soon").length;
  const total = statuses.length;
  const compliancePercentage = total > 0 ? Math.round((compliantCount / total) * 100) : 100;
  const trainersDueForRecert = medAdminStaff.filter(e => e.trainerStatus).length;

  res.json({
    organizationId: orgId,
    totalFacilities: allFacilities.length,
    totalEmployees: employees.length,
    totalMedAdminStaff: medAdminStaff.length,
    compliantCount,
    dueSoon30Count,
    dueSoon90Count: dueSoon30Count,
    expiredCount,
    missingDocumentCount,
    compliancePercentage,
    trainersDueForRecert,
    openAlertsCount: openAlerts[0]?.count ?? 0,
    criticalAlertsCount: criticalAlerts[0]?.count ?? 0,
    practicumsDue: practicums.filter(p => p.status === "missing" || p.status === "due_soon").length,
    practicumsCompliant: practicums.filter(p => p.status === "compliant").length,
    annualHoursIncomplete: hourBuckets.filter(h => h.status === "incomplete").length,
    recentUploadsCount: 0,
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
    // Restrict facility_manager and trainer to only their assigned facilities
    if (["facility_manager", "trainer"].includes(user.role)) {
      const assignedFacilityIds = await getAssignedFacilityIds(user);
      if (assignedFacilityIds !== null) {
        facilities = facilities.filter(f => assignedFacilityIds.includes(f.id));
      }
    }
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

  let records = await trainingQuery;

  // Restrict facility_manager and trainer to only their assigned facilities
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null) {
      records = records.filter(r => r.facilityId !== null && assignedFacilityIds.includes(r.facilityId));
    }
  }

  const upcoming = records.filter(r => {
    if (!r.dueDate) return false;
    const dueDate = new Date(r.dueDate);
    return dueDate >= today && dueDate <= future;
  });

  res.json(upcoming);
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

  let records = await query;

  // Restrict facility_manager and trainer to only their assigned facilities
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null) {
      records = records.filter(r => r.facilityId !== null && assignedFacilityIds.includes(r.facilityId));
    }
  }

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

// Compliance trends: monthly snapshot of compliant/expired/due_soon counts over last N months
router.get("/dashboard/compliance-trends", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role === "employee") { res.status(403).json({ error: "Forbidden" }); return; }

  const months = Math.min(Number(req.query.months) || 6, 24);

  let allRecords = await (() => {
    if (user.role === "platform_admin") {
      const q = db.select().from(trainingRecordsTable).$dynamic();
      return req.query.organizationId
        ? q.where(eq(trainingRecordsTable.organizationId, Number(req.query.organizationId)))
        : q;
    } else {
      if (!user.organizationId) return Promise.resolve([] as (typeof trainingRecordsTable.$inferSelect)[]);
      return db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.organizationId, user.organizationId));
    }
  })();

  // Restrict facility_manager and trainer to only their assigned facilities
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null) {
      allRecords = allRecords.filter(r => r.facilityId !== null && assignedFacilityIds.includes(r.facilityId));
    }
  }

  // Build monthly buckets by dueDate month
  const now = new Date();
  const trend: Array<{ month: string; compliant: number; expired: number; dueSoon: number; total: number }> = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthRecords = allRecords.filter(r => {
      if (!r.dueDate) return false;
      const rd = new Date(r.dueDate);
      return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth();
    });
    trend.push({
      month: label,
      compliant: monthRecords.filter(r => r.status === "compliant").length,
      expired: monthRecords.filter(r => r.status === "expired").length,
      dueSoon: monthRecords.filter(r => r.status === "due_soon").length,
      total: monthRecords.length,
    });
  }

  // Also include overall current snapshot
  const total = allRecords.length;
  const compliant = allRecords.filter(r => r.status === "compliant").length;
  const expired = allRecords.filter(r => r.status === "expired").length;
  const dueSoon = allRecords.filter(r => r.status === "due_soon").length;

  res.json({
    trend,
    current: {
      total,
      compliant,
      expired,
      dueSoon,
      compliancePercentage: total > 0 ? Math.round((compliant / total) * 100) : 100,
    },
    generatedAt: new Date().toISOString(),
  });
});

export default router;
