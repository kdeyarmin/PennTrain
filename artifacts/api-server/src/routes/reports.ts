import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  employeesTable, trainingRecordsTable, trainingTypesTable,
  practicumsTable, trainingHourBucketsTable, facilitiesTable, trainingDocumentsTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";

const router: IRouter = Router();

function getOrgFilter(user: { role: string; organizationId: number | null; _realRole?: string }, queryOrgId?: string) {
  if ((user._realRole === "platform_admin" || user.role === "platform_admin") && queryOrgId) return Number(queryOrgId);
  return user.organizationId ?? null;
}

function isEmployee(user: { role: string }): boolean {
  return user.role === "employee";
}

function isPlatformAdmin(user: { role: string; _realRole?: string }): boolean {
  return user.role === "platform_admin" || user._realRole === "platform_admin";
}

async function filterEmployeesByFacilityAssignment<T extends { facilityId: number | null }>(
  user: Parameters<typeof getAssignedFacilityIds>[0],
  employees: T[]
): Promise<T[]> {
  if (!["facility_manager", "trainer"].includes(user.role)) return employees;
  const assignedIds = await getAssignedFacilityIds(user);
  if (assignedIds === null) return employees;
  return employees.filter(e => e.facilityId !== null && assignedIds.includes(e.facilityId));
}

async function filterRecordsByFacilityAssignment<T extends { facilityId: number | null }>(
  user: Parameters<typeof getAssignedFacilityIds>[0],
  records: T[]
): Promise<T[]> {
  if (!["facility_manager", "trainer"].includes(user.role)) return records;
  const assignedIds = await getAssignedFacilityIds(user);
  if (assignedIds === null) return records;
  return records.filter(r => r.facilityId !== null && assignedIds.includes(r.facilityId));
}

router.get("/reports/medication-administration", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  let employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.administersMedications, true))
  );
  employees = await filterEmployeesByFacilityAssignment(user, employees);
  if (req.query.facilityId) {
    const facilityId = Number(req.query.facilityId);
    employees = employees.filter(e => e.facilityId === facilityId);
  }

  const records = await getTrainingRecordsForEmployees(employees.map(e => e.id), orgId);
  res.json({ reportType: "medication_administration", employees, trainingRecords: records, generatedAt: new Date().toISOString() });
});

router.get("/reports/annual-practicum", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const year = Number(req.query.year) || new Date().getFullYear();
  let practicums = await db.select().from(practicumsTable).where(
    and(eq(practicumsTable.organizationId, orgId), eq(practicumsTable.practicumYear, year))
  );
  practicums = await filterRecordsByFacilityAssignment(user, practicums);

  let employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.administersMedications, true), eq(employeesTable.status, "active"))
  );
  employees = await filterEmployeesByFacilityAssignment(user, employees);

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
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const year = Number(req.query.year) || new Date().getFullYear();
  let buckets = await db.select().from(trainingHourBucketsTable).where(
    and(eq(trainingHourBucketsTable.organizationId, orgId), eq(trainingHourBucketsTable.trainingYear, year))
  );
  buckets = await filterRecordsByFacilityAssignment(user, buckets);

  res.json({ reportType: "training_hours", year, buckets, generatedAt: new Date().toISOString() });
});

router.get("/reports/trainer-certification", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  let trainers = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.trainerStatus, true))
  );
  trainers = await filterEmployeesByFacilityAssignment(user, trainers);

  const records = await getTrainingRecordsForEmployees(trainers.map(e => e.id), orgId);

  res.json({ reportType: "trainer_certification", trainers, trainingRecords: records, generatedAt: new Date().toISOString() });
});

router.get("/reports/expiring-certifications", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const rawRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.status, "due_soon")));
  const filteredRecords = await filterRecordsByFacilityAssignment(user, rawRecords.map(r => r.record));
  const filteredIds = new Set(filteredRecords.map(r => r.id));

  res.json({ reportType: "expiring_certifications", records: rawRecords.filter(r => filteredIds.has(r.record.id)).map(r => ({ ...r.record, trainingType: r.trainingType })), generatedAt: new Date().toISOString() });
});

