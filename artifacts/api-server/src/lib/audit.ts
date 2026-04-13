import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import type { Request } from "express";

export async function logAudit(
  req: Request,
  entityType: string,
  entityId: string | number,
  action: string,
  oldValues?: unknown,
  newValues?: unknown,
  organizationId?: number,
) {
  const userId = req.session?.userId;
  await db.insert(auditLogsTable).values({
    organizationId: organizationId ?? null,
    userId: userId ?? null,
    entityType,
    entityId: String(entityId),
    action,
    oldValues: oldValues ?? null,
    newValues: newValues ?? null,
    ipAddress: req.ip ?? null,
  });
}
