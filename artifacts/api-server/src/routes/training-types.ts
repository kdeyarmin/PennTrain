import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trainingTypesTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/training-types", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  let query = db.select().from(trainingTypesTable).$dynamic();

  if (user.role !== "platform_admin") {
    query = query.where(
      or(
        eq(trainingTypesTable.isSystemDefault, true),
        user.organizationId ? eq(trainingTypesTable.organizationId, user.organizationId) : eq(trainingTypesTable.isSystemDefault, true),
      )
    );
  }

  if (req.query.isActive !== undefined) query = query.where(eq(trainingTypesTable.isActive, req.query.isActive === "true"));
  if (req.query.appliesToFacilityType && typeof req.query.appliesToFacilityType === "string") {
    query = query.where(eq(trainingTypesTable.appliesToFacilityType, req.query.appliesToFacilityType as "PCH" | "ALR" | "BOTH"));
  }

  const types = await query.orderBy(trainingTypesTable.sortOrder, trainingTypesTable.name);
  res.json(types);
});

router.post("/training-types", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { code, name, category, description, appliesToFacilityType, renewalIntervalDays, warningDaysDefault, documentRequired, sortOrder } = req.body;
  if (!code || !name || !category) { res.status(400).json({ error: "Code, name, and category required" }); return; }

  const [type] = await db.insert(trainingTypesTable).values({
    organizationId: user.role !== "platform_admin" ? user.organizationId ?? undefined : undefined,
    code, name, category, description,
    appliesToFacilityType: appliesToFacilityType || "BOTH",
    renewalIntervalDays,
    warningDaysDefault: warningDaysDefault ?? 90,
    documentRequired: documentRequired ?? false,
    isSystemDefault: user.role === "platform_admin",
    sortOrder: sortOrder ?? 0,
  }).returning();

  await logAudit(req, "training_type", type.id, "create", null, type, user.organizationId ?? undefined);
  res.status(201).json(type);
});

router.get("/training-types/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [type] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, id));
  if (!type) { res.status(404).json({ error: "Training type not found" }); return; }

  if (user.role !== "platform_admin" && !type.isSystemDefault && type.organizationId !== user.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(type);
});

router.patch("/training-types/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training type not found" }); return; }

  // Only platform_admin can edit system defaults; org_admin can only edit their own org's types
  if (user.role !== "platform_admin") {
    if (existing.isSystemDefault) { res.status(403).json({ error: "Cannot modify system training types" }); return; }
    if (existing.organizationId !== user.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const updates: Partial<typeof trainingTypesTable.$inferInsert> = {};
  const allowed = ["name", "description", "appliesToFacilityType", "renewalIntervalDays", "warningDaysDefault", "documentRequired", "isActive", "sortOrder"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) (updates as Record<string, unknown>)[field] = req.body[field];
  }

  const [updated] = await db.update(trainingTypesTable).set(updates).where(eq(trainingTypesTable.id, id)).returning();
  await logAudit(req, "training_type", id, "update", existing, updated, existing.organizationId ?? undefined);
  res.json(updated);
});

router.delete("/training-types/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || user.role !== "platform_admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Training type not found" }); return; }

  await db.delete(trainingTypesTable).where(eq(trainingTypesTable.id, id));
  await logAudit(req, "training_type", id, "delete", existing, null);
  res.sendStatus(204);
});

export default router;
