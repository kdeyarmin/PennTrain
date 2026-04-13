import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, sanitizeUser, requireAuth, getCurrentUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { z } from "zod";
import { validateBody } from "../lib/validate";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const impersonateOrgSchema = z.object({
  organizationId: z.coerce.number().int().positive(),
});

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const body = validateBody(loginSchema, req, res);
  if (!body) return;
  const { email, password } = body;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  req.session.userId = user.id;
  await logAudit(req, "user", user.id, "login", null, null, user.organizationId ?? undefined);

  res.json({ user: sanitizeUser(user), message: "Login successful" });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy(() => {});
  res.json({ message: "Logged out" });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const effectiveUser = await getCurrentUser(req);
  if (!effectiveUser) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found" });
    return;
  }
  const { passwordHash: _, ...safe } = effectiveUser;
  res.json(safe);
});

router.post("/auth/impersonate-org", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role !== "platform_admin") { res.status(403).json({ error: "Only platform admins can impersonate organizations" }); return; }

  const impBody = validateBody(impersonateOrgSchema, req, res);
  if (!impBody) return;
  const { organizationId } = impBody;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId));
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

  req.session.impersonatingOrgId = organizationId;
  await logAudit(req, "organization", org.id, "impersonate_start", null, null, org.id);
  res.json({ message: `Now viewing as organization: ${org.name}`, organization: org });
});

router.post("/auth/stop-impersonation", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const realRole = (user as { _realRole?: string })._realRole ?? user.role;
  if (realRole !== "platform_admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const prevOrgId = req.session.impersonatingOrgId;
  delete req.session.impersonatingOrgId;
  if (prevOrgId) await logAudit(req, "organization", prevOrgId, "impersonate_stop", null, null, prevOrgId);
  res.json({ message: "Stopped impersonation" });
});

router.get("/auth/impersonation-status", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = req.session.impersonatingOrgId ?? null;
  if (orgId) {
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
    res.json({ impersonating: true, organizationId: orgId, organizationName: org?.name ?? null });
    return;
  }
  res.json({ impersonating: false, organizationId: null, organizationName: null });
});

export default router;
