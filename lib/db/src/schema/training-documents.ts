import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { facilitiesTable } from "./facilities";

export const trainingDocumentsTable = pgTable("training_documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  employeeId: integer("employee_id"),
  trainingRecordId: integer("training_record_id"),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  uploadedByUserId: integer("uploaded_by_user_id"),
  documentType: text("document_type", {
    enum: ["certificate", "roster", "practicum_form", "transcript", "other"],
  }).notNull().default("other"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTrainingDocumentSchema = createInsertSchema(trainingDocumentsTable).omit({ id: true, createdAt: true });
export type InsertTrainingDocument = z.infer<typeof insertTrainingDocumentSchema>;
export type TrainingDocument = typeof trainingDocumentsTable.$inferSelect;
