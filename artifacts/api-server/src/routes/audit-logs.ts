import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/audit-logs", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  let query = db.select().from(auditLogsTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(auditLogsTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(auditLogsTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.entityType && typeof req.query.entityType === "string") {
    query = query.where(eq(auditLogsTable.entityType, req.query.entityType));
  }
  if (req.query.entityId && typeof req.query.entityId === "string") {
    query = query.where(eq(auditLogsTable.entityId, req.query.entityId));
  }
  if (req.query.userId) {
    query = query.where(eq(auditLogsTable.userId, Number(req.query.userId)));
  }
  if (req.query.action && typeof req.query.action === "string") {
    query = query.where(eq(auditLogsTable.action, req.query.action));
  }

  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = await query.orderBy(auditLogsTable.createdAt).limit(limit);
  res.json(logs);
});

export default router;
