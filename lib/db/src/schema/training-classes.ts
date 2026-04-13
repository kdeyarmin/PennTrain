import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { facilitiesTable } from "./facilities";
import { trainingTypesTable } from "./training-types";
import { usersTable } from "./users";
import { employeesTable } from "./employees";
import { trainingRecordsTable } from "./training-records";

export const trainingClassesTable = pgTable("training_classes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  facilityId: integer("facility_id").references(() => facilitiesTable.id),
  trainerUserId: integer("trainer_user_id").notNull().references(() => usersTable.id),
  trainingTypeId: integer("training_type_id").notNull().references(() => trainingTypesTable.id),
  className: text("class_name").notNull(),
  classDate: text("class_date").notNull(),
  location: text("location"),
  durationHours: numeric("duration_hours").notNull().default("1"),
  status: text("status", { enum: ["draft", "completed", "cancelled"] }).notNull().default("draft"),
  notes: text("notes"),
  rosterDocumentId: integer("roster_document_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const trainingClassAttendeesTable = pgTable("training_class_attendees", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => trainingClassesTable.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  attended: boolean("attended").notNull().default(true),
  trainingRecordId: integer("training_record_id").references(() => trainingRecordsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTrainingClassSchema = createInsertSchema(trainingClassesTable, {
  className: z.string().min(1),
  classDate: z.string().min(1),
  durationHours: z.string().or(z.number()).optional(),
  status: z.enum(["draft", "completed", "cancelled"]).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertTrainingClassAttendeeSchema = createInsertSchema(trainingClassAttendeesTable, {
  attended: z.boolean().optional(),
}).omit({ id: true, createdAt: true });
