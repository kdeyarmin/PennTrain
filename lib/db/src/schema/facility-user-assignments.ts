import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { facilitiesTable } from "./facilities";

export const facilityUserAssignmentsTable = pgTable("facility_user_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFacilityUserAssignmentSchema = createInsertSchema(facilityUserAssignmentsTable).omit({ id: true, createdAt: true });
export type InsertFacilityUserAssignment = z.infer<typeof insertFacilityUserAssignmentSchema>;
export type FacilityUserAssignment = typeof facilityUserAssignmentsTable.$inferSelect;
