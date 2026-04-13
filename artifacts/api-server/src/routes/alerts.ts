import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db";
import { eq, and, inArray, SQL } from "drizzle-orm";
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

  const conditions: SQL[] = [];

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    conditions.push(eq(alertsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    conditions.push(eq(alertsTable.organizationId, Number(req.query.organizationId)));
  }

  // Facility-assignment scoping for facility_manager/trainer
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (!assignedIds || assignedIds.length === 0) { res.json([]); return; }
    conditions.push(inArray(alertsTable.facilityId, assignedIds));
  }

  if (req.query.facilityId) conditions.push(eq(alertsTable.facilityId, Number(req.query.facilityId)));
  if (req.query.status && typeof req.query.status === "string") {
    conditions.push(eq(alertsTable.status, req.query.status as "open" | "dismissed" | "resolved"));
  }
  if (req.query.severity && typeof req.query.severity === "string") {
    conditions.push(eq(alertsTable.severity, req.query.severity as "info" | "warning" | "critical"));
  }

  const alerts = await db.select().from(alertsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(alertsTable.createdAt);

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
  if (!organizationId) { res.status(400).json({ error: "organizationId required" }); return; }

  const count = await generateAlertsForOrganization(organizationId);
  res.json({ generated: count, organizationId });
});

router.post("/alerts", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { facilityId, employeeId, alertType, severity, title, message } = req.body;
  if (!alertType || !severity || !message) {
    res.status(400).json({ error: "Required: alertType, severity, message" }); return;
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

  if (["facility_manager", "trainer"].includes(user.role) && facilityId) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && !assignedIds.includes(Number(facilityId))) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
  }

  const [alert] = await db.insert(alertsTable).values({
    organizationId: resolvedOrgId,
    facilityId: facilityId ? Number(facilityId) : null,
    employeeId: employeeId ? Number(employeeId) : null,
    alertType, severity,
    title: title ?? message,
    message,
    status: "open",
  }).returning();

  res.status(201).json(alert);
});

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

  const { status, severity, message } = req.body as {
    status?: "open" | "dismissed" | "resolved";
    severity?: "info" | "warning" | "critical";
    message?: string;
  };

  const updates: Partial<typeof alertsTable.$inferInsert> = {};
  if (status !== undefined) updates.status = status;
  if (severity !== undefined) updates.severity = severity;
  if (message !== undefined) updates.message = message;

  const [updated] = await db.update(alertsTable).set(updates).where(eq(alertsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/alerts/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Alert not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!await assertAlertFacilityAccess(user, existing, res)) return;

  await db.delete(alertsTable).where(eq(alertsTable.id, id));
  res.status(204).send();
});

router.post("/alerts/bulk-dismiss", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { ids } = req.body as { ids?: number[] };
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array required" }); return;
  }

  const alerts = await db.select().from(alertsTable).where(inArray(alertsTable.id, ids));
  for (const alert of alerts) {
    if (user.role !== "platform_admin" && user.organizationId !== alert.organizationId) {
      res.status(403).json({ error: "Forbidden: cross-org alert in bulk request" }); return;
    }
    if (!await assertAlertFacilityAccess(user, alert, res)) return;
  }

  await db.update(alertsTable).set({ status: "dismissed" }).where(inArray(alertsTable.id, ids));
  res.json({ dismissed: ids.length });
});

export default router;
