import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, facilityUserAssignmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
    impersonatingOrgId?: number;
  }
}

export type EffectiveUser = typeof usersTable.$inferSelect & {
  _realRole?: string;
  _isImpersonating?: boolean;
};

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export async function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    (req as Request & { currentUser: typeof user }).currentUser = user;
    next();
  };
}

/**
 * Returns the effective user for the current request.
 * If a platform_admin is impersonating an org, they receive an effective user
 * with role=org_admin and organizationId=impersonatingOrgId for all data filtering.
 * The real role is preserved in _realRole.
 */
export async function getCurrentUser(req: Request): Promise<EffectiveUser | null> {
  if (!req.session.userId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) return null;

  const impersonatingOrgId = req.session.impersonatingOrgId;
  if (impersonatingOrgId && user.role === "platform_admin") {
    return {
      ...user,
      role: "org_admin",
      organizationId: impersonatingOrgId,
      _realRole: "platform_admin",
      _isImpersonating: true,
    } as EffectiveUser;
  }

  return user as EffectiveUser;
}

export function sanitizeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...safe } = user;
  return safe;
}

/**
 * Returns the set of facility IDs a user is allowed to access.
 * - platform_admin: null (no restriction, all facilities)
 * - org_admin: null (no restriction within org — org filter applied elsewhere)
 * - facility_manager/trainer: restricted to their facility_user_assignments rows
 * - employee: their own facilityId (passed in)
 */
export async function getAssignedFacilityIds(user: EffectiveUser): Promise<number[] | null> {
  if (user.role === "platform_admin" || user.role === "org_admin") return null;
  const rows = await db
    .select({ facilityId: facilityUserAssignmentsTable.facilityId })
    .from(facilityUserAssignmentsTable)
    .where(eq(facilityUserAssignmentsTable.userId, user.id));
  return rows.map(r => r.facilityId);
}
