import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
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
  }
}

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

export async function getCurrentUser(req: Request): Promise<typeof usersTable.$inferSelect | null> {
  if (!req.session.userId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  return user ?? null;
}

export function sanitizeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...safe } = user;
  return safe;
}
