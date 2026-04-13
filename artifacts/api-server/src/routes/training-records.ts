import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trainingRecordsTable, trainingTypesTable, employeesTable, facilitiesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { calculateTrainingStatus, calculateDueDate } from "../lib/compliance";

const router: IRouter = Router();

router.get("/training-records", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let query = db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(trainingRecordsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(trainingRecordsTable.organizationId, Number(req.query.organizationId)));
  }

  if (user.role === "employee") {
    const [emp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email ?? ""), eq(employeesTable.organizationId, user.organizationId ?? 0))
    );
    if (!emp) { res.json([]); return; }
    query = query.where(eq(trainingRecordsTable.employeeId, emp.id));
  } else if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (!assignedFacilityIds || assignedFacilityIds.length === 0) {
      res.json([]); return;
    }
    query = query.where(inArray(trainingRecordsTable.facilityId, assignedFacilityIds));
  }

  if (req.query.facilityId) {
    const facilityId = Number(req.query.facilityId);
    if (user.role !== "platform_admin" && user.organizationId) {
      const [facility] = await db.select().from(facilitiesTable).where(
        and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, user.organizationId))
      );
      if (!facility) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    query = query.where(eq(trainingRecordsTable.facilityId, facilityId));
  }
  if (req.query.employeeId) query = query.where(eq(trainingRecordsTable.employeeId, Number(req.query.employeeId)));
  if (req.query.status && typeof req.query.status === "string") {
    query = query.where(eq(trainingRecordsTable.status, req.query.status as "compliant" | "due_soon" | "expired" | "missing" | "not_applicable" | "pending_review"));
  }
  if (req.query.trainingTypeId) query = query.where(eq(trainingRecordsTable.trainingTypeId, Number(req.query.trainingTypeId)));

  const records = await query;
  res.json(records.map(r => ({ ...r.record, trainingType: r.trainingType })));
});

router.post("/training-records", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { employeeId, trainingTypeId, facilityId, completionDate, notes, trainerName, trainerCredentials, trainingProvider, certificateNumber, score, hours, completionMethod, documentRequired } = req.body;
  if (!employeeId || !trainingTypeId || !facilityId) {
    res.status(400).json({ error: "Required fields: employeeId, trainingTypeId, facilityId" }); return;
  }

  // Derive organizationId from session, not client body
  let resolvedOrgId: number;
  if (user.role === "platform_admin") {
    const bodyOrgId = req.body.organizationId;
    if (!bodyOrgId) { res.status(400).json({ error: "organizationId required for platform_admin" }); return; }
    resolvedOrgId = Number(bodyOrgId);
  } else {
    if (!user.organizationId) { res.status(403).json({ error: "User has no organization" }); return; }
    resolvedOrgId = user.organizationId;
  }

  // Validate employee belongs to caller's organization
  const [employee] = await db.select().from(employeesTable).where(
    and(eq(employeesTable.id, Number(employeeId)), eq(employeesTable.organizationId, resolvedOrgId))
  );
  if (!employee) { res.status(400).json({ error: "Employee not found in your organization" }); return; }

  // Validate facility belongs to caller's organization
  const [facility] = await db.select().from(facilitiesTable).where(
    and(eq(facilitiesTable.id, Number(facilityId)), eq(facilitiesTable.organizationId, resolvedOrgId))
  );
  if (!facility) { res.status(400).json({ error: "Facility not found in your organization" }); return; }

  const [trainingType] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, Number(trainingTypeId)));
  const dueDate = calculateDueDate(completionDate ?? null, trainingType?.renewalIntervalDays ?? null);
  const status = calculateTrainingStatus(completionDate ?? null, trainingType?.renewalIntervalDays ?? null, trainingType?.warningDaysDefault ?? 90);

  const [record] = await db.insert(trainingRecordsTable).values({
    organizationId: resolvedOrgId,
    facilityId: Number(facilityId),
    employeeId: Number(employeeId),
    trainingTypeId: Number(trainingTypeId),
    completionDate, dueDate, status, notes, trainerName, trainerCredentials, trainingProvider,
    certificateNumber, score, hours, completionMethod,
    documentRequired: documentRequired ?? trainingType?.documentRequired ?? false,
  }).returning();

  await logAudit(req, "training_record", record.id, "create", null, record, resolvedOrgId);
  res.status(201).json({ ...record, trainingType });
});

