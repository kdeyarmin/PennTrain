import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trainingRecordsTable, trainingTypesTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";
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

  if (req.query.facilityId) query = query.where(eq(trainingRecordsTable.facilityId, Number(req.query.facilityId)));
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

  const { organizationId, facilityId, employeeId, trainingTypeId, completionDate, notes, trainerName, trainerCredentials, trainingProvider, certificateNumber, score, hours, completionMethod, documentRequired } = req.body;
  if (!organizationId || !facilityId || !employeeId || !trainingTypeId) {
    res.status(400).json({ error: "Required fields missing" }); return;
  }

  const [trainingType] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, Number(trainingTypeId)));
  const dueDate = calculateDueDate(completionDate ?? null, trainingType?.renewalIntervalDays ?? null);
  const status = calculateTrainingStatus(completionDate ?? null, trainingType?.renewalIntervalDays ?? null, trainingType?.warningDaysDefault ?? 90);

  const [record] = await db.insert(trainingRecordsTable).values({
    organizationId, facilityId, employeeId, trainingTypeId,
    completionDate, dueDate, status, notes, trainerName, trainerCredentials, trainingProvider,
    certificateNumber, score, hours, completionMethod,
    documentRequired: documentRequired ?? trainingType?.documentRequired ?? false,
  }).returning();

  await logAudit(req, "training_record", record.id, "create", null, record, organizationId);
  res.status(201).json({ ...record, trainingType });
});

router.get("/training-records/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [result] = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.id, id));

  if (!result) { res.status(404).json({ error: "Training record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== result.record.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  res.json({ ...result.record, trainingType: result.trainingType });
});

router.patch("/training-records/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

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

router.delete("/training-records/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(trainingRecordsTable).where(eq(trainingRecordsTable.id, id));
  await logAudit(req, "training_record", id, "delete", existing, null, existing.organizationId);
  res.sendStatus(204);
});

export default router;
