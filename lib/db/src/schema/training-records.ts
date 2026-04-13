import { pgTable, serial, text, boolean, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { facilitiesTable } from "./facilities";
import { employeesTable } from "./employees";
import { trainingTypesTable } from "./training-types";

export const trainingRecordsTable = pgTable("employee_training_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  trainingTypeId: integer("training_type_id").notNull().references(() => trainingTypesTable.id),
  completionDate: text("completion_date"),
  dueDate: text("due_date"),
  status: text("status", {
    enum: ["compliant", "due_soon", "expired", "missing", "not_applicable", "pending_review"],
  }).notNull().default("missing"),
  trainerName: text("trainer_name"),
  trainerCredentials: text("trainer_credentials"),
  trainingProvider: text("training_provider"),
  certificateNumber: text("certificate_number"),
  score: numeric("score"),
  hours: numeric("hours"),
  notes: text("notes"),
  documentRequired: boolean("document_required").notNull().default(false),
  completionMethod: text("completion_method", { enum: ["in_person", "online", "hybrid", "manual_entry"] }),
  verifiedByUserId: integer("verified_by_user_id"),
  verifiedAt: text("verified_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTrainingRecordSchema = createInsertSchema(trainingRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrainingRecord = z.infer<typeof insertTrainingRecordSchema>;
export type TrainingRecord = typeof trainingRecordsTable.$inferSelect;
