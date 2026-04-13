import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, sanitizeUser, requireAuth, getCurrentUser } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

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
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(sanitizeUser(user));
});

router.post("/auth/impersonate-org", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role !== "platform_admin") { res.status(403).json({ error: "Only platform admins can impersonate organizations" }); return; }

  const { organizationId } = req.body;
  if (!organizationId) { res.status(400).json({ error: "organizationId required" }); return; }

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, Number(organizationId)));
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

  req.session.impersonatingOrgId = Number(organizationId);
  await logAudit(req, "organization", org.id, "impersonate_start", null, null, org.id);
  res.json({ message: `Now viewing as organization: ${org.name}`, organization: org });
});

router.post("/auth/stop-impersonation", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.role !== "platform_admin") { res.status(403).json({ error: "Forbidden" }); return; }

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
