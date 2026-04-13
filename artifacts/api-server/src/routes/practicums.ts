import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { practicumsTable, employeesTable, facilitiesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/practicums", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let query = db.select().from(practicumsTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(practicumsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(practicumsTable.organizationId, Number(req.query.organizationId)));
  }

  if (user.role === "employee") {
    const [emp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email ?? ""), eq(employeesTable.organizationId, user.organizationId ?? 0))
    );
    if (!emp) { res.json([]); return; }
    query = query.where(eq(practicumsTable.employeeId, emp.id));
  } else if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (!assignedFacilityIds || assignedFacilityIds.length === 0) {
      res.json([]); return;
    }
    query = query.where(inArray(practicumsTable.facilityId, assignedFacilityIds));
  }

  if (req.query.facilityId) {
    const facilityId = Number(req.query.facilityId);
    if (user.role !== "platform_admin" && user.organizationId) {
      const [facility] = await db.select().from(facilitiesTable).where(
        and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, user.organizationId))
      );
      if (!facility) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    query = query.where(eq(practicumsTable.facilityId, facilityId));
  }
  if (req.query.employeeId) query = query.where(eq(practicumsTable.employeeId, Number(req.query.employeeId)));
  const yearParam = req.query.year ?? req.query.practicumYear;
  if (yearParam) query = query.where(eq(practicumsTable.practicumYear, Number(yearParam)));
  if (req.query.status && typeof req.query.status === "string") {
    query = query.where(eq(practicumsTable.status, req.query.status as "compliant" | "due_soon" | "expired" | "missing"));
  }

  const practicums = await query.orderBy(practicumsTable.practicumYear, practicumsTable.employeeId);
  res.json(practicums);
});

router.post("/practicums", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { employeeId, facilityId, practicumYear, completionDate, observedBy, marReviewCompleted, directObservationCompleted, remediationRequired, remediationNotes, notes, dueDate, status } = req.body;
  if (!employeeId || !facilityId || !practicumYear) {
    res.status(400).json({ error: "Required fields: employeeId, facilityId, practicumYear" }); return;
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

  const [practicum] = await db.insert(practicumsTable).values({
    organizationId: resolvedOrgId,
    facilityId: Number(facilityId),
    employeeId: Number(employeeId),
    practicumYear: Number(practicumYear),
    completionDate, observedBy, dueDate,
    marReviewCompleted: marReviewCompleted ?? false,
    directObservationCompleted: directObservationCompleted ?? false,
    remediationRequired: remediationRequired ?? false,
    remediationNotes, notes,
    status: status ?? (completionDate ? "compliant" : "missing"),
  }).returning();

  await logAudit(req, "practicum", practicum.id, "create", null, practicum, resolvedOrgId);
  res.status(201).json(practicum);
});

router.get("/practicums/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [practicum] = await db.select().from(practicumsTable).where(eq(practicumsTable.id, id));
  if (!practicum) { res.status(404).json({ error: "Practicum not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== practicum.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(practicum);
});

router.patch("/practicums/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(practicumsTable).where(eq(practicumsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Practicum not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const updates: Partial<typeof practicumsTable.$inferInsert> = {};
  const allowed = ["completionDate", "observedBy", "marReviewCompleted", "directObservationCompleted", "remediationRequired", "remediationNotes", "notes", "dueDate", "status", "verifiedByUserId", "verifiedAt"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) (updates as Record<string, unknown>)[field] = req.body[field];
  }

  if (updates.completionDate && !updates.status) {
    updates.status = "compliant";
  }

  const [updated] = await db.update(practicumsTable).set(updates).where(eq(practicumsTable.id, id)).returning();
  await logAudit(req, "practicum", id, "update", existing, updated, existing.organizationId);
  res.json(updated);
});

router.delete("/practicums/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(practicumsTable).where(eq(practicumsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Practicum not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  await db.delete(practicumsTable).where(eq(practicumsTable.id, id));
  await logAudit(req, "practicum", id, "delete", existing, null, existing.organizationId);
  res.sendStatus(204);
});

export default router;
