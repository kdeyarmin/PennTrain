import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  role: text("role", { enum: ["platform_admin", "org_admin", "facility_manager", "trainer", "employee"] }).notNull().default("employee"),
  isActive: boolean("is_active").notNull().default(true),
  organizationId: integer("organization_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
