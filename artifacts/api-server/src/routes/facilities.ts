import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { facilitiesTable, employeesTable, trainingRecordsTable, practicumsTable, trainingHourBucketsTable, trainingTypesTable } from "@workspace/db";
import { eq, and, inArray, SQL, gte, lte, desc } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { buildComplianceSummaryForFacility } from "../lib/compliance";

const router: IRouter = Router();

router.get("/facilities", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conditions: SQL[] = [];

  if (user.role === "platform_admin") {
    if (req.query.organizationId) conditions.push(eq(facilitiesTable.organizationId, Number(req.query.organizationId)));
  } else if (user.organizationId) {
    conditions.push(eq(facilitiesTable.organizationId, user.organizationId));
  } else {
    res.json([]); return;
  }

  if (req.query.facilityType && typeof req.query.facilityType === "string") {
    conditions.push(eq(facilitiesTable.facilityType, req.query.facilityType as "PCH" | "ALR"));
  }
  if (req.query.isActive !== undefined) {
    conditions.push(eq(facilitiesTable.isActive, req.query.isActive === "true"));
  }

  const allFacilities = await db.select().from(facilitiesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(facilitiesTable.name);

  // For facility_manager/trainer: further restrict to assigned facilities
  const assignedIds = await getAssignedFacilityIds(user);
  if (assignedIds !== null) {
    if (assignedIds.length === 0) { res.json([]); return; }
    res.json(allFacilities.filter(f => assignedIds.includes(f.id)));
    return;
  }

  res.json(allFacilities);
});

router.post("/facilities", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { name, facilityType, licenseNumber, address, city, state, zip, phone, administratorName, administratorEmail } = req.body;
  if (!name || !facilityType) { res.status(400).json({ error: "Name and facility type required" }); return; }

  // Derive organizationId from session (never trust client body) for non-platform_admin
  let organizationId: number;
  if (user.role === "platform_admin") {
    const bodyOrgId = Number(req.body.organizationId);
    if (!bodyOrgId) { res.status(400).json({ error: "Organization ID required" }); return; }
    organizationId = bodyOrgId;
  } else {
    if (!user.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
    organizationId = user.organizationId;
  }

  const [facility] = await db.insert(facilitiesTable).values({
    organizationId, name, facilityType, licenseNumber, address, city, state, zip, phone, administratorName, administratorEmail,
  }).returning();

  await logAudit(req, "facility", facility.id, "create", null, facility, organizationId);
  res.status(201).json(facility);
});

router.get("/facilities/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, id));
  if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== facility.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && !assignedIds.includes(facility.id)) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
  }
  res.json(facility);
});

router.patch("/facilities/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Facility not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  const updates: Partial<typeof facilitiesTable.$inferInsert> = {};
  const allowed = ["name", "facilityType", "licenseNumber", "address", "city", "state", "zip", "phone", "administratorName", "administratorEmail", "isActive"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) (updates as Record<string, unknown>)[field] = req.body[field];
  }

  const [updated] = await db.update(facilitiesTable).set(updates).where(eq(facilitiesTable.id, id)).returning();
  await logAudit(req, "facility", id, "update", existing, updated, existing.organizationId);
  res.json(updated);
});

router.delete("/facilities/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Facility not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(facilitiesTable).where(eq(facilitiesTable.id, id));
  await logAudit(req, "facility", id, "delete", existing, null, existing.organizationId);
  res.sendStatus(204);
});

router.get("/facilities/:id/compliance-summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, id));
  if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== facility.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // facility_manager/trainer may only view compliance summary for their assigned facilities
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && !assignedIds.includes(id)) {
      res.status(403).json({ error: "Forbidden: facility not in your assigned facilities" }); return;
    }
  }

  const summary = await buildComplianceSummaryForFacility(id);
  if (!summary) { res.status(404).json({ error: "Facility not found" }); return; }
  res.json(summary);
});

router.get("/facilities/:id/upcoming-due-dates", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, id));
  if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== facility.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && !assignedIds.includes(id)) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const trainingRecs = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable, employee: employeesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .leftJoin(employeesTable, eq(trainingRecordsTable.employeeId, employeesTable.id))
    .where(and(eq(trainingRecordsTable.facilityId, id), eq(trainingRecordsTable.status, "due_soon")));

  const practicumRecs = await db
    .select({ practicum: practicumsTable, employee: employeesTable })
    .from(practicumsTable)
    .leftJoin(employeesTable, eq(practicumsTable.employeeId, employeesTable.id))
    .where(and(eq(practicumsTable.facilityId, id), eq(practicumsTable.status, "due_soon")));

  type UpcomingItem = { id: number; type: string; employeeId: number; employeeName: string | null; trainingTypeName: string | null; dueDate: string | null; status: string };
  const items: UpcomingItem[] = [
    ...trainingRecs.filter(r => r.record.dueDate).map(r => ({
      id: r.record.id, type: "training" as const, employeeId: r.record.employeeId,
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : null,
      trainingTypeName: r.trainingType?.name ?? null, dueDate: r.record.dueDate, status: r.record.status,
    })),
    ...practicumRecs.filter(p => p.practicum.dueDate).map(p => ({
      id: p.practicum.id, type: "practicum" as const, employeeId: p.practicum.employeeId,
      employeeName: p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : null,
      trainingTypeName: `Annual Practicum (${p.practicum.practicumYear})`, dueDate: p.practicum.dueDate, status: p.practicum.status,
    })),
  ];

  items.sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  res.json(items.slice(0, 10));
});

router.get("/facilities/:id/recently-expired", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, id));
  if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== facility.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && !assignedIds.includes(id)) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const trainingRecs = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable, employee: employeesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .leftJoin(employeesTable, eq(trainingRecordsTable.employeeId, employeesTable.id))
    .where(and(eq(trainingRecordsTable.facilityId, id), eq(trainingRecordsTable.status, "expired")));

  const practicumRecs = await db
    .select({ practicum: practicumsTable, employee: employeesTable })
    .from(practicumsTable)
    .leftJoin(employeesTable, eq(practicumsTable.employeeId, employeesTable.id))
    .where(and(eq(practicumsTable.facilityId, id), eq(practicumsTable.status, "expired")));

  type ExpiredItem = { id: number; type: string; employeeId: number; employeeName: string | null; trainingTypeName: string | null; dueDate: string | null; status: string };
  const items: ExpiredItem[] = [
    ...trainingRecs
      .filter(r => r.record.dueDate && new Date(r.record.dueDate) >= sixtyDaysAgo && new Date(r.record.dueDate) <= new Date())
      .map(r => ({
        id: r.record.id, type: "training" as const, employeeId: r.record.employeeId,
        employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : null,
        trainingTypeName: r.trainingType?.name ?? null, dueDate: r.record.dueDate, status: r.record.status,
      })),
    ...practicumRecs
      .filter(p => p.practicum.dueDate && new Date(p.practicum.dueDate) >= sixtyDaysAgo && new Date(p.practicum.dueDate) <= new Date())
      .map(p => ({
        id: p.practicum.id, type: "practicum" as const, employeeId: p.practicum.employeeId,
        employeeName: p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : null,
        trainingTypeName: `Annual Practicum (${p.practicum.practicumYear})`, dueDate: p.practicum.dueDate, status: p.practicum.status,
      })),
  ];

  items.sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
    const db2 = b.dueDate ? new Date(b.dueDate).getTime() : 0;
    return db2 - da;
  });
  res.json(items.slice(0, 10));
});

export default router;
