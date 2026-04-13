import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trainingDocumentsTable, facilitiesTable, employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getCurrentUser, getAssignedFacilityIds } from "../lib/auth";
import { logAudit } from "../lib/audit";
import multer from "multer";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed. Accepted: PDF, JPG, PNG"));
    }
  },
});

router.get("/documents", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!["platform_admin", "org_admin", "facility_manager", "trainer", "employee"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  let query = db.select().from(trainingDocumentsTable).$dynamic();

  if (user.role === "employee") {
    // Employees always see only their own documents — derive identity from session
    if (!user.organizationId) { res.json([]); return; }
    const [selfEmp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email), eq(employeesTable.organizationId, user.organizationId))
    );
    if (!selfEmp) { res.json([]); return; }
    query = query.where(
      and(
        eq(trainingDocumentsTable.organizationId, user.organizationId),
        eq(trainingDocumentsTable.employeeId, selfEmp.id)
      )
    );
  } else {
    if (user.role !== "platform_admin") {
      if (!user.organizationId) { res.json([]); return; }
      query = query.where(eq(trainingDocumentsTable.organizationId, user.organizationId));
    } else if (req.query.organizationId) {
      query = query.where(eq(trainingDocumentsTable.organizationId, Number(req.query.organizationId)));
    }

    // Restrict facility_manager and trainer to only their assigned facilities
    if (["facility_manager", "trainer"].includes(user.role)) {
      const { getAssignedFacilityIds } = await import("../lib/auth");
      const assignedFacilityIds = await getAssignedFacilityIds(user);
      if (assignedFacilityIds !== null) {
        if (assignedFacilityIds.length === 0) { res.json([]); return; }
        if (req.query.facilityId) {
          const reqFacilityId = Number(req.query.facilityId);
          if (!assignedFacilityIds.includes(reqFacilityId)) {
            res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
          }
          query = query.where(eq(trainingDocumentsTable.facilityId, reqFacilityId));
        } else {
          // Filter to all assigned facilities using in-memory post-filter (drizzle doesn't support inArray easily here)
          const docs = await query.orderBy(trainingDocumentsTable.createdAt);
          const filtered = docs.filter(d => d.facilityId !== null && assignedFacilityIds.includes(d.facilityId));
          if (req.query.employeeId) {
            res.json(filtered.filter(d => d.employeeId === Number(req.query.employeeId)));
          } else {
            res.json(filtered);
          }
          return;
        }
      }
    } else if (req.query.facilityId) {
      const facilityId = Number(req.query.facilityId);
      if (user.role !== "platform_admin" && user.organizationId) {
        const [fac] = await db.select().from(facilitiesTable).where(
          and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.organizationId, user.organizationId))
        );
        if (!fac) { res.status(403).json({ error: "Forbidden" }); return; }
      }
      query = query.where(eq(trainingDocumentsTable.facilityId, facilityId));
    }
    if (req.query.employeeId) {
      query = query.where(eq(trainingDocumentsTable.employeeId, Number(req.query.employeeId)));
    }
  }
  if (req.query.trainingRecordId) {
    query = query.where(eq(trainingDocumentsTable.trainingRecordId, Number(req.query.trainingRecordId)));
  }
  if (req.query.documentType && typeof req.query.documentType === "string") {
    query = query.where(eq(trainingDocumentsTable.documentType, req.query.documentType as "certificate" | "roster" | "practicum_form" | "transcript" | "other"));
  }

  const docs = await query.orderBy(trainingDocumentsTable.createdAt);
  res.json(docs);
});

