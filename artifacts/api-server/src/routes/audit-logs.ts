import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/audit-logs", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const conditions: SQL[] = [];

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    conditions.push(eq(auditLogsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    conditions.push(eq(auditLogsTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.entityType && typeof req.query.entityType === "string") {
    conditions.push(eq(auditLogsTable.entityType, req.query.entityType));
  }
  if (req.query.entityId && typeof req.query.entityId === "string") {
    conditions.push(eq(auditLogsTable.entityId, req.query.entityId));
  }
  if (req.query.userId) {
    conditions.push(eq(auditLogsTable.userId, Number(req.query.userId)));
  }
  if (req.query.action && typeof req.query.action === "string") {
    conditions.push(eq(auditLogsTable.action, req.query.action));
  }

  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const query = db.select().from(auditLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(auditLogsTable.createdAt)
    .limit(limit);

  const logs = await query;
  res.json(logs);
});

export default router;