router.get("/reports/overdue-training", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const rawRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.status, "expired")));
  const filteredRecords = await filterRecordsByFacilityAssignment(user, rawRecords.map(r => r.record));
  const filteredIds = new Set(filteredRecords.map(r => r.id));

  res.json({ reportType: "overdue_training", records: rawRecords.filter(r => filteredIds.has(r.record.id)).map(r => ({ ...r.record, trainingType: r.trainingType })), generatedAt: new Date().toISOString() });
});

router.get("/reports/new-employee-training", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const cutoffDate = req.query.hireDateAfter as string || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  let employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.status, "active"), gte(employeesTable.hireDate, cutoffDate))
  );
  employees = await filterEmployeesByFacilityAssignment(user, employees);

  res.json({ reportType: "new_employee_training", employees, hireDateAfter: cutoffDate, generatedAt: new Date().toISOString() });
});

router.get("/reports/facility-compliance", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  let facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.organizationId, orgId));
  // Apply assignment-based filtering for facility_manager/trainer
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null) {
      facilities = facilities.filter(f => assignedIds.includes(f.id));
    }
  }
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
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
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

router.get("/reports/survey-readiness", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const [employees, allRecords, allPracticums, allDocs, allBuckets, facilities] = await Promise.all([
    db.select().from(employeesTable).where(and(eq(employeesTable.organizationId, orgId), eq(employeesTable.status, "active"))),
    db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.organizationId, orgId)),
    db.select().from(practicumsTable).where(and(eq(practicumsTable.organizationId, orgId), eq(practicumsTable.practicumYear, new Date().getFullYear()))),
    db.select().from(trainingDocumentsTable).where(eq(trainingDocumentsTable.organizationId, orgId)),
    db.select().from(trainingHourBucketsTable).where(and(eq(trainingHourBucketsTable.organizationId, orgId), eq(trainingHourBucketsTable.trainingYear, new Date().getFullYear()))),
    db.select().from(facilitiesTable).where(eq(facilitiesTable.organizationId, orgId)),
  ]);

  const totalActive = employees.length;
  const medAdminStaff = employees.filter(e => e.administersMedications).length;
  const trainers = employees.filter(e => e.trainerStatus).length;
  const compliantRecords = allRecords.filter(r => r.status === "compliant").length;
  const expiredRecords = allRecords.filter(r => r.status === "expired").length;
  const dueSoonRecords = allRecords.filter(r => r.status === "due_soon").length;
  const practicumsCompliant = allPracticums.filter(p => p.status === "compliant").length;
  const bucketsCompliant = allBuckets.filter(b => Number(b.completedHours) >= Number(b.requiredHours)).length;
  const overallScore = allRecords.length > 0 ? Math.round((compliantRecords / allRecords.length) * 100) : 100;

  const readinessChecks = [
    { check: "All medication administration staff have current certifications", status: expiredRecords === 0 ? "pass" : "fail", detail: `${expiredRecords} expired certification(s)` },
    { check: "Annual practicums completed for all med admin staff", status: practicumsCompliant >= medAdminStaff ? "pass" : (practicumsCompliant > 0 ? "partial" : "fail"), detail: `${practicumsCompliant}/${medAdminStaff} completed` },
    { check: "Annual training hours requirements met", status: bucketsCompliant >= totalActive ? "pass" : (bucketsCompliant > 0 ? "partial" : "fail"), detail: `${bucketsCompliant}/${totalActive} staff met requirement` },
    { check: "Supporting documentation uploaded", status: allDocs.length > 0 ? "pass" : "fail", detail: `${allDocs.length} document(s) on file` },
    { check: "No certifications due within 30 days", status: dueSoonRecords === 0 ? "pass" : "warning", detail: `${dueSoonRecords} certification(s) due soon` },
    { check: "Designated trainers on staff", status: trainers > 0 ? "pass" : "fail", detail: `${trainers} trainer(s) designated` },
  ];

  const passCount = readinessChecks.filter(c => c.status === "pass").length;
  const surveyReadinessScore = Math.round((passCount / readinessChecks.length) * 100);

  res.json({
    reportType: "survey_readiness",
    overallComplianceScore: overallScore,
    surveyReadinessScore,
    totalFacilities: facilities.length,
    totalActiveStaff: totalActive,
    medAdminStaff,
    trainers,
    compliantRecords,
    expiredRecords,
    dueSoonRecords,
    readinessChecks,
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

router.get("/reports/compliance-summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }
  const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

  let employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.status, "active"))
  );
  employees = await filterEmployeesByFacilityAssignment(user, employees);
  const filtered = facilityId ? employees.filter(e => e.facilityId === facilityId) : employees;

  const records = await getTrainingRecordsForEmployees(filtered.map(e => e.id), orgId);
  const statuses = records.map(r => r.record.status);
  const compliantCount = statuses.filter(s => s === "compliant").length;
  const expiredCount = statuses.filter(s => s === "expired").length;
  const dueSoonCount = statuses.filter(s => s === "due_soon").length;
  const total = statuses.length;

  res.json({
    reportType: "compliance_summary",
    organizationId: orgId,
    facilityId: facilityId ?? null,
    totalEmployees: filtered.length,
    totalRecords: total,
    compliantCount,
    expiredCount,
    dueSoonCount,
    compliancePercentage: total > 0 ? Math.round((compliantCount / total) * 100) : 100,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/reports/expired-training", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const rawRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.status, "expired")));
  const filteredIds = new Set((await filterRecordsByFacilityAssignment(user, rawRecords.map(r => r.record))).map(r => r.id));
  res.json({ reportType: "expired_training", records: rawRecords.filter(r => filteredIds.has(r.record.id)).map(r => ({ ...r.record, trainingTypeName: r.trainingType?.name })), generatedAt: new Date().toISOString() });
});

