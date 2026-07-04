import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  getCurrentUser,
  hashPassword,
  verifyPassword,
  sanitizeUser,
} from "../lib/auth";
import { logAudit } from "../lib/audit";
import { validateBody, validateQuery } from "../lib/validate";

const router: IRouter = Router();

const USER_ROLES = [
  "platform_admin",
  "org_admin",
  "facility_manager",
  "trainer",
  "employee",
] as const;
const ORG_ADMIN_ALLOWED_ROLES = [
  "org_admin",
  "facility_manager",
  "trainer",
  "employee",
] as const;
type UserRole = (typeof USER_ROLES)[number];

const createUserSchema = z.object({
  email: z
    .string()
    .email()
    .transform((email) => email.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  role: z.enum(USER_ROLES),
  phone: z.string().trim().min(1).nullable().optional(),
  organizationId: z.coerce.number().int().positive().nullable().optional(),
});

const listUsersQuerySchema = z.object({
  organizationId: z.coerce.number().int().positive().optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

const idParamSchema = z.coerce.number().int().positive();

function parseIdParam(value: unknown, res: Response): number | null {
  const result = idParamSchema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: "Invalid user id" });
    return null;
  }
  return result.data;
}

const updateUserSchema = z
  .object({
    email: z.never().optional(),
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    organizationId: z.coerce.number().int().positive().nullable().optional(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .optional(),
  })
  .strict();

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).optional(),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters"),
  })
  .strict();

router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (
    !user ||
    !["platform_admin", "org_admin", "facility_manager"].includes(user.role)
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const query = validateQuery(listUsersQuerySchema, req, res);
  if (!query) return;

  const conditions: SQL[] = [];

  if (user.role !== "platform_admin") {
    if (!user.organizationId) {
      res.json([]);
      return;
    }
    conditions.push(eq(usersTable.organizationId, user.organizationId));
  } else if (query.organizationId) {
    conditions.push(eq(usersTable.organizationId, query.organizationId));
  }

  if (query.role) {
    conditions.push(eq(usersTable.role, query.role));
  }
  if (query.isActive !== undefined) {
    conditions.push(eq(usersTable.isActive, query.isActive === "true"));
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(usersTable.lastName, usersTable.firstName);

  res.json(users.map(sanitizeUser));
});

router.post("/users", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = validateBody(createUserSchema, req, res);
  if (!body) return;
  const { email, password, firstName, lastName, role, phone } = body;

  // Prevent privilege escalation: org_admins cannot create platform_admin users
  // or users in other organizations
  if (user.role !== "platform_admin") {
    if (
      !ORG_ADMIN_ALLOWED_ROLES.includes(
        role as (typeof ORG_ADMIN_ALLOWED_ROLES)[number],
      )
    ) {
      res.status(403).json({
        error: "Insufficient permissions to create a user with that role",
      });
      return;
    }
    if (!user.organizationId) {
      res.status(403).json({ error: "User has no organization" });
      return;
    }
  }

  // Determine organizationId
  let resolvedOrgId: number | null = null;
  if (user.role === "platform_admin") {
    resolvedOrgId = body.organizationId ?? null;
  } else {
    resolvedOrgId = user.organizationId!;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [newUser] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      firstName,
      lastName,
      role: role as UserRole,
      organizationId: resolvedOrgId,
      phone: phone ?? null,
    })
    .returning();

  await logAudit(
    req,
    "user",
    newUser.id,
    "create",
    null,
    sanitizeUser(newUser),
    resolvedOrgId ?? undefined,
  );
  res.status(201).json(sanitizeUser(newUser));
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseIdParam(req.params.id, res);
  if (id === null) return;
  const [targetUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const isSelf = currentUser.id === id;
  const isPlatformAdmin = currentUser.role === "platform_admin";
  const isOrgOrFacilityAdmin = ["org_admin", "facility_manager"].includes(
    currentUser.role,
  );
  const sameOrg = currentUser.organizationId === targetUser.organizationId;

  // Self-access always allowed; platform_admin can see any user;
  // org_admin/facility_manager can see users in their org;
  // trainers and employees can ONLY see themselves
  if (!isSelf && !isPlatformAdmin && !(isOrgOrFacilityAdmin && sameOrg)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(sanitizeUser(targetUser));
});

