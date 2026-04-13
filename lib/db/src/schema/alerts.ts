import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  facilityId: integer("facility_id"),
  employeeId: integer("employee_id"),
  trainingRecordId: integer("training_record_id"),
  practicumId: integer("practicum_id"),
  alertType: text("alert_type", {
    enum: ["due_90", "due_60", "due_30", "due_14", "due_7", "overdue", "missing_document"],
  }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("info"),
  status: text("status", { enum: ["open", "dismissed", "resolved"] }).notNull().default("open"),
  assignedToUserId: integer("assigned_to_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: text("resolved_at"),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