router.get("/reports/due-soon", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const rawRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.status, "due_soon")));
  const filteredIds = new Set((await filterRecordsByFacilityAssignment(user, rawRecords.map(r => r.record))).map(r => r.id));
  res.json({ reportType: "due_soon", records: rawRecords.filter(r => filteredIds.has(r.record.id)).map(r => ({ ...r.record, trainingTypeName: r.trainingType?.name })), generatedAt: new Date().toISOString() });
});

router.get("/reports/missing-documents", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  const rawRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(and(eq(trainingRecordsTable.organizationId, orgId), eq(trainingRecordsTable.status, "missing")));
  const filteredIds = new Set((await filterRecordsByFacilityAssignment(user, rawRecords.map(r => r.record))).map(r => r.id));
  res.json({ reportType: "missing_documents", records: rawRecords.filter(r => filteredIds.has(r.record.id)).map(r => ({ ...r.record, trainingTypeName: r.trainingType?.name })), generatedAt: new Date().toISOString() });
});

router.get("/reports/practicum-status", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }
  const year = Number(req.query.year) || new Date().getFullYear();

  let practicums = await db.select().from(practicumsTable).where(
    and(eq(practicumsTable.organizationId, orgId), eq(practicumsTable.practicumYear, year))
  );
  practicums = await filterRecordsByFacilityAssignment(user, practicums);
  let employees = await db.select().from(employeesTable).where(
    and(eq(employeesTable.organizationId, orgId), eq(employeesTable.administersMedications, true))
  );
  employees = await filterEmployeesByFacilityAssignment(user, employees);

  res.json({
    reportType: "practicum_status",
    year,
    practicums,
    employees,
    compliantCount: practicums.filter(p => p.status === "compliant").length,
    pendingCount: practicums.filter(p => p.status !== "compliant").length,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/reports/annual-hours", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }
  const year = Number(req.query.year) || new Date().getFullYear();

  let buckets = await db.select().from(trainingHourBucketsTable).where(
    and(eq(trainingHourBucketsTable.organizationId, orgId), eq(trainingHourBucketsTable.trainingYear, year))
  );
  buckets = await filterRecordsByFacilityAssignment(user, buckets);

  res.json({
    reportType: "annual_hours",
    year,
    buckets,
    compliantCount: buckets.filter(b => b.status === "compliant").length,
    incompleteCount: buckets.filter(b => b.status === "incomplete").length,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/reports/employee-transcript", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }

  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  if (!isPlatformAdmin(user as { role: string; _realRole?: string }) && user.organizationId !== employee.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  if (user.role === "employee") {
    const [selfEmp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email ?? ""), eq(employeesTable.organizationId, user.organizationId ?? 0))
    );
    if (!selfEmp || selfEmp.id !== employeeId) { res.status(403).json({ error: "Employees may only view their own transcript" }); return; }
  }

  const currentYear = new Date().getFullYear();
  const [trainingRecords, practicums, annualHours, documents] = await Promise.all([
    db
      .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
      .from(trainingRecordsTable)
      .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
      .where(eq(trainingRecordsTable.employeeId, employeeId)),
    db.select().from(practicumsTable).where(
      and(eq(practicumsTable.employeeId, employeeId), eq(practicumsTable.practicumYear, currentYear))
    ),
    db.select().from(trainingHourBucketsTable).where(
      and(eq(trainingHourBucketsTable.employeeId, employeeId), eq(trainingHourBucketsTable.trainingYear, currentYear))
    ),
    db.select().from(trainingDocumentsTable).where(eq(trainingDocumentsTable.employeeId, employeeId)),
  ]);

  res.json({
    employee,
    trainingRecords: trainingRecords.map(r => ({ ...r.record, trainingTypeName: r.trainingType?.name })),
    practicums,
    annualHours,
    documents,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/reports/org-compliance", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role !== "platform_admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const records = await db.select().from(trainingRecordsTable);
  const employees = await db.select().from(employeesTable).where(eq(employeesTable.status, "active"));
  const facilities = await db.select().from(facilitiesTable);

  const orgMap = new Map<number, { orgId: number; totalRecords: number; compliantCount: number; expiredCount: number; dueSoonCount: number; totalEmployees: number; totalFacilities: number }>();

  for (const r of records) {
    if (!r.organizationId) continue;
    if (!orgMap.has(r.organizationId)) orgMap.set(r.organizationId, { orgId: r.organizationId, totalRecords: 0, compliantCount: 0, expiredCount: 0, dueSoonCount: 0, totalEmployees: 0, totalFacilities: 0 });
    const entry = orgMap.get(r.organizationId)!;
    entry.totalRecords++;
    if (r.status === "compliant") entry.compliantCount++;
    else if (r.status === "expired") entry.expiredCount++;
    else if (r.status === "due_soon") entry.dueSoonCount++;
  }
  for (const e of employees) {
    if (!e.organizationId) continue;
    if (!orgMap.has(e.organizationId)) orgMap.set(e.organizationId, { orgId: e.organizationId, totalRecords: 0, compliantCount: 0, expiredCount: 0, dueSoonCount: 0, totalEmployees: 0, totalFacilities: 0 });
    orgMap.get(e.organizationId)!.totalEmployees++;
  }
  for (const f of facilities) {
    if (!orgMap.has(f.organizationId)) orgMap.set(f.organizationId, { orgId: f.organizationId, totalRecords: 0, compliantCount: 0, expiredCount: 0, dueSoonCount: 0, totalEmployees: 0, totalFacilities: 0 });
    orgMap.get(f.organizationId)!.totalFacilities++;
  }

  const orgSummaries = Array.from(orgMap.values()).map(o => ({
    ...o,
    compliancePercentage: o.totalRecords > 0 ? Math.round((o.compliantCount / o.totalRecords) * 100) : 100,
  }));

  res.json({
    reportType: "org_compliance",
    organizations: orgSummaries,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/reports/training-matrix", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isEmployee(user)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = getOrgFilter(user, req.query.organizationId as string);
  if (!orgId) { res.status(400).json({ error: "Organization required" }); return; }

  let employees = await db.select().from(employeesTable).where(eq(employeesTable.organizationId, orgId));
  employees = await filterEmployeesByFacilityAssignment(user, employees);

  const allRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.organizationId, orgId));

  const filteredRecordIds = new Set(
    (await filterRecordsByFacilityAssignment(user, allRecords.map(r => r.record))).map(r => r.id)
  );
  const filteredRecords = allRecords.filter(r => filteredRecordIds.has(r.record.id));

  const trainingTypes = await db.select().from(trainingTypesTable).where(
    eq(trainingTypesTable.organizationId, orgId)
  );

  const employeeIds = new Set(employees.map(e => e.id));
  const matrix = employees.map(emp => {
    const empRecords = filteredRecords.filter(r => r.record.employeeId === emp.id);
    const statusByType: Record<number, string> = {};
    for (const r of empRecords) {
      if (r.record.trainingTypeId) statusByType[r.record.trainingTypeId] = r.record.status;
    }
    return { employeeId: emp.id, employeeName: `${emp.firstName} ${emp.lastName}`, facilityId: emp.facilityId, jobTitle: emp.jobTitle, statusByType };
  });

  res.json({
    reportType: "training_matrix",
    trainingTypes,
    matrix,
    employeeCount: employeeIds.size,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
