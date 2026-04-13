import { pgTable, serial, boolean, integer, text, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const organizationSettingsTable = pgTable("organization_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().unique().references(() => organizationsTable.id),
  defaultWarningDays: json("default_warning_days"),
  emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(false),
  smsNotificationsEnabled: boolean("sms_notifications_enabled").notNull().default(false),
  brandingPrimaryColor: text("branding_primary_color"),
  brandingLogoUrl: text("branding_logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrganizationSettingsSchema = createInsertSchema(organizationSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationSettings = z.infer<typeof insertOrganizationSettingsSchema>;
export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;
