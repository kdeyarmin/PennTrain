import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { facilityUserAssignmentsTable, usersTable, facilitiesTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/facility-user-assignments", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const conditions: SQL[] = [];

  if (req.query.facilityId) {
    conditions.push(eq(facilityUserAssignmentsTable.facilityId, Number(req.query.facilityId)));
  } else if (req.query.userId) {
    conditions.push(eq(facilityUserAssignmentsTable.userId, Number(req.query.userId)));
  }

  if (user.role !== "platform_admin" && user.organizationId) {
    conditions.push(eq(facilitiesTable.organizationId, user.organizationId));
  }

  const assignments = await db.select({
    id: facilityUserAssignmentsTable.id,
    userId: facilityUserAssignmentsTable.userId,
    facilityId: facilityUserAssignmentsTable.facilityId,
    createdAt: facilityUserAssignmentsTable.createdAt,
    userFirstName: usersTable.firstName,
    userLastName: usersTable.lastName,
    userRole: usersTable.role,
    facilityName: facilitiesTable.name,
  })
    .from(facilityUserAssignmentsTable)
    .innerJoin(usersTable, eq(facilityUserAssignmentsTable.userId, usersTable.id))
    .innerJoin(facilitiesTable, eq(facilityUserAssignmentsTable.facilityId, facilitiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json(assignments);
});

router.post("/facility-user-assignments", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { userId, facilityId } = req.body as { userId?: number; facilityId?: number };
  if (!userId || !facilityId) { res.status(400).json({ error: "userId and facilityId are required" }); return; }

  if (user.role !== "platform_admin") {
    const [facility] = await db.select().from(facilitiesTable).where(
      and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, user.organizationId!))
    );
    if (!facility) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const [existing] = await db.select().from(facilityUserAssignmentsTable)
    .where(and(eq(facilityUserAssignmentsTable.userId, userId), eq(facilityUserAssignmentsTable.facilityId, facilityId)));

  if (existing) { res.status(409).json({ error: "Assignment already exists" }); return; }

  const [assignment] = await db.insert(facilityUserAssignmentsTable).values({ userId, facilityId }).returning();
  res.status(201).json(assignment);
});

router.delete("/facility-user-assignments/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const [existing] = await db.select({
    id: facilityUserAssignmentsTable.id,
    facilityId: facilityUserAssignmentsTable.facilityId,
    orgId: facilitiesTable.organizationId,
  })
    .from(facilityUserAssignmentsTable)
    .innerJoin(facilitiesTable, eq(facilityUserAssignmentsTable.facilityId, facilitiesTable.id))
    .where(eq(facilityUserAssignmentsTable.id, id));

  if (!existing) { res.status(404).json({ error: "Assignment not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.orgId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(facilityUserAssignmentsTable).where(eq(facilityUserAssignmentsTable.id, id));
  res.sendStatus(204);
});

export default router;
