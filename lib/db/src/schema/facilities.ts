import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const facilitiesTable = pgTable("facilities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  name: text("name").notNull(),
  facilityType: text("facility_type", { enum: ["PCH", "ALR"] }).notNull(),
  licenseNumber: text("license_number"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  phone: text("phone"),
  administratorName: text("administrator_name"),
  administratorEmail: text("administrator_email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFacilitySchema = createInsertSchema(facilitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFacility = z.infer<typeof insertFacilitySchema>;
export type Facility = typeof facilitiesTable.$inferSelect;
