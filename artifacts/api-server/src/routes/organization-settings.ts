import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { organizationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/organizations/:id/settings", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (user.role !== "platform_admin" && user.organizationId !== id) { res.status(403).json({ error: "Forbidden" }); return; }

  const [settings] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.organizationId, id));
  if (!settings) {
    res.json({
      organizationId: id,
      defaultWarningDays: null,
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: false,
      brandingPrimaryColor: null,
      brandingLogoUrl: null,
    });
    return;
  }
  res.json(settings);
});

router.put("/organizations/:id/settings", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (user.role !== "platform_admin" && (user.role !== "org_admin" || user.organizationId !== id)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { defaultWarningDays, emailNotificationsEnabled, smsNotificationsEnabled, brandingPrimaryColor, brandingLogoUrl } = req.body;

  const [existing] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.organizationId, id));

  if (existing) {
    const updates: Partial<typeof organizationSettingsTable.$inferInsert> = {};
    if (defaultWarningDays !== undefined) updates.defaultWarningDays = defaultWarningDays;
    if (emailNotificationsEnabled !== undefined) updates.emailNotificationsEnabled = emailNotificationsEnabled;
    if (smsNotificationsEnabled !== undefined) updates.smsNotificationsEnabled = smsNotificationsEnabled;
    if (brandingPrimaryColor !== undefined) updates.brandingPrimaryColor = brandingPrimaryColor;
    if (brandingLogoUrl !== undefined) updates.brandingLogoUrl = brandingLogoUrl;

    const [updated] = await db.update(organizationSettingsTable).set(updates).where(eq(organizationSettingsTable.organizationId, id)).returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(organizationSettingsTable).values({
      organizationId: id,
      defaultWarningDays: defaultWarningDays ?? null,
      emailNotificationsEnabled: emailNotificationsEnabled ?? false,
      smsNotificationsEnabled: smsNotificationsEnabled ?? false,
      brandingPrimaryColor: brandingPrimaryColor ?? null,
      brandingLogoUrl: brandingLogoUrl ?? null,
    }).returning();
    res.status(201).json(created);
  }
});

export default router;
