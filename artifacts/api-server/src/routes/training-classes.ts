import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  trainingClassesTable,
  trainingClassAttendeesTable,
  trainingRecordsTable,
  trainingTypesTable,
  employeesTable,
  facilitiesTable,
  trainingDocumentsTable,
} from "@workspace/db";
import { eq, and, inArray, SQL, sql, desc } from "drizzle-orm";
import { requireAuth, getCurrentUser } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { calculateTrainingStatus, calculateDueDate } from "../lib/compliance";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".jpg", ".jpeg", ".png"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed. Accepted: PDF, JPG, PNG"));
    }
  },
});

const createClassSchema = z.object({
  trainingTypeId: z.coerce.number().int().positive(),
  className: z.string().min(1),
  classDate: z.string().min(1),
  facilityId: z.coerce.number().int().positive().optional(),
  location: z.string().optional(),
  durationHours: z.string().or(z.number()).optional(),
  notes: z.string().optional(),
});

const updateClassSchema = z.object({
  className: z.string().min(1).optional(),
  classDate: z.string().min(1).optional(),
  facilityId: z.coerce.number().int().positive().nullable().optional(),
  location: z.string().optional(),
  durationHours: z.string().or(z.number()).optional(),
  notes: z.string().optional(),
  status: z.enum(["draft", "completed", "cancelled"]).optional(),
});

const router: IRouter = Router();

async function buildClassConditions(user: { id: number; role: string; organizationId?: number | null }, classId?: number): Promise<SQL[]> {
  const conditions: SQL[] = [];
  if (classId !== undefined) {
    conditions.push(eq(trainingClassesTable.id, classId));
  }
  if (user.role !== "platform_admin") {
    if (!user.organizationId) return [sql`false`];
    conditions.push(eq(trainingClassesTable.organizationId, user.organizationId));
  }
  if (user.role === "trainer") {
    conditions.push(eq(trainingClassesTable.trainerUserId, user.id));
  }
  return conditions;
}

async function validateForeignKeys(orgId: number, facilityId?: number | null, trainingTypeId?: number, employeeIds?: number[]): Promise<string | null> {
  if (facilityId) {
    const [fac] = await db.select({ id: facilitiesTable.id }).from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, orgId)));
    if (!fac) return "Facility does not belong to your organization";
  }
  if (trainingTypeId) {
    const [tt] = await db.select({ id: trainingTypesTable.id }).from(trainingTypesTable)
      .where(and(eq(trainingTypesTable.id, trainingTypeId), eq(trainingTypesTable.organizationId, orgId)));
    if (!tt) return "Training type does not belong to your organization";
  }
  if (employeeIds && employeeIds.length > 0) {
    const emps = await db.select({ id: employeesTable.id }).from(employeesTable)
      .where(and(inArray(employeesTable.id, employeeIds), eq(employeesTable.organizationId, orgId)));
    if (emps.length !== employeeIds.length) return "One or more employees do not belong to your organization";
  }
  return null;
}

router.get("/training-classes", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conditions = await buildClassConditions(user);

  if (req.query.facilityId) {
    conditions.push(eq(trainingClassesTable.facilityId, Number(req.query.facilityId)));
  }
  if (req.query.trainingTypeId) {
    conditions.push(eq(trainingClassesTable.trainingTypeId, Number(req.query.trainingTypeId)));
  }
  if (req.query.status) {
    conditions.push(eq(trainingClassesTable.status, String(req.query.status)));
  }

  const classes = await db
    .select({
      id: trainingClassesTable.id,
      organizationId: trainingClassesTable.organizationId,
      facilityId: trainingClassesTable.facilityId,
      trainerUserId: trainingClassesTable.trainerUserId,
      trainingTypeId: trainingClassesTable.trainingTypeId,
      className: trainingClassesTable.className,
      classDate: trainingClassesTable.classDate,
      location: trainingClassesTable.location,
      durationHours: trainingClassesTable.durationHours,
      status: trainingClassesTable.status,
      notes: trainingClassesTable.notes,
      rosterDocumentId: trainingClassesTable.rosterDocumentId,
      createdAt: trainingClassesTable.createdAt,
      trainingTypeName: trainingTypesTable.name,
      facilityName: facilitiesTable.name,
      attendeeCount: sql<number>`(SELECT COUNT(*) FROM training_class_attendees WHERE class_id = ${trainingClassesTable.id})::int`,
    })
    .from(trainingClassesTable)
    .leftJoin(trainingTypesTable, eq(trainingClassesTable.trainingTypeId, trainingTypesTable.id))
    .leftJoin(facilitiesTable, eq(trainingClassesTable.facilityId, facilitiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(trainingClassesTable.classDate));

  res.json(classes);
});

