import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trainingRecordsTable, trainingTypesTable, employeesTable, facilitiesTable } from "@workspace/db";
import { eq, and, inArray, or, isNull, SQL } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { calculateTrainingStatus, calculateDueDate } from "../lib/compliance";
import { z } from "zod";
import { validateBody, validateQuery } from "../lib/validate";

const createTrainingRecordSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  trainingTypeId: z.coerce.number().int().positive(),
  facilityId: z.coerce.number().int().positive(),
  organizationId: z.coerce.number().int().positive().optional(),
  completionDate: z.string().nullish(),
  notes: z.string().nullish(),
  trainerName: z.string().nullish(),
  trainerCredentials: z.string().nullish(),
  trainingProvider: z.string().nullish(),
  certificateNumber: z.string().nullish(),
  score: z.string().nullish(),
  hours: z.string().nullish(),
  completionMethod: z.enum(["in_person", "online", "hybrid", "manual_entry"]).nullish(),
  documentRequired: z.boolean().nullish(),
});

const patchTrainingRecordSchema = z.object({
  completionDate: z.string().nullish(),
  notes: z.string().nullish(),
  trainerName: z.string().nullish(),
  trainerCredentials: z.string().nullish(),
  trainingProvider: z.string().nullish(),
  certificateNumber: z.string().nullish(),
  score: z.string().nullish(),
  hours: z.string().nullish(),
  completionMethod: z.enum(["in_person", "online", "hybrid", "manual_entry"]).nullish(),
  documentRequired: z.boolean().nullish(),
  status: z.enum(["compliant", "due_soon", "expired", "missing", "not_applicable", "pending_review"]).optional(),
  dueDate: z.string().nullish(),
});

const router: IRouter = Router();

router.get("/training-records", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conditions: SQL[] = [];

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    conditions.push(eq(trainingRecordsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    conditions.push(eq(trainingRecordsTable.organizationId, Number(req.query.organizationId)));
  }

  if (user.role === "employee") {
    const [emp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email ?? ""), eq(employeesTable.organizationId, user.organizationId ?? 0))
    );
    if (!emp) { res.json([]); return; }
    conditions.push(eq(trainingRecordsTable.employeeId, emp.id));
  } else if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (!assignedFacilityIds || assignedFacilityIds.length === 0) {
      res.json([]); return;
    }
    conditions.push(inArray(trainingRecordsTable.facilityId, assignedFacilityIds));
  }

  if (req.query.facilityId) {
    const facilityId = Number(req.query.facilityId);
    if (user.role !== "platform_admin" && user.organizationId) {
      const [facility] = await db.select().from(facilitiesTable).where(
        and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, user.organizationId))
      );
      if (!facility) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    conditions.push(eq(trainingRecordsTable.facilityId, facilityId));
  }
  if (req.query.employeeId) conditions.push(eq(trainingRecordsTable.employeeId, Number(req.query.employeeId)));
  if (req.query.status && typeof req.query.status === "string") {
    conditions.push(eq(trainingRecordsTable.status, req.query.status as "compliant" | "due_soon" | "expired" | "missing" | "not_applicable" | "pending_review"));
  }
  if (req.query.trainingTypeId) conditions.push(eq(trainingRecordsTable.trainingTypeId, Number(req.query.trainingTypeId)));

  const records = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json(records.map(r => ({ ...r.record, trainingType: r.trainingType })));
});

