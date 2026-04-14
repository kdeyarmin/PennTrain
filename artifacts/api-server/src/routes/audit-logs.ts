import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, employeesTable } from "@workspace/db";
import { eq, and, SQL, desc } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";

const router: IRouter = Router();

router.get("/audit-logs", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  if (user.role === "facility_manager") {
    if (req.query.entityType !== "employee" || !req.query.entityId) {
      res.status(403).json({ error: "Forbidden: facility managers may only view employee-scoped audit logs" }); return;
    }
    const empId = Number(req.query.entityId);
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, empId));
    if (!emp || emp.organizationId !== user.organizationId) {
      res.json([]); return;
    }
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && emp.facilityId !== null && !assignedFacilityIds.includes(emp.facilityId)) {
      res.json([]); return;
    }
  }

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
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);

  const logs = await query;
  res.json(logs);
});

export default router;
