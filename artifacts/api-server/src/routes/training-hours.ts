import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trainingHourBucketsTable, facilitiesTable, employeesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/training-hours", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let query = db.select().from(trainingHourBucketsTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(trainingHourBucketsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(trainingHourBucketsTable.organizationId, Number(req.query.organizationId)));
  }

  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (!assignedFacilityIds || assignedFacilityIds.length === 0) {
      res.json([]); return;
    }
    query = query.where(inArray(trainingHourBucketsTable.facilityId, assignedFacilityIds));
  }

  if (req.query.facilityId) {
    const facilityId = Number(req.query.facilityId);
    if (user.role !== "platform_admin" && user.organizationId) {
      const [fac] = await db.select().from(facilitiesTable).where(
        and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, user.organizationId))
      );
      if (!fac) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    query = query.where(eq(trainingHourBucketsTable.facilityId, facilityId));
  }
  if (req.query.employeeId) {
    query = query.where(eq(trainingHourBucketsTable.employeeId, Number(req.query.employeeId)));
  }
  if (req.query.year) {
    query = query.where(eq(trainingHourBucketsTable.trainingYear, Number(req.query.year)));
  }

  const buckets = await query.orderBy(trainingHourBucketsTable.trainingYear, trainingHourBucketsTable.employeeId);
  res.json(buckets);
});

router.post("/training-hours", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { employeeId, facilityId, trainingYear, requiredHours, completedHours, status } = req.body as {
    employeeId?: number;
    facilityId?: number;
    trainingYear?: number;
    requiredHours?: number;
    completedHours?: number;
    status?: string;
  };

  if (!employeeId || !facilityId || !trainingYear) {
    res.status(400).json({ error: "Required fields: employeeId, facilityId, trainingYear" }); return;
  }

  let resolvedOrgId: number;
  if (user.role === "platform_admin") {
    const bodyOrgId = req.body.organizationId;
    if (!bodyOrgId) { res.status(400).json({ error: "organizationId required for platform_admin" }); return; }
    resolvedOrgId = Number(bodyOrgId);
  } else {
    if (!user.organizationId) { res.status(400).json({ error: "No organization" }); return; }
    resolvedOrgId = user.organizationId;
  }

  const [bucket] = await db.insert(trainingHourBucketsTable).values({
    organizationId: resolvedOrgId,
    facilityId,
    employeeId,
    trainingYear,
    requiredHours: String(requiredHours ?? 12),
    completedHours: String(completedHours ?? 0),
    status: (status as "compliant" | "due_soon" | "incomplete" | "expired") ?? "incomplete",
  }).returning();

  await logAudit(req, "training_hours", bucket.id, "create", null, bucket, resolvedOrgId);
  res.status(201).json(bucket);
});

router.patch("/training-hours/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(trainingHourBucketsTable).where(eq(trainingHourBucketsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training hours record not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const updates: Partial<typeof trainingHourBucketsTable.$inferInsert> = {};
  const { requiredHours, completedHours, status } = req.body as {
    requiredHours?: number;
    completedHours?: number;
    status?: string;
  };

  if (requiredHours !== undefined) updates.requiredHours = String(requiredHours);
  if (completedHours !== undefined) {
    updates.completedHours = String(completedHours);
    const req_ = Number(updates.requiredHours ?? existing.requiredHours);
    const comp = Number(completedHours);
    if (comp >= req_) {
      updates.status = "compliant";
    } else if (comp >= req_ * 0.75) {
      updates.status = "due_soon";
    } else {
      updates.status = "incomplete";
    }
  }
  if (status !== undefined) updates.status = status as "compliant" | "due_soon" | "incomplete" | "expired";

  const [updated] = await db.update(trainingHourBucketsTable)
    .set(updates)
    .where(eq(trainingHourBucketsTable.id, id))
    .returning();
  await logAudit(req, "training_hours", id, "update", existing, updated, existing.organizationId);
  res.json(updated);
});

router.get("/training-hours/:employeeId/:year", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const employeeId = parseInt(String(req.params.employeeId), 10);
  const year = parseInt(String(req.params.year), 10);

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== emp.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [bucket] = await db.select().from(trainingHourBucketsTable)
    .where(and(
      eq(trainingHourBucketsTable.employeeId, employeeId),
      eq(trainingHourBucketsTable.trainingYear, year)
    ));

  if (!bucket) {
    res.json({
      employeeId,
      trainingYear: year,
      requiredHours: "12",
      completedHours: "0",
      status: "incomplete",
    });
    return;
  }

  res.json(bucket);
});

export default router;
