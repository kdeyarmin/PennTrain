import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { facilitiesTable } from "./facilities";
import { employeesTable } from "./employees";

export const trainingHourBucketsTable = pgTable("employee_training_hour_buckets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  trainingYear: integer("training_year").notNull(),
  requiredHours: numeric("required_hours").notNull().default("12"),
  completedHours: numeric("completed_hours").notNull().default("0"),
  status: text("status", { enum: ["compliant", "due_soon", "incomplete", "expired"] }).notNull().default("incomplete"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTrainingHourBucketSchema = createInsertSchema(trainingHourBucketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrainingHourBucket = z.infer<typeof insertTrainingHourBucketSchema>;
export type TrainingHourBucket = typeof trainingHourBucketsTable.$inferSelect;
