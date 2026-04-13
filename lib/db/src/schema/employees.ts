import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { facilitiesTable } from "./facilities";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  employeeNumber: text("employee_number"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  hireDate: text("hire_date"),
  terminationDate: text("termination_date"),
  jobTitle: text("job_title").notNull(),
  department: text("department"),
  status: text("status", { enum: ["active", "inactive", "terminated", "on_leave"] }).notNull().default("active"),
  administersMedications: boolean("administers_medications").notNull().default(false),
  trainerStatus: boolean("trainer_status").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