router.post("/training-classes", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!["platform_admin", "org_admin", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const parsed = createClassSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return;
  }

  const orgId = user.organizationId;
  if (!orgId && user.role !== "platform_admin") {
    res.status(400).json({ error: "No organization context" }); return;
  }

  const fkError = await validateForeignKeys(orgId!, parsed.data.facilityId, parsed.data.trainingTypeId);
  if (fkError) { res.status(400).json({ error: fkError }); return; }

  const [cls] = await db.insert(trainingClassesTable).values({
    organizationId: orgId!,
    trainerUserId: user.id,
    trainingTypeId: parsed.data.trainingTypeId,
    className: parsed.data.className,
    classDate: parsed.data.classDate,
    facilityId: parsed.data.facilityId ?? null,
    location: parsed.data.location ?? null,
    durationHours: String(parsed.data.durationHours ?? "1"),
    notes: parsed.data.notes ?? null,
    status: "draft",
  }).returning();

  await logAudit(req, "training_class.created", "training_class", cls.id, null, cls);

  const [full] = await db
    .select({
      id: trainingClassesTable.id,
      organizationId: trainingClassesTable.organizationId,
      facilityId: trainingClassesTable.facilityId,
      trainerUserId: trainingClassesTable.trainerUserId,
      trainingTypeId: trainingClassesTable.trainingTypeId,
      className: trainingClassesTable.className,
      classDate: trainingClassesTable.classDate,
      location: trainingClassesTable.location,
      durationHours: trainingClassesTable.durationHours,
      status: trainingClassesTable.status,
      notes: trainingClassesTable.notes,
      rosterDocumentId: trainingClassesTable.rosterDocumentId,
      createdAt: trainingClassesTable.createdAt,
      trainingTypeName: trainingTypesTable.name,
      facilityName: facilitiesTable.name,
      attendeeCount: sql<number>`0`,
    })
    .from(trainingClassesTable)
    .leftJoin(trainingTypesTable, eq(trainingClassesTable.trainingTypeId, trainingTypesTable.id))
    .leftJoin(facilitiesTable, eq(trainingClassesTable.facilityId, facilitiesTable.id))
    .where(eq(trainingClassesTable.id, cls.id));

  res.status(201).json(full);
});

router.get("/training-classes/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const classId = Number(req.params.id);
  const conditions = await buildClassConditions(user, classId);

  const [cls] = await db
    .select({
      id: trainingClassesTable.id,
      organizationId: trainingClassesTable.organizationId,
      facilityId: trainingClassesTable.facilityId,
      trainerUserId: trainingClassesTable.trainerUserId,
      trainingTypeId: trainingClassesTable.trainingTypeId,
      className: trainingClassesTable.className,
      classDate: trainingClassesTable.classDate,
      location: trainingClassesTable.location,
      durationHours: trainingClassesTable.durationHours,
      status: trainingClassesTable.status,
      notes: trainingClassesTable.notes,
      rosterDocumentId: trainingClassesTable.rosterDocumentId,
      createdAt: trainingClassesTable.createdAt,
      trainingTypeName: trainingTypesTable.name,
      facilityName: facilitiesTable.name,
    })
    .from(trainingClassesTable)
    .leftJoin(trainingTypesTable, eq(trainingClassesTable.trainingTypeId, trainingTypesTable.id))
    .leftJoin(facilitiesTable, eq(trainingClassesTable.facilityId, facilitiesTable.id))
    .where(and(...conditions));

  if (!cls) { res.status(404).json({ error: "Not found" }); return; }

  const attendees = await db
    .select({
      id: trainingClassAttendeesTable.id,
      employeeId: trainingClassAttendeesTable.employeeId,
      attended: trainingClassAttendeesTable.attended,
      trainingRecordId: trainingClassAttendeesTable.trainingRecordId,
      employeeFirstName: employeesTable.firstName,
      employeeLastName: employeesTable.lastName,
      employeeFacilityId: employeesTable.facilityId,
    })
    .from(trainingClassAttendeesTable)
    .leftJoin(employeesTable, eq(trainingClassAttendeesTable.employeeId, employeesTable.id))
    .where(eq(trainingClassAttendeesTable.classId, classId));

  const facilityIds = [...new Set(attendees.map(a => a.employeeFacilityId).filter((id): id is number => id != null))];
  let facilityMap: Record<number, string> = {};
  if (facilityIds.length > 0) {
    const facs = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable).where(inArray(facilitiesTable.id, facilityIds));
    facilityMap = Object.fromEntries(facs.map(f => [f.id, f.name]));
  }

  res.json({
    ...cls,
    attendees: attendees.map(a => ({
      id: a.id,
      employeeId: a.employeeId,
      employeeName: `${a.employeeFirstName} ${a.employeeLastName}`,
      facilityName: a.employeeFacilityId ? facilityMap[a.employeeFacilityId] ?? null : null,
      attended: a.attended,
      trainingRecordId: a.trainingRecordId,
    })),
  });
});

