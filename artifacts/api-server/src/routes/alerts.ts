import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { generateAlertsForOrganization } from "../lib/compliance";

const router: IRouter = Router();

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

  const alerts = await query.orderBy(alertsTable.createdAt);
  res.json(alerts);
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

  const [updated] = await db.update(alertsTable).set({
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  }).where(eq(alertsTable.id, id)).returning();
  res.json(updated);
});

export default router;
