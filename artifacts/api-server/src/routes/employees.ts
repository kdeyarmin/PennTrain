import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { employeesTable, trainingRecordsTable, trainingTypesTable, practicumsTable, trainingHourBucketsTable, trainingDocumentsTable } from "@workspace/db";
import { eq, and, or, ilike } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/employees", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let query = db.select().from(employeesTable).$dynamic();

  if (user.role === "employee") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(employeesTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(employeesTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.facilityId) query = query.where(eq(employeesTable.facilityId, Number(req.query.facilityId)));
  if (req.query.status && typeof req.query.status === "string") query = query.where(eq(employeesTable.status, req.query.status as "active" | "inactive" | "terminated" | "on_leave"));
  if (req.query.administersMedications !== undefined) query = query.where(eq(employeesTable.administersMedications, req.query.administersMedications === "true"));
  if (req.query.trainerStatus !== undefined) query = query.where(eq(employeesTable.trainerStatus, req.query.trainerStatus === "true"));
  if (req.query.search && typeof req.query.search === "string") {
    const s = `%${req.query.search}%`;
    query = query.where(or(ilike(employeesTable.firstName, s), ilike(employeesTable.lastName, s), ilike(employeesTable.jobTitle, s)));
  }

  const employees = await query.orderBy(employeesTable.lastName, employeesTable.firstName);
  res.json(employees);
});

router.post("/employees", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { organizationId, facilityId, firstName, lastName, jobTitle, status, administersMedications, trainerStatus, ...rest } = req.body;
  if (!organizationId || !facilityId || !firstName || !lastName || !jobTitle) {
    res.status(400).json({ error: "Required fields missing" }); return;
  }

  const [employee] = await db.insert(employeesTable).values({
    organizationId, facilityId, firstName, lastName, jobTitle,
    status: status || "active",
    administersMedications: administersMedications ?? false,
    trainerStatus: trainerStatus ?? false,
    ...rest,
  }).returning();

  await logAudit(req, "employee", employee.id, "create", null, employee, organizationId);
  res.status(201).json(employee);
});

router.get("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== employee.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json(employee);
});

router.patch("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Employee not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  const updates: Partial<typeof employeesTable.$inferInsert> = {};
  const allowed = ["employeeNumber", "firstName", "lastName", "email", "phone", "hireDate", "terminationDate", "jobTitle", "department", "status", "administersMedications", "trainerStatus", "notes", "facilityId"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) (updates as Record<string, unknown>)[field] = req.body[field];
  }

  const [updated] = await db.update(employeesTable).set(updates).where(eq(employeesTable.id, id)).returning();
  await logAudit(req, "employee", id, "update", existing, updated, existing.organizationId);
  res.json(updated);
});

router.delete("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Employee not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(employeesTable).where(eq(employeesTable.id, id));
  await logAudit(req, "employee", id, "delete", existing, null, existing.organizationId);
  res.sendStatus(204);
});

router.get("/employees/:id/compliance-summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== employee.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  const trainingRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.employeeId, id));

  const practicums = await db.select().from(practicumsTable).where(eq(practicumsTable.employeeId, id));
  const annualHours = await db.select().from(trainingHourBucketsTable).where(eq(trainingHourBucketsTable.employeeId, id));
  const documents = await db.select().from(trainingDocumentsTable).where(eq(trainingDocumentsTable.employeeId, id));

  const statuses = trainingRecords.map(r => r.record.status);
  const overallStatus = statuses.includes("expired") ? "expired" :
    statuses.includes("due_soon") ? "due_soon" :
    statuses.includes("missing") ? "missing" : "compliant";

  res.json({
    employeeId: id,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    status: employee.status,
    administersMedications: employee.administersMedications,
    trainerStatus: employee.trainerStatus,
    trainingRecords: trainingRecords.map(r => ({ ...r.record, trainingType: r.trainingType })),
    practicums,
    annualHours,
    documents,
    overallStatus,
  });
});

export default router;
