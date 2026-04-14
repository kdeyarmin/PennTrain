import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { employeesTable, trainingRecordsTable, trainingTypesTable, practicumsTable, trainingHourBucketsTable, trainingDocumentsTable, facilitiesTable, usersTable } from "@workspace/db";
import { eq, and, or, ilike, inArray, SQL } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";
import { validateBody } from "../lib/validate";
import { z } from "zod";

const router: IRouter = Router();

router.get("/employees", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (user.role === "employee") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const conditions: SQL[] = [];

  if (user.role !== "platform_admin") {
    if (!user.organizationId) { res.json([]); return; }
    conditions.push(eq(employeesTable.organizationId, user.organizationId));
  } else if (req.query.organizationId) {
    conditions.push(eq(employeesTable.organizationId, Number(req.query.organizationId)));
  }

  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (!assignedFacilityIds || assignedFacilityIds.length === 0) {
      res.json([]); return;
    }
    conditions.push(inArray(employeesTable.facilityId, assignedFacilityIds));
  }

  if (req.query.facilityId) {
    const facilityId = Number(req.query.facilityId);
    if (user.role !== "platform_admin") {
      const [facility] = await db.select().from(facilitiesTable).where(
        and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, user.organizationId!))
      );
      if (!facility) { res.status(403).json({ error: "Forbidden" }); return; }
    }
    conditions.push(eq(employeesTable.facilityId, facilityId));
  }
  if (req.query.status && typeof req.query.status === "string") {
    conditions.push(eq(employeesTable.status, req.query.status as "active" | "inactive" | "terminated" | "on_leave"));
  }
  if (req.query.administersMedications !== undefined) {
    conditions.push(eq(employeesTable.administersMedications, req.query.administersMedications === "true"));
  }
  if (req.query.trainerStatus !== undefined) {
    conditions.push(eq(employeesTable.trainerStatus, req.query.trainerStatus === "true"));
  }
  if (req.query.search && typeof req.query.search === "string") {
    const s = `%${req.query.search}%`;
    conditions.push(or(ilike(employeesTable.firstName, s), ilike(employeesTable.lastName, s), ilike(employeesTable.jobTitle, s))!);
  }

  const employees = await db.select().from(employeesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(employeesTable.lastName, employeesTable.firstName);
  res.json(employees);
});

const createEmployeeSchema = z.object({
  facilityId: z.number({ invalid_type_error: "facilityId must be a number" }),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  jobTitle: z.string().min(1),
  status: z.enum(["active", "inactive", "terminated", "on_leave"]).default("active"),
  administersMedications: z.boolean().default(false),
  trainerStatus: z.boolean().default(false),
  employeeNumber: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  hireDate: z.string().nullish(),
  terminationDate: z.string().nullish(),
  department: z.string().nullish(),
  notes: z.string().nullish(),
  organizationId: z.number().optional(),
});

router.post("/employees", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const body = validateBody(createEmployeeSchema, req, res);
  if (!body) return;

  const { facilityId, firstName, lastName, jobTitle, status, administersMedications, trainerStatus, employeeNumber, email, phone, hireDate, terminationDate, department, notes } = body;

  // Derive organizationId from server-side session, not client body
  let resolvedOrgId: number;
  if (user.role === "platform_admin") {
    // Platform admin must supply organizationId explicitly
    const bodyOrgId = body.organizationId;
    if (!bodyOrgId) { res.status(400).json({ error: "organizationId required for platform_admin" }); return; }
    resolvedOrgId = Number(bodyOrgId);
  } else {
    if (!user.organizationId) { res.status(403).json({ error: "User has no organization" }); return; }
    resolvedOrgId = user.organizationId;
  }

  // Validate facility belongs to the resolved organization
  const [facility] = await db.select().from(facilitiesTable).where(
    and(eq(facilitiesTable.id, Number(facilityId)), eq(facilitiesTable.organizationId, resolvedOrgId))
  );
  if (!facility) { res.status(400).json({ error: "Facility not found in your organization" }); return; }

  const [employee] = await db.insert(employeesTable).values({
    organizationId: resolvedOrgId,
    facilityId: Number(facilityId),
    firstName, lastName, jobTitle,
    status: status || "active",
    administersMedications: administersMedications ?? false,
    trainerStatus: trainerStatus ?? false,
    employeeNumber: employeeNumber ?? null,
    email: email ?? null,
    phone: phone ?? null,
    hireDate: hireDate ?? null,
    terminationDate: terminationDate ?? null,
    department: department ?? null,
    notes: notes ?? null,
  }).returning();

  await logAudit(req, "employee", employee.id, "create", null, employee, resolvedOrgId);
  res.status(201).json(employee);
});

router.get("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== employee.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (user.role === "employee") {
    const [linkedEmployee] = await db.select().from(employeesTable)
      .where(and(eq(employeesTable.email, user.email), eq(employeesTable.id, id)));
    if (!linkedEmployee) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && employee.facilityId !== null) {
      if (!assignedFacilityIds.includes(employee.facilityId)) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }
  }
  res.json(employee);
});