router.patch("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const currentUser = await getCurrentUser(req);
  if (!currentUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseIdParam(req.params.id, res);
  if (id === null) return;
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const isSelf = currentUser.id === id;
  const isPlatformAdmin = currentUser.role === "platform_admin";
  const isOrgAdmin = currentUser.role === "org_admin";
  const sameOrg = currentUser.organizationId === existing.organizationId;

  if (!isSelf && !isPlatformAdmin && !(isOrgAdmin && sameOrg)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = validateBody(updateUserSchema, req, res);
  if (!body) return;

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
    if (body[field as keyof typeof body] !== undefined) {
      (updates as Record<string, unknown>)[field] =
        body[field as keyof typeof body];
    }
  }

  // Handle password separately (anyone can change their own)
  if (body.password !== undefined && (isSelf || isPlatformAdmin)) {
    updates.passwordHash = await hashPassword(body.password);
  }

  // Prevent org_admin from escalating role to platform_admin
  if (updates.role !== undefined && !isPlatformAdmin) {
    if (
      !ORG_ADMIN_ALLOWED_ROLES.includes(
        updates.role as (typeof ORG_ADMIN_ALLOWED_ROLES)[number],
      )
    ) {
      res
        .status(403)
        .json({ error: "Insufficient permissions to assign that role" });
      return;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();
  await logAudit(
    req,
    "user",
    id,
    "update",
    sanitizeUser(existing),
    sanitizeUser(updated),
    existing.organizationId ?? undefined,
  );
  res.json(sanitizeUser(updated));
});

router.post(
  "/users/:id/change-password",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [targetUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Users can change their own password; platform_admin can change any; org_admin can change users in their org
    const isSelf = user.id === id;
    const isOrgAdmin =
      user.role === "org_admin" &&
      user.organizationId === targetUser.organizationId;
    const isPlatformAdmin = user.role === "platform_admin";

    if (!isSelf && !isOrgAdmin && !isPlatformAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const body = validateBody(changePasswordSchema, req, res);
    if (!body) return;

    // Non-admins must provide current password. Admin resets only require the new password.
    if (!isPlatformAdmin && !isOrgAdmin) {
      if (!body.currentPassword) {
        res.status(400).json({ error: "currentPassword is required" });
        return;
      }
      const valid = await verifyPassword(
        body.currentPassword,
        targetUser.passwordHash,
      );
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
    }

    const hashed = await hashPassword(body.newPassword);
    await db
      .update(usersTable)
      .set({ passwordHash: hashed })
      .where(eq(usersTable.id, id));

    await logAudit(
      req,
      "user",
      id,
      "change_password",
      null,
      null,
      targetUser.organizationId ?? undefined,
    );
    res.json({ message: "Password changed successfully" });
  },
);

router.delete("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const id = parseIdParam(req.params.id, res);
  if (id === null) return;
  if (user.id === id) {
    res.status(400).json({ error: "Cannot deactivate your own account" });
    return;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (
    user.role !== "platform_admin" &&
    user.organizationId !== existing.organizationId
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Prevent org_admin from deactivating platform_admin
  if (user.role !== "platform_admin" && existing.role === "platform_admin") {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  await db
    .update(usersTable)
    .set({ isActive: false })
    .where(eq(usersTable.id, id));
  await logAudit(
    req,
    "user",
    id,
    "deactivate",
    sanitizeUser(existing),
    null,
    existing.organizationId ?? undefined,
  );
  res.sendStatus(204);
});

export default router;
