import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { facilitiesTable, employeesTable, trainingRecordsTable, practicumsTable, trainingHourBucketsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { buildComplianceSummaryForFacility } from "../lib/compliance";

const router: IRouter = Router();

router.get("/facilities", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let query = db.select().from(facilitiesTable).$dynamic();

  if (user.role === "platform_admin") {
    if (req.query.organizationId) query = query.where(eq(facilitiesTable.organizationId, Number(req.query.organizationId)));
  } else if (user.organizationId) {
    query = query.where(eq(facilitiesTable.organizationId, user.organizationId));
    // For facility_manager/trainer: further restrict to assigned facilities
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null) {
      if (assignedIds.length === 0) { res.json([]); return; }
      const allFacilities = await query.orderBy(facilitiesTable.name);
      res.json(allFacilities.filter(f => assignedIds.includes(f.id)));
      return;
    }
  } else {
    res.json([]); return;
  }

  if (req.query.facilityType && typeof req.query.facilityType === "string") {
    query = query.where(eq(facilitiesTable.facilityType, req.query.facilityType as "PCH" | "ALR"));
  }
  if (req.query.isActive !== undefined) {
    query = query.where(eq(facilitiesTable.isActive, req.query.isActive === "true"));
  }

  const facilities = await query.orderBy(facilitiesTable.name);
  res.json(facilities);
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

export default router;
