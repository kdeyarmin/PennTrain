import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  employeesTable, trainingRecordsTable, trainingTypesTable,
  practicumsTable, trainingHourBucketsTable, facilitiesTable, trainingDocumentsTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

function getOrgFilter(user: { role: string; organizationId: number | null }, queryOrgId?: string) {
  if (user.role === "platform_admin" && queryOrgId) return Number(queryOrgId);
  return user.organizationId ?? null;
}

router.get("/reports/medication-administration", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.administersMedications, true))
  );
  if (req.query.facilityId) {
    const facilityId = Number(req.query.facilityId);
    const filtered = employees.filter(e => e.facilityId === facilityId);
    const records = await getTrainingRecordsForEmployees(filtered.map(e => e.id), orgId);
    res.json({ reportType: "medication_administration", employees: filtered, trainingRecords: records, generatedAt: new Date().toISOString() });
    return;
  }

  const records = await getTrainingRecordsForEmployees(employees.map(e => e.id), orgId);
  res.json({ reportType: "medication_administration", employees, trainingRecords: records, generatedAt: new Date().toISOString() });
});

router.get("/reports/annual-practicum", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const year = Number(req.query.year) || new Date().getFullYear();
  let query = db.select().from(practicumsTable).where(
    and(eq(practicumsTable.organizationId, orgId), eq(practicumsTable.practicumYear, year))
  );
  const practicums = await query;

  const employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.administersMedications, true), eq(employeesTable.status, "active"))
  );

  res.json({
    reportType: "annual_practicum",
    year,
    totalRequired: employees.length,
    completed: practicums.filter(p => p.status === "compliant").length,
    pending: practicums.filter(p => p.status !== "compliant").length,
    practicums,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/reports/training-hours", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const year = Number(req.query.year) || new Date().getFullYear();
  const buckets = await db.select().from(trainingHourBucketsTable).where(
    and(eq(trainingHourBucketsTable.organizationId, orgId), eq(trainingHourBucketsTable.trainingYear, year))
  );

  res.json({ reportType: "training_hours", year, buckets, generatedAt: new Date().toISOString() });
});

router.get("/reports/trainer-certification", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const trainers = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.trainerStatus, true))
  );

  const records = await getTrainingRecordsForEmployees(trainers.map(e => e.id), orgId);

  res.json({ reportType: "trainer_certification", trainers, trainingRecords: records, generatedAt: new Date().toISOString() });
});

router.get("/reports/expiring-certifications", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const records = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.status, "due_soon")));

  res.json({ reportType: "expiring_certifications", records: records.map(r => ({ ...r.record, trainingType: r.trainingType })), generatedAt: new Date().toISOString() });
});

router.get("/reports/overdue-training", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const records = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.status, "expired")));

  res.json({ reportType: "overdue_training", records: records.map(r => ({ ...r.record, trainingType: r.trainingType })), generatedAt: new Date().toISOString() });
});

router.get("/reports/new-employee-training", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const cutoffDate = req.query.hireDateAfter as string || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.status, "active"), gte(employeesTable.hireDate, cutoffDate))
  );

  res.json({ reportType: "new_employee_training", employees, hireDateAfter: cutoffDate, generatedAt: new Date().toISOString() });
});

router.get("/reports/facility-compliance", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.organizationId, orgId));
  const facilityData = await Promise.all(facilities.map(async (facility) => {
    const records = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.facilityId, facility.id));
    const total = records.length;
    const compliant = records.filter(r => r.status === "compliant").length;
    return {
      facilityId: facility.id,
      facilityName: facility.name,
      facilityType: facility.facilityType,
      total,
      compliantCount: compliant,
      complianceScore: total > 0 ? Math.round((compliant / total) * 100) : 100,
      expiredCount: records.filter(r => r.status === "expired").length,
      dueSoonCount: records.filter(r => r.status === "due_soon").length,
    };
  }));

  res.json({ reportType: "facility_compliance", facilities: facilityData, generatedAt: new Date().toISOString() });
});

router.get("/reports/employee-compliance/:employeeId", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const employeeId = parseInt(Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId, 10);
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== employee.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  const records = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.employeeId, employeeId));

  const currentYear = new Date().getFullYear();
  const practicums = await db.select().from(practicumsTable).where(
    and(eq(practicumsTable.employeeId, employeeId), eq(practicumsTable.practicumYear, currentYear))
  );
  const hourBuckets = await db.select().from(trainingHourBucketsTable).where(
    and(eq(trainingHourBucketsTable.employeeId, employeeId), eq(trainingHourBucketsTable.trainingYear, currentYear))
  );

  res.json({
    reportType: "employee_compliance",
    employee,
    trainingRecords: records.map(r => ({ ...r.record, trainingType: r.trainingType })),
    practicums,
    hourBuckets,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/reports/document-audit", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const documents = await db.select().from(trainingDocumentsTable).where(eq(trainingDocumentsTable.organizationId, orgId));
  const missingDocs = await db.select().from(trainingRecordsTable).where(
    and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.documentRequired, true))
  );

  res.json({
    reportType: "document_audit",
    totalDocuments: documents.length,
    documents,
    recordsRequiringDocs: missingDocs.length,
    generatedAt: new Date().toISOString(),
  });
});

async function getTrainingRecordsForEmployees(employeeIds: number[], orgId: number) {
  if (employeeIds.length === 0) return [];
  return db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.organizationId, orgId))
    .then(rows => rows.filter(r => employeeIds.includes(r.record.employeeId)));
}

export default router;
