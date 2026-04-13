import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getCurrentUser, hashPassword, sanitizeUser } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  let query = db.select().from(usersTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(usersTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(usersTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.role && typeof req.query.role === "string") {
    query = query.where(eq(usersTable.role, req.query.role as "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee"));
  }
  if (req.query.isActive !== undefined) {
    query = query.where(eq(usersTable.isActive, req.query.isActive === "true"));
  }

  const users = await query.orderBy(usersTable.lastName, usersTable.firstName);
  res.json(users.map(sanitizeUser));
});

router.post("/users", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { email, password, firstName, lastName, role, organizationId, facilityId, phone } = req.body;
  if (!email || !password || !firstName || !lastName || !role) { res.status(400).json({ error: "Required fields missing" }); return; }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing) { res.status(409).json({ error: "Email already exists" }); return; }

  const passwordHash = await hashPassword(password);
  const [newUser] = await db.insert(usersTable).values({
    email: email.toLowerCase(), passwordHash, firstName, lastName, role,
    organizationId: organizationId ?? user.organizationId ?? undefined,
    phone,
  }).returning();

  await logAudit(req, "user", newUser.id, "create", null, sanitizeUser(newUser), organizationId ?? user.organizationId ?? undefined);
  res.status(201).json(sanitizeUser(newUser));
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

  if (currentUser.role !== "platform_admin" && currentUser.id !== id && currentUser.organizationId !== targetUser.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(sanitizeUser(targetUser));
});

router.patch("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  const isSelf = currentUser.id === id;
  const isAdmin = ["platform_admin", "org_admin"].includes(currentUser.role);
  if (!isSelf && !isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!isSelf && currentUser.role !== "platform_admin" && currentUser.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  const selfAllowed = ["firstName", "lastName", "phone", "password"];
  const adminAllowed = [...selfAllowed, "role", "isActive", "organizationId"];
  const allowed = isAdmin ? adminAllowed : selfAllowed;

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      if (field === "password") {
        updates.passwordHash = await hashPassword(req.body[field]);
      } else {
        (updates as Record<string, unknown>)[field] = req.body[field];
      }
    }
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  await logAudit(req, "user", id, "update", sanitizeUser(existing), sanitizeUser(updated), existing.organizationId ?? undefined);
  res.json(sanitizeUser(updated));
});

router.delete("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (user.id === id) { res.status(400).json({ error: "Cannot delete your own account" }); return; }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, id));
  await logAudit(req, "user", id, "deactivate", sanitizeUser(existing), null, existing.organizationId ?? undefined);
  res.sendStatus(204);
});

export default router;
