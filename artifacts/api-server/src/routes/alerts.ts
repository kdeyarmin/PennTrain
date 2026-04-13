import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { generateAlertsForOrganization } from "../lib/compliance";

const router: IRouter = Router();

async function assertAlertFacilityAccess(
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  alert: typeof alertsTable.$inferSelect,
  res: Response,
): Promise<boolean> {
  if (!user) return false;
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && alert.facilityId !== null && !assignedIds.includes(alert.facilityId)) {
      res.status(403).json({ error: "Forbidden: alert not in your assigned facilities" });
      return false;
    }
  }
  return true;
}

router.get("/alerts", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let query = db.select().from(alertsTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(alertsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(alertsTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.facilityId) query = query.where(eq(alertsTable.facilityId, Number(req.query.facilityId)));
  if (req.query.status && typeof req.query.status === "string") {
    query = query.where(eq(alertsTable.status, req.query.status as "open" | "dismissed" | "resolved"));
  }
  if (req.query.severity && typeof req.query.severity === "string") {
    query = query.where(eq(alertsTable.severity, req.query.severity as "info" | "warning" | "critical"));
  }

  let alerts = await query.orderBy(alertsTable.createdAt);

  // Scope facility_manager/trainer to their assigned facilities
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null) {
      alerts = alerts.filter(a => a.facilityId !== null && assignedIds.includes(a.facilityId));
    }
  }

  res.json(alerts);
});

router.get("/alerts/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [alert] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!alert) { res.status(404).json({ error: "Alert not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== alert.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!await assertAlertFacilityAccess(user, alert, res)) return;

  res.json(alert);
});

router.post("/alerts/generate", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const organizationId = user.role === "platform_admin" ? Number(req.body.organizationId) : user.organizationId;
  if (!organizationId) { res.status(400).json({ error: "Organization ID required" }); return; }

  await generateAlertsForOrganization(organizationId);
  res.json({ message: "Alerts generated" });
});

router.patch("/alerts/:id/dismiss", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Alert not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!await assertAlertFacilityAccess(user, existing, res)) return;

  const [updated] = await db.update(alertsTable).set({ status: "dismissed" }).where(eq(alertsTable.id, id)).returning();
  res.json(updated);
});

router.patch("/alerts/:id/resolve", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Alert not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!await assertAlertFacilityAccess(user, existing, res)) return;

  const [updated] = await db.update(alertsTable).set({
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  }).where(eq(alertsTable.id, id)).returning();
  res.json(updated);
});

router.patch("/alerts/:id/assign", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { assignedToUserId } = req.body;

  const [existing] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Alert not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!await assertAlertFacilityAccess(user, existing, res)) return;

  const [updated] = await db.update(alertsTable)
    .set({ assignedToUserId: assignedToUserId ?? null })
    .where(eq(alertsTable.id, id))
    .returning();
  res.json(updated);
});

async function handleBulkUpdate(req: Request, res: Response): Promise<void> {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { ids, status } = req.body as { ids?: number[]; status?: string };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array required" }); return; }
  if (!status || !["dismissed", "resolved", "open"].includes(status)) { res.status(400).json({ error: "Valid status required" }); return; }

  // Fetch all referenced alerts to enforce org + facility-assignment scoping
  const existingAlerts = await db.select().from(alertsTable).where(inArray(alertsTable.id, ids));
  const assignedIds = ["facility_manager", "trainer"].includes(user.role) ? await getAssignedFacilityIds(user) : null;

  const allowedIds = existingAlerts
    .filter(a => {
      if (user.role !== "platform_admin" && user.organizationId !== a.organizationId) return false;
      if (assignedIds !== null && a.facilityId !== null && !assignedIds.includes(a.facilityId)) return false;
      return true;
    })
    .map(a => a.id);

  if (allowedIds.length === 0) { res.status(403).json({ error: "Forbidden: no accessible alerts in request" }); return; }

  const setValues: Partial<typeof alertsTable.$inferInsert> = { status: status as "open" | "dismissed" | "resolved" };
  if (status === "resolved") setValues.resolvedAt = new Date().toISOString();

  const updated = await db.update(alertsTable).set(setValues).where(inArray(alertsTable.id, allowedIds)).returning();
  res.json({ updated: updated.length });
}

router.patch("/alerts/bulk", requireAuth, (req, res) => handleBulkUpdate(req, res));
router.post("/alerts/bulk-update", requireAuth, (req, res) => handleBulkUpdate(req, res));

router.patch("/alerts/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Alert not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!await assertAlertFacilityAccess(user, existing, res)) return;

  const { status, assignedToUserId } = req.body as { status?: string; assignedToUserId?: number | null };
  const setValues: Partial<typeof alertsTable.$inferInsert> = {};
  if (status && ["open", "dismissed", "resolved"].includes(status)) {
    setValues.status = status as "open" | "dismissed" | "resolved";
    if (status === "resolved") setValues.resolvedAt = new Date().toISOString();
  }
  if (assignedToUserId !== undefined) {
    setValues.assignedToUserId = assignedToUserId ?? null;
  }

  if (Object.keys(setValues).length === 0) {
    res.status(400).json({ error: "No valid fields to update" }); return;
  }

  const [updated] = await db.update(alertsTable).set(setValues).where(eq(alertsTable.id, id)).returning();
  res.json(updated);
});

export default router;
