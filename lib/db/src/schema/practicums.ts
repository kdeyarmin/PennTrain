import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { facilitiesTable } from "./facilities";
import { employeesTable } from "./employees";

export const practicumsTable = pgTable("practicums", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  practicumYear: integer("practicum_year").notNull(),
  completionDate: text("completion_date"),
  observedBy: text("observed_by"),
  marReviewCompleted: boolean("mar_review_completed").notNull().default(false),
  directObservationCompleted: boolean("direct_observation_completed").notNull().default(false),
  remediationRequired: boolean("remediation_required").notNull().default(false),
  remediationNotes: text("remediation_notes"),
  notes: text("notes"),
  dueDate: text("due_date"),
  status: text("status", { enum: ["compliant", "due_soon", "expired", "missing"] }).notNull().default("missing"),
  verifiedByUserId: integer("verified_by_user_id"),
  verifiedAt: text("verified_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPracticumSchema = createInsertSchema(practicumsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPracticum = z.infer<typeof insertPracticumSchema>;
export type Practicum = typeof practicumsTable.$inferSelect;