router.post("/training-records", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const body = validateBody(createTrainingRecordSchema, req, res);
  if (!body) return;

  const { employeeId, trainingTypeId, facilityId, completionDate, notes, trainerName, trainerCredentials, trainingProvider, certificateNumber, score, hours, completionMethod, documentRequired } = body;

  // Derive organizationId from session, not client body
  let resolvedOrgId: number;
  if (user.role === "platform_admin") {
    if (!body.organizationId) { res.status(400).json({ error: "organizationId required for platform_admin" }); return; }
    resolvedOrgId = body.organizationId;
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

  // Enforce facility-assignment check for facility_manager/trainer
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && !assignedFacilityIds.includes(Number(facilityId))) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
  }

  const [trainingType] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, Number(trainingTypeId)));
  const dueDate = calculateDueDate(completionDate ?? null, trainingType?.renewalIntervalDays ?? null);
  const status = calculateTrainingStatus(completionDate ?? null, trainingType?.renewalIntervalDays ?? null, trainingType?.warningDaysDefault ?? 90);

  const insertValues: typeof trainingRecordsTable.$inferInsert = {
    organizationId: resolvedOrgId,
    facilityId: Number(facilityId),
    employeeId: Number(employeeId),
    trainingTypeId: Number(trainingTypeId),
    completionDate: completionDate ?? null,
    dueDate: dueDate,
    status,
    notes: notes ?? null,
    trainerName: trainerName ?? null,
    trainerCredentials: trainerCredentials ?? null,
    trainingProvider: trainingProvider ?? null,
    certificateNumber: certificateNumber ?? null,
    score: score != null ? String(score) : null,
    hours: hours != null ? String(hours) : null,
    completionMethod: completionMethod ?? null,
    documentRequired: documentRequired ?? trainingType?.documentRequired ?? false,
  };
  const [record] = await db.insert(trainingRecordsTable).values(insertValues).returning();

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
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && result.record.facilityId !== null && !assignedFacilityIds.includes(result.record.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
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

  // Enforce facility-assignment check for facility_manager/trainer
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && existing.facilityId !== null && !assignedFacilityIds.includes(existing.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
  }

  const patchBody = validateBody(patchTrainingRecordSchema, req, res);
  if (!patchBody) return;

  const updates: Partial<typeof trainingRecordsTable.$inferInsert> = {};
  const allowed = ["completionDate", "notes", "trainerName", "trainerCredentials", "trainingProvider", "certificateNumber", "score", "hours", "completionMethod", "documentRequired", "status", "dueDate"] as const;
  for (const field of allowed) {
    if (patchBody[field] !== undefined) (updates as Record<string, unknown>)[field] = patchBody[field];
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
  // facility_manager may only verify records in their assigned facilities
  if (user.role === "facility_manager") {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && existing.facilityId !== null && !assignedFacilityIds.includes(existing.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
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
  // facility_manager may only delete records in their assigned facilities
  if (user.role === "facility_manager") {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && existing.facilityId !== null && !assignedFacilityIds.includes(existing.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
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

  const empConditions: SQL[] = [eq(employeesTable.status, "active")];

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    empConditions.push(eq(employeesTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    empConditions.push(eq(employeesTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.facilityId) {
    empConditions.push(eq(employeesTable.facilityId, Number(req.query.facilityId)));
  }
  if (req.query.administersMedications !== undefined) {
    empConditions.push(eq(employeesTable.administersMedications, req.query.administersMedications === "true"));
  }
  if (req.query.trainerOnly !== undefined) {
    empConditions.push(eq(employeesTable.trainerStatus, req.query.trainerOnly === "true"));
  }

  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (!assignedFacilityIds || assignedFacilityIds.length === 0) {
      res.json([]); return;
    }
    empConditions.push(inArray(employeesTable.facilityId, assignedFacilityIds));
  }

  const employees = await db.select().from(employeesTable)
    .where(and(...empConditions))
    .orderBy(employeesTable.lastName, employeesTable.firstName);

  // Scope training types to system defaults or org-specific (prevents cross-tenant type leakage)
  const orgId = user.role === "platform_admin"
    ? (req.query.organizationId ? Number(req.query.organizationId) : null)
    : user.organizationId;
  const trainingTypeFilter = orgId
    ? and(
        eq(trainingTypesTable.isActive, true),
        or(eq(trainingTypesTable.isSystemDefault, true), eq(trainingTypesTable.organizationId, orgId))
      )
    : eq(trainingTypesTable.isActive, true);
  const trainingTypes = await db.select().from(trainingTypesTable).where(trainingTypeFilter);

  const recConditions: SQL[] = [];
  if (user.role !== "platform_admin" && user.organizationId) {
    recConditions.push(eq(trainingRecordsTable.organizationId, user.organizationId));
  }
  const records = await db.select().from(trainingRecordsTable)
    .where(recConditions.length > 0 ? and(...recConditions) : undefined);

  const rows = employees.map(emp => {
    const empRecords = records.filter(r => r.employeeId === emp.id);
    const cells = trainingTypes.map(tt => {
      const record = empRecords.find(r => r.trainingTypeId === tt.id);
      return {
        trainingTypeId: tt.id,
        trainingRecordId: record?.id ?? null,
        status: record?.status ?? "missing",
        completionDate: record?.completionDate ?? null,
        dueDate: record?.dueDate ?? null,
        hasDocument: false,
      };
    });
    return {
      employee: {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        jobTitle: emp.jobTitle,
        facilityId: emp.facilityId,
        administersMedications: emp.administersMedications,
        trainerStatus: emp.trainerStatus,
      },
      cells,
    };
  });

  res.json({ trainingTypes, rows });
});

export default router;