router.patch("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Employee not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // facility_manager may only edit employees in their assigned facilities
  if (user.role === "facility_manager") {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && existing.facilityId !== null && !assignedFacilityIds.includes(existing.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this employee's facility" }); return;
    }
  }

  // If changing facilityId, validate the new facility belongs to same org
  if (req.body.facilityId !== undefined) {
    const orgId = user.role === "platform_admin" ? existing.organizationId : user.organizationId!;
    const [facility] = await db.select().from(facilitiesTable).where(
      and(eq(facilitiesTable.id, Number(req.body.facilityId)), eq(facilitiesTable.organizationId, orgId))
    );
    if (!facility) { res.status(400).json({ error: "Facility not found in organization" }); return; }
  }

  const updates: Partial<typeof employeesTable.$inferInsert> = {};
  const allowed = ["employeeNumber", "firstName", "lastName", "email", "phone", "hireDate", "terminationDate", "jobTitle", "department", "status", "administersMedications", "trainerStatus", "notes", "facilityId"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) (updates as Record<string, unknown>)[field] = req.body[field];
  }

  const [updated] = await db.update(employeesTable).set(updates).where(eq(employeesTable.id, id)).returning();
  await logAudit(req, "employee", id, "update", existing, updated, existing.organizationId);
  res.json(updated);
});

router.delete("/employees/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Employee not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== existing.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // facility_manager may only delete employees in their assigned facilities
  if (user.role === "facility_manager") {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && existing.facilityId !== null && !assignedFacilityIds.includes(existing.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this employee's facility" }); return;
    }
  }

  await db.delete(employeesTable).where(eq(employeesTable.id, id));
  await logAudit(req, "employee", id, "delete", existing, null, existing.organizationId);
  res.sendStatus(204);
});

router.get("/employees/:id/compliance-summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== employee.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // Employee role may only view their own compliance summary
  if (user.role === "employee" && user.email !== employee.email) {
    res.status(403).json({ error: "Forbidden: employees may only view their own compliance summary" }); return;
  }
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && employee.facilityId !== null && !assignedIds.includes(employee.facilityId)) {
      res.status(403).json({ error: "Forbidden: employee not in your assigned facilities" }); return;
    }
  }

  const trainingRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.employeeId, id));

  const practicums = await db.select().from(practicumsTable).where(eq(practicumsTable.employeeId, id));
  const annualHours = await db.select().from(trainingHourBucketsTable).where(eq(trainingHourBucketsTable.employeeId, id));
  const rawDocuments = await db
    .select({ doc: trainingDocumentsTable, uploaderFirstName: usersTable.firstName, uploaderLastName: usersTable.lastName })
    .from(trainingDocumentsTable)
    .leftJoin(usersTable, eq(trainingDocumentsTable.uploadedByUserId, usersTable.id))
    .where(eq(trainingDocumentsTable.employeeId, id));
  const documents = rawDocuments.map(d => ({
    ...d.doc,
    uploadedByName: d.uploaderFirstName && d.uploaderLastName ? `${d.uploaderFirstName} ${d.uploaderLastName}` : null,
  }));

  const statuses = trainingRecords.map(r => r.record.status);
  const overallStatus = statuses.includes("expired") ? "expired" :
    statuses.includes("due_soon") ? "due_soon" :
    statuses.includes("missing") ? "missing" : "compliant";

  res.json({
    employeeId: id,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    status: employee.status,
    administersMedications: employee.administersMedications,
    trainerStatus: employee.trainerStatus,
    trainingRecords: trainingRecords.map(r => ({ ...r.record, trainingType: r.trainingType })),
    practicums,
    annualHours,
    documents,
    overallStatus,
  });
});

router.get("/employees/:id/transcript", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== employee.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // Employee role may only view their own transcript
  if (user.role === "employee" && user.email !== employee.email) {
    res.status(403).json({ error: "Forbidden: employees may only view their own transcript" }); return;
  }
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && employee.facilityId !== null && !assignedIds.includes(employee.facilityId)) {
      res.status(403).json({ error: "Forbidden: employee not in your assigned facilities" }); return;
    }
  }

  const trainingRecords = await db
    .select({ record: trainingRecordsTable, trainingType: trainingTypesTable })
    .from(trainingRecordsTable)
    .leftJoin(trainingTypesTable, eq(trainingRecordsTable.trainingTypeId, trainingTypesTable.id))
    .where(eq(trainingRecordsTable.employeeId, id))
    .orderBy(trainingRecordsTable.completionDate);

  const practicums = await db.select().from(practicumsTable)
    .where(eq(practicumsTable.employeeId, id))
    .orderBy(practicumsTable.practicumYear);

  res.json({
    employee,
    trainingRecords: trainingRecords.map(r => ({ ...r.record, trainingType: r.trainingType })),
    practicums,
  });
});

export default router;
