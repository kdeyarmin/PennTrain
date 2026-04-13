import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, getCurrentUser, hashPassword, verifyPassword, sanitizeUser } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

const ORG_ADMIN_ALLOWED_ROLES = ["org_admin", "facility_manager", "trainer", "employee"] as const;
type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee";

router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  let query = db.select().from(usersTable).$dynamic();

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    query = query.where(eq(usersTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    query = query.where(eq(usersTable.organizationId, Number(req.query.organizationId)));
  }

  if (req.query.role && typeof req.query.role === "string") {
    query = query.where(eq(usersTable.role, req.query.role as UserRole));
  }
  if (req.query.isActive !== undefined) {
    query = query.where(eq(usersTable.isActive, req.query.isActive === "true"));
  }

  const users = await query.orderBy(usersTable.lastName, usersTable.firstName);
  res.json(users.map(sanitizeUser));
});

router.post("/users", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { email, password, firstName, lastName, role, phone } = req.body;
  if (!email || !password || !firstName || !lastName || !role) {
    res.status(400).json({ error: "Required fields: email, password, firstName, lastName, role" }); return;
  }

  // Prevent privilege escalation: org_admins cannot create platform_admin users
  // or users in other organizations
  if (user.role !== "platform_admin") {
    if (!ORG_ADMIN_ALLOWED_ROLES.includes(role as typeof ORG_ADMIN_ALLOWED_ROLES[number])) {
      res.status(403).json({ error: "Insufficient permissions to create a user with that role" }); return;
    }
    if (!user.organizationId) {
      res.status(403).json({ error: "User has no organization" }); return;
    }
  }

  // Determine organizationId
  let resolvedOrgId: number | null = null;
  if (user.role === "platform_admin") {
    resolvedOrgId = req.body.organizationId ? Number(req.body.organizationId) : null;
  } else {
    resolvedOrgId = user.organizationId!;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing) { res.status(409).json({ error: "Email already exists" }); return; }

  const passwordHash = await hashPassword(password);
  const [newUser] = await db.insert(usersTable).values({
    email: email.toLowerCase(), passwordHash, firstName, lastName,
    role: role as UserRole,
    organizationId: resolvedOrgId,
    phone: phone ?? null,
  }).returning();

  await logAudit(req, "user", newUser.id, "create", null, sanitizeUser(newUser), resolvedOrgId ?? undefined);
  res.status(201).json(sanitizeUser(newUser));
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

  if (
    currentUser.role !== "platform_admin" &&
    currentUser.id !== id &&
    currentUser.organizationId !== targetUser.organizationId
  ) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(sanitizeUser(targetUser));
});

router.patch("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  const isSelf = currentUser.id === id;
  const isPlatformAdmin = currentUser.role === "platform_admin";
  const isOrgAdmin = currentUser.role === "org_admin";
  const sameOrg = currentUser.organizationId === existing.organizationId;

  if (!isSelf && !isPlatformAdmin && !(isOrgAdmin && sameOrg)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  const selfAllowed = ["firstName", "lastName", "phone"];
  const orgAdminAllowed = [...selfAllowed, "role", "isActive"];
  const platformAdminAllowed = [...orgAdminAllowed, "organizationId"];

  let allowed: string[];
  if (isPlatformAdmin) {
    allowed = platformAdminAllowed;
  } else if (isOrgAdmin && sameOrg && !isSelf) {
    allowed = orgAdminAllowed;
  } else {
    allowed = selfAllowed;
  }

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      (updates as Record<string, unknown>)[field] = req.body[field];
    }
  }

  // Handle password separately (anyone can change their own)
  if (req.body.password !== undefined && (isSelf || isPlatformAdmin)) {
    updates.passwordHash = await hashPassword(req.body.password);
  }

  // Prevent org_admin from escalating role to platform_admin
  if (updates.role !== undefined && !isPlatformAdmin) {
    if (!ORG_ADMIN_ALLOWED_ROLES.includes(updates.role as typeof ORG_ADMIN_ALLOWED_ROLES[number])) {
      res.status(403).json({ error: "Insufficient permissions to assign that role" }); return;
    }
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  await logAudit(req, "user", id, "update", sanitizeUser(existing), sanitizeUser(updated), existing.organizationId ?? undefined);
  res.json(sanitizeUser(updated));
});

router.post("/users/:id/change-password", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

  // Users can change their own password; platform_admin can change any; org_admin can change users in their org
  const isSelf = user.id === id;
  const isOrgAdmin = user.role === "org_admin" && user.organizationId === targetUser.organizationId;
  const isPlatformAdmin = user.role === "platform_admin";

  if (!isSelf && !isOrgAdmin && !isPlatformAdmin) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // Non-admins must provide current password
  if (!isPlatformAdmin && !isOrgAdmin) {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword required" }); return;
    }
    const valid = await verifyPassword(currentPassword, targetUser.passwordHash);
    if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: "New password must be at least 8 characters" }); return; }
    const hashed = await hashPassword(newPassword);
    await db.update(usersTable).set({ passwordHash: hashed }).where(eq(usersTable.id, id));
  } else {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: "newPassword must be at least 8 characters" }); return;
    }
    const hashed = await hashPassword(newPassword);
    await db.update(usersTable).set({ passwordHash: hashed }).where(eq(usersTable.id, id));
  }

  await logAudit(req, "user", id, "change_password", null, null, targetUser.organizationId ?? undefined);
  res.json({ message: "Password changed successfully" });
});

router.delete("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  if (user.id === id) { res.status(400).json({ error: "Cannot deactivate your own account" }); return; }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // Prevent org_admin from deactivating platform_admin
  if (user.role !== "platform_admin" && existing.role === "platform_admin") {
    res.status(403).json({ error: "Insufficient permissions" }); return;
  }

  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, id));
  await logAudit(req, "user", id, "deactivate", sanitizeUser(existing), null, existing.organizationId ?? undefined);
  res.sendStatus(204);
});

export default router;
