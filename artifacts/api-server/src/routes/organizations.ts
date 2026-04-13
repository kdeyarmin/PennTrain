import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { organizationsTable, facilitiesTable, employeesTable, trainingRecordsTable, alertsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, SQL } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/organizations", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { status, search } = req.query;
  const conditions: SQL[] = [];

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    conditions.push(eq(organizationsTable.id, user.organizationId));
  } else {
    if (status && typeof status === "string") {
      conditions.push(eq(organizationsTable.subscriptionStatus, status as "trial" | "active" | "past_due" | "canceled"));
    }
    if (search && typeof search === "string") {
      conditions.push(ilike(organizationsTable.name, `%${search}%`));
    }
  }

  const orgs = await db.select().from(organizationsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(organizationsTable.name);
  res.json(orgs);
});

router.post("/organizations", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || user.role !== "platform_admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { name, slug, contactName, contactEmail, contactPhone, address, city, state, zip, subscriptionStatus, planName, maxFacilities, maxUsers } = req.body;
  if (!name || !slug) { res.status(400).json({ error: "Name and slug required" }); return; }

  const [org] = await db.insert(organizationsTable).values({
    name, slug, contactName, contactEmail, contactPhone, address, city, state, zip,
    subscriptionStatus: subscriptionStatus || "trial", planName, maxFacilities, maxUsers,
  }).returning();

  await logAudit(req, "organization", org.id, "create", null, org);
  res.status(201).json(org);
});

router.get("/organizations/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (user.role !== "platform_admin" && user.organizationId !== id) { res.status(403).json({ error: "Forbidden" }); return; }

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
  res.json(org);
});

router.patch("/organizations/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (user.role !== "platform_admin" && (user.role !== "org_admin" || user.organizationId !== id)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [existing] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Organization not found" }); return; }

  const updates: Partial<typeof organizationsTable.$inferInsert> = {};
  const allowedFields = ["name", "contactName", "contactEmail", "contactPhone", "address", "city", "state", "zip", "planName", "maxFacilities", "maxUsers"];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) (updates as Record<string, unknown>)[field] = req.body[field];
  }
  if (user.role === "platform_admin" && req.body.subscriptionStatus) {
    updates.subscriptionStatus = req.body.subscriptionStatus;
  }

  const [updated] = await db.update(organizationsTable).set(updates).where(eq(organizationsTable.id, id)).returning();
  await logAudit(req, "organization", id, "update", existing, updated, id);
  res.json(updated);
});

router.delete("/organizations/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || user.role !== "platform_admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Organization not found" }); return; }

  await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  await logAudit(req, "organization", id, "delete", existing, null);
  res.sendStatus(204);
});

router.get("/organizations/:id/stats", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (user.role !== "platform_admin" && user.organizationId !== id) { res.status(403).json({ error: "Forbidden" }); return; }

  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.organizationId, id));
  const employees = await db.select().from(employeesTable).where(and(eq(employeesTable.organizationId, id), eq(employeesTable.status, "active")));
  const medAdminStaff = employees.filter(e => e.administersMedications).length;

  const trainingRecords = await db.select().from(trainingRecordsTable).where(eq(trainingRecordsTable.organizationId, id));
  const compliantCount = trainingRecords.filter(r => r.status === "compliant").length;
  const dueSoonCount = trainingRecords.filter(r => r.status === "due_soon").length;
  const expiredCount = trainingRecords.filter(r => r.status === "expired").length;
  const missingDocumentCount = trainingRecords.filter(r => r.documentRequired && r.status !== "not_applicable").length;
  const total = trainingRecords.length;
  const compliancePercentage = total > 0 ? Math.round((compliantCount / total) * 100) : 100;

  const openAlerts = await db.select({ count: count() }).from(alertsTable)
    .where(and(eq(alertsTable.organizationId, id), eq(alertsTable.status, "open")));

  res.json({
    organizationId: id,
    totalFacilities: facilities.length,
    totalEmployees: employees.length,
    totalMedAdminStaff: medAdminStaff,
    compliantCount,
    dueSoonCount,
    expiredCount,
    missingDocumentCount,
    compliancePercentage,
    openAlertsCount: openAlerts[0]?.count ?? 0,
  });
});

export default router;
