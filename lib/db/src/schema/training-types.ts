import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const trainingTypesTable = pgTable("training_types", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  appliesToFacilityType: text("applies_to_facility_type", { enum: ["PCH", "ALR", "BOTH"] }).notNull().default("BOTH"),
  appliesToAdministersMeds: boolean("applies_to_administers_meds"),
  appliesToTrainers: boolean("applies_to_trainers"),
  renewalIntervalDays: integer("renewal_interval_days"),
  warningDaysDefault: integer("warning_days_default").notNull().default(90),
  documentRequired: boolean("document_required").notNull().default(false),
  isSystemDefault: boolean("is_system_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTrainingTypeSchema = createInsertSchema(trainingTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrainingType = z.infer<typeof insertTrainingTypeSchema>;
export type TrainingType = typeof trainingTypesTable.$inferSelect;