router.patch("/training-classes/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!["platform_admin", "org_admin", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const parsed = updateClassSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return;
  }

  const classId = Number(req.params.id);
  const conditions = await buildClassConditions(user, classId);

  const [existing] = await db.select().from(trainingClassesTable).where(and(...conditions));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.className !== undefined) updateData.className = parsed.data.className;
  if (parsed.data.classDate !== undefined) updateData.classDate = parsed.data.classDate;
  if (parsed.data.facilityId !== undefined) updateData.facilityId = parsed.data.facilityId;
  if (parsed.data.location !== undefined) updateData.location = parsed.data.location;
  if (parsed.data.durationHours !== undefined) updateData.durationHours = String(parsed.data.durationHours);
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

  const [updated] = await db.update(trainingClassesTable)
    .set(updateData)
    .where(eq(trainingClassesTable.id, classId))
    .returning();

  await logAudit(req, "training_class.updated", "training_class", classId, existing, updated);
  res.json(updated);
});

router.delete("/training-classes/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!["platform_admin", "org_admin", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const classId = Number(req.params.id);
  const conditions = await buildClassConditions(user, classId);

  const [existing] = await db.select().from(trainingClassesTable).where(and(...conditions));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(trainingClassesTable).where(eq(trainingClassesTable.id, classId));
  await logAudit(req, "training_class.deleted", "training_class", classId, existing, null);
  res.json({ success: true });
});

router.post("/training-classes/:id/attendees", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!["platform_admin", "org_admin", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const classId = Number(req.params.id);
  const { employeeIds } = req.body as { employeeIds: number[] };

  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    res.status(400).json({ error: "employeeIds array required" }); return;
  }

  const conditions = await buildClassConditions(user, classId);

  const [cls] = await db.select().from(trainingClassesTable).where(and(...conditions));
  if (!cls) { res.status(404).json({ error: "Class not found" }); return; }

  const empFkError = await validateForeignKeys(cls.organizationId, undefined, undefined, employeeIds);
  if (empFkError) { res.status(400).json({ error: empFkError }); return; }

  const existing = await db.select({ employeeId: trainingClassAttendeesTable.employeeId })
    .from(trainingClassAttendeesTable)
    .where(eq(trainingClassAttendeesTable.classId, classId));
  const existingSet = new Set(existing.map(e => e.employeeId));
  const newIds = employeeIds.filter(id => !existingSet.has(id));

  if (newIds.length > 0) {
    await db.insert(trainingClassAttendeesTable).values(
      newIds.map(employeeId => ({ classId, employeeId, attended: true }))
    );
  }

  res.json({ added: newIds.length });
});

router.post("/training-classes/:id/complete", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!["platform_admin", "org_admin", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const classId = Number(req.params.id);
  const conditions = await buildClassConditions(user, classId);

  const [cls] = await db.select().from(trainingClassesTable).where(and(...conditions));
  if (!cls) { res.status(404).json({ error: "Class not found" }); return; }
  if (cls.status === "completed") { res.status(400).json({ error: "Class already completed" }); return; }

  const attendees = await db.select({
    id: trainingClassAttendeesTable.id,
    employeeId: trainingClassAttendeesTable.employeeId,
    attended: trainingClassAttendeesTable.attended,
    trainingRecordId: trainingClassAttendeesTable.trainingRecordId,
  }).from(trainingClassAttendeesTable).where(eq(trainingClassAttendeesTable.classId, classId));

  const attendedList = attendees.filter(a => a.attended && !a.trainingRecordId);

  const [trainingType] = await db.select().from(trainingTypesTable).where(eq(trainingTypesTable.id, cls.trainingTypeId));

  let recordsCreated = 0;

  for (const attendee of attendedList) {
    const [emp] = await db.select({ facilityId: employeesTable.facilityId })
      .from(employeesTable)
      .where(eq(employeesTable.id, attendee.employeeId));

    const facilityId = emp?.facilityId ?? cls.facilityId;
    if (!facilityId) continue;

    const dueDate = calculateDueDate(cls.classDate, trainingType?.renewalIntervalDays ?? null);
    const status = calculateTrainingStatus(cls.classDate, dueDate, trainingType?.warningDaysDefault ?? 90);

    const [record] = await db.insert(trainingRecordsTable).values({
      organizationId: cls.organizationId,
      facilityId,
      employeeId: attendee.employeeId,
      trainingTypeId: cls.trainingTypeId,
      completionDate: cls.classDate,
      dueDate,
      status,
      trainerName: user.firstName + " " + user.lastName,
      hours: cls.durationHours,
      completionMethod: "in_person",
      notes: `Completed via class: ${cls.className}`,
    }).returning();

    await db.update(trainingClassAttendeesTable)
      .set({ trainingRecordId: record.id })
      .where(eq(trainingClassAttendeesTable.id, attendee.id));

    recordsCreated++;
  }

  await db.update(trainingClassesTable)
    .set({ status: "completed" })
    .where(eq(trainingClassesTable.id, classId));

  await logAudit(req, "training_class.completed", "training_class", classId, null, { recordsCreated });
  res.json({ classId, recordsCreated });
});