router.get("/training-records/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [result] = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.id, id));

  if (!result) { res.status(404).json({ error: "Training record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== result.record.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (user.role === "employee") {
    const [selfEmp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email ?? ""), eq(employeesTable.organizationId, user.organizationId ?? 0))
    );
    if (!selfEmp || result.record.employeeId !== selfEmp.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  res.json({ ...result.record, trainingType: result.trainingType });
});

router.patch("/training-records/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const updates: Partial<typeof trainingRecordsTable.$inferInsert> = {};
  const allowed = ["completionDate", "notes", "trainerName", "trainerCredentials", "trainingProvider", "certificateNumber", "score", "hours", "completionMethod", "documentRequired", "status", "dueDate"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) (updates as Record<string, unknown>)[field] = req.body[field];
  }

  if (updates.completionDate !== undefined || updates.dueDate === undefined) {
    const [trainingType] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, existing.trainingTypeId));
    const completionDate = (updates.completionDate as string | undefined) ?? existing.completionDate;
    updates.dueDate = calculateDueDate(completionDate ?? null, trainingType?.renewalIntervalDays ?? null);
    updates.status = calculateTrainingStatus(completionDate ?? null, trainingType?.renewalIntervalDays ?? null, trainingType?.warningDaysDefault ?? 90);
  }

  const [updated] = await db.update(trainingRecordsTable).set(updates).where(eq(trainingRecordsTable.id, id)).returning();
  await logAudit(req, "training_record", id, "update", existing, updated, existing.organizationId);
  res.json(updated);
});

async function handleVerifyTrainingRecord(req: import("express").Request, res: import("express").Response): Promise<void> {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [updated] = await db.update(trainingRecordsTable)
    .set({ status: "compliant", verifiedByUserId: user.id, verifiedAt: new Date().toISOString() })
    .where(eq(trainingRecordsTable.id, id))
    .returning();
  await logAudit(req, "training_record", id, "verify", existing, updated, existing.organizationId);
  res.json(updated);
}

router.post("/training-records/:id/verify", requireAuth, (req, res) => handleVerifyTrainingRecord(req, res));
router.patch("/training-records/:id/verify", requireAuth, (req, res) => handleVerifyTrainingRecord(req, res));

router.delete("/training-records/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  await db.delete(trainingRecordsTable).where(eq(trainingRecordsTable.id, id));
  await logAudit(req, "training_record", id, "delete", existing, null, existing.organizationId);
  res.sendStatus(204);
});

router.get("/training-matrix", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (user.role === "employee") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  let employeeQuery = db.select().from(employeesTable).where(eq(employeesTable.status, "active")).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    employeeQuery = employeeQuery.where(eq(employeesTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    employeeQuery = employeeQuery.where(eq(employeesTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.facilityId) {
    employeeQuery = employeeQuery.where(eq(employeesTable.facilityId, Number(req.query.facilityId)));
  }
  if (req.query.administersMedications !== undefined) {
    employeeQuery = employeeQuery.where(eq(employeesTable.administersMedications, req.query.administersMedications === "true"));
  }
  if (req.query.trainerOnly !== undefined) {
    employeeQuery = employeeQuery.where(eq(employeesTable.trainerStatus, req.query.trainerOnly === "true"));
  }

  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (!assignedFacilityIds || assignedFacilityIds.length === 0) {
      res.json([]); return;
    }
    employeeQuery = employeeQuery.where(inArray(employeesTable.facilityId, assignedFacilityIds));
  }

  const employees = await employeeQuery.orderBy(employeesTable.lastName, employeesTable.firstName);

  const trainingTypes = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.isActive, true));

  let recordsQuery = db.select().from(trainingRecordsTable).$dynamic();
  if (user.role !== "platform_admin" && user.organizationId) {
    recordsQuery = recordsQuery.where(eq(trainingRecordsTable.organizationId, user.organizationId));
  }
  const records = await recordsQuery;

  const matrix = employees.map(emp => {
    const empRecords = records.filter(r => r.employeeId === emp.id);
    const trainingStatus = trainingTypes.map(tt => {
      const record = empRecords.find(r => r.trainingTypeId === tt.id);
      return {
        trainingTypeId: tt.id,
        trainingTypeName: tt.name,
        status: record?.status ?? "missing",
        lastCompletionDate: record?.completionDate ?? null,
        dueDate: record?.dueDate ?? null,
        expirationDate: null,
      };
    });
    return {
      employeeId: emp.id,
      employeeFirstName: emp.firstName,
      employeeLastName: emp.lastName,
      jobTitle: emp.jobTitle,
      facilityId: emp.facilityId,
      administersMedications: emp.administersMedications,
      trainerStatus: emp.trainerStatus,
      trainingStatus,
    };
  });

  res.json(matrix);
});

export default router;