router.post("/documents", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer", "employee"].includes(user.role)) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(403).json({ error: "Forbidden" }); return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" }); return;
  }

  const { facilityId, employeeId, trainingRecordId, documentType } = req.body;
  if (!facilityId) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "facilityId is required" }); return;
  }

  let resolvedOrgId: number;
  if (user.role === "platform_admin") {
    const bodyOrgId = req.body.organizationId;
    if (!bodyOrgId) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: "organizationId required for platform_admin" }); return;
    }
    resolvedOrgId = Number(bodyOrgId);
  } else {
    if (!user.organizationId) {
      fs.unlinkSync(req.file.path);
      res.status(403).json({ error: "User has no organization" }); return;
    }
    resolvedOrgId = user.organizationId;
  }

  // Validate facility belongs to org
  const [facility] = await db.select().from(facilitiesTable).where(
    and(eq(facilitiesTable.id, Number(facilityId)), eq(facilitiesTable.organizationId, resolvedOrgId))
  );
  if (!facility) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "Facility not found in your organization" }); return;
  }

  // Enforce facility-assignment restriction for facility_manager and trainer
  if (["facility_manager", "trainer"].includes(user.role)) {
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && !assignedFacilityIds.includes(facility.id)) {
      fs.unlinkSync(req.file.path);
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
  }

  // Employees may only upload documents for themselves — derive from session
  let resolvedEmployeeId: number | null = employeeId ? Number(employeeId) : null;
  if (user.role === "employee") {
    const [selfEmp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email), eq(employeesTable.organizationId, resolvedOrgId))
    );
    if (!selfEmp) {
      fs.unlinkSync(req.file.path);
      res.status(403).json({ error: "No employee record found for your account" }); return;
    }
    // Override any submitted employeeId — employees can only create docs for themselves
    resolvedEmployeeId = selfEmp.id;
  } else if (resolvedEmployeeId) {
    // For other roles, validate the submitted employeeId belongs to the org
    const [employee] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.id, resolvedEmployeeId), eq(employeesTable.organizationId, resolvedOrgId))
    );
    if (!employee) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: "Employee not found in your organization" }); return;
    }
  }

  const fileUrl = `/api/documents/file/${req.file.filename}`;

  const [doc] = await db.insert(trainingDocumentsTable).values({
    organizationId: resolvedOrgId,
    facilityId: Number(facilityId),
    employeeId: resolvedEmployeeId,
    trainingRecordId: trainingRecordId ? Number(trainingRecordId) : null,
    fileName: req.file.originalname,
    fileUrl,
    fileType: req.file.mimetype,
    fileSize: req.file.size,
    uploadedByUserId: user.id,
    documentType: documentType ?? "other",
  }).returning();

  await logAudit(req, "document", doc.id, "create", null, doc, resolvedOrgId);
  res.status(201).json(doc);
});

router.get("/documents/file/:filename", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const filename = req.params.filename as string;
  const fileUrl = `/api/documents/file/${filename}`;
  const [doc] = await db.select().from(trainingDocumentsTable).where(eq(trainingDocumentsTable.fileUrl, fileUrl));
  if (!doc) { res.status(404).json({ error: "File not found" }); return; }

  if (user.role !== "platform_admin" && user.organizationId !== doc.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  if (user.role === "employee") {
    const [selfEmp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email ?? ""), eq(employeesTable.organizationId, user.organizationId ?? 0))
    );
    if (!selfEmp || doc.employeeId !== selfEmp.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }
  // facility_manager/trainer may only download files for their assigned facilities
  if (["facility_manager", "trainer"].includes(user.role)) {
    const { getAssignedFacilityIds } = await import("../lib/auth");
    const assignedIds = await getAssignedFacilityIds(user);
    if (assignedIds !== null && doc.facilityId !== null && !assignedIds.includes(doc.facilityId)) {
      res.status(403).json({ error: "Forbidden: document not in your assigned facilities" }); return;
    }
  }

  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found on disk" }); return;
  }

  res.download(filePath, doc.fileName);
});

router.get("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(String(req.params.id), 10);
  const [doc] = await db.select().from(trainingDocumentsTable).where(eq(trainingDocumentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== doc.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (user.role === "employee") {
    const [selfEmp] = await db.select().from(employeesTable).where(
      and(eq(employeesTable.email, user.email ?? ""), eq(employeesTable.organizationId, user.organizationId ?? 0))
    );
    if (!selfEmp || doc.employeeId !== selfEmp.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }
  if (["facility_manager", "trainer"].includes(user.role)) {
    const { getAssignedFacilityIds } = await import("../lib/auth");
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && doc.facilityId !== null && !assignedFacilityIds.includes(doc.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
  }
  res.json(doc);
});

router.delete("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  const [doc] = await db.select().from(trainingDocumentsTable).where(eq(trainingDocumentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  if (user.role !== "platform_admin" && user.organizationId !== doc.organizationId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (user.role === "facility_manager") {
    const { getAssignedFacilityIds } = await import("../lib/auth");
    const assignedFacilityIds = await getAssignedFacilityIds(user);
    if (assignedFacilityIds !== null && doc.facilityId !== null && !assignedFacilityIds.includes(doc.facilityId)) {
      res.status(403).json({ error: "Forbidden: not assigned to this facility" }); return;
    }
  }

  // Delete file from disk
  const filename = doc.fileUrl.split("/").pop();
  if (filename) {
    const filePath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  await db.delete(trainingDocumentsTable).where(eq(trainingDocumentsTable.id, id));
  await logAudit(req, "document", id, "delete", doc, null, doc.organizationId);
  res.sendStatus(204);
});

export default router;