router.post("/training-classes/:id/roster", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!["platform_admin", "org_admin", "trainer"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const classId = Number(req.params.id);
  const conditions = await buildClassConditions(user, classId);

  const [cls] = await db.select().from(trainingClassesTable).where(and(...conditions));
  if (!cls) { res.status(404).json({ error: "Class not found" }); return; }

  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const [doc] = await db.insert(trainingDocumentsTable).values({
    organizationId: cls.organizationId,
    facilityId: cls.facilityId,
    fileName: req.file.originalname,
    fileUrl: `/api/documents/file/${req.file.filename}`,
    fileType: req.file.mimetype,
    fileSize: req.file.size,
    uploadedByUserId: user.id,
    documentType: "roster",
  }).returning();

  await db.update(trainingClassesTable)
    .set({ rosterDocumentId: doc.id })
    .where(eq(trainingClassesTable.id, classId));

  await logAudit(req, "training_class.roster_uploaded", "training_class", classId, null, { documentId: doc.id });
  res.json({ documentId: doc.id, fileName: req.file.originalname });
});

router.get("/facilities/retraining-status", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conditions: SQL[] = [];
  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    conditions.push(eq(facilitiesTable.organizationId, user.organizationId));
  }

  const facilities = await db
    .select()
    .from(facilitiesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const result = [];

  for (const facility of facilities) {
    const medAdminStaff = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(
        eq(employeesTable.facilityId, facility.id),
        eq(employeesTable.administersMedications, true),
        eq(employeesTable.status, "active"),
      ));

    const totalMedAdminStaff = medAdminStaff.length;

    if (totalMedAdminStaff === 0) {
      result.push({
        facilityId: facility.id,
        facilityName: facility.name,
        facilityType: facility.facilityType,
        totalMedAdminStaff: 0,
        compliantCount: 0,
        dueSoonCount: 0,
        expiredCount: 0,
        missingCount: 0,
        nextExpiryDate: null,
        overallStatus: "compliant" as const,
      });
      continue;
    }

    const empIds = medAdminStaff.map(e => e.id);
    const records = await db
      .select({
        status: trainingRecordsTable.status,
        dueDate: trainingRecordsTable.dueDate,
      })
      .from(trainingRecordsTable)
      .where(and(
        eq(trainingRecordsTable.facilityId, facility.id),
        inArray(trainingRecordsTable.employeeId, empIds),
      ));

    let compliant = 0, dueSoon = 0, expired = 0, missing = 0;
    let nextExpiry: string | null = null;

    for (const r of records) {
      if (r.status === "compliant") compliant++;
      else if (r.status === "due_soon") { dueSoon++; if (r.dueDate && (!nextExpiry || r.dueDate < nextExpiry)) nextExpiry = r.dueDate; }
      else if (r.status === "expired") { expired++; if (r.dueDate && (!nextExpiry || r.dueDate < nextExpiry)) nextExpiry = r.dueDate; }
      else missing++;
    }

    let overallStatus: "compliant" | "due_soon" | "expired" | "critical" = "compliant";
    if (expired > 0) overallStatus = "expired";
    else if (dueSoon > 0) overallStatus = "due_soon";
    if (expired > totalMedAdminStaff * 0.25) overallStatus = "critical";

    result.push({
      facilityId: facility.id,
      facilityName: facility.name,
      facilityType: facility.facilityType,
      totalMedAdminStaff,
      compliantCount: compliant,
      dueSoonCount: dueSoon,
      expiredCount: expired,
      missingCount: missing,
      nextExpiryDate: nextExpiry,
      overallStatus,
    });
  }

  result.sort((a, b) => {
    const order = { critical: 0, expired: 1, due_soon: 2, compliant: 3 };
    return order[a.overallStatus] - order[b.overallStatus];
  });

  res.json(result);
});

export default router;
