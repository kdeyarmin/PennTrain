import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

const ADMIN_ROLES = ["platform_admin", "org_admin", "facility_manager", "trainer"];
const REVIEW_ROLES = ["platform_admin", "org_admin", "facility_manager"];

type AuditEvent = { action: string; entityType: string; entityId: string; actorUserId?: number; createdAt: string; metadata?: unknown };
type Course = { id: string; title: string; status: "draft" | "published" | "archived"; hours: number; category: string; version: string };
type Assignment = { id: string; staff: string; courseId: string; status: "not_started" | "in_progress" | "completed" | "overdue" | "failed" | "waived"; dueDate: string; score?: number };
type ExternalRecord = { id: string; staff: string; certificateName: string; issuer: string; status: "pending" | "approved" | "rejected"; hours: number; reviewComments?: string };
type MedicationCertification = { id: string; staff: string; expirationDate: string; status: "current" | "due_soon" | "expired" | "missing_documentation"; notes?: string };
type CompetencyRecord = { id: string; staff: string; template: string; observedBy?: string; status: "pending" | "passed" | "failed"; observedAt?: string; comments?: string };
type InserviceSession = { id: string; title: string; facility: string; attendees: Array<{ staff: string; attended: boolean }> };

const courses: Course[] = [
  { id: "c1", title: "Resident Rights and Dignity Essentials", status: "published", hours: 0.75, category: "Resident Rights", version: "1.0" },
  { id: "c2", title: "Recognizing and Reporting Abuse or Neglect", status: "published", hours: 1, category: "Abuse Reporting", version: "1.1" },
];
const assignments: Assignment[] = [
  { id: "a1", staff: "Avery Johnson", courseId: "c1", status: "in_progress", dueDate: "2026-07-20" },
  { id: "a2", staff: "Morgan Lee", courseId: "c2", status: "overdue", dueDate: "2026-07-01", score: 72 },
];
const externalRecords: ExternalRecord[] = [
  { id: "e1", staff: "Morgan Lee", certificateName: "Medication update certificate", issuer: "External provider", status: "pending", hours: 2 },
];
const medicationCertifications: MedicationCertification[] = [
  { id: "m1", staff: "Morgan Lee", expirationDate: "2026-08-31", status: "due_soon" },
  { id: "m2", staff: "Riley Patel", expirationDate: "2026-02-14", status: "expired", notes: "Renewal documentation missing" },
];
const competencyRecords: CompetencyRecord[] = [
  { id: "k1", staff: "Avery Johnson", template: "Direct care competency", observedBy: "Casey Nguyen, RN", status: "passed", observedAt: "2026-06-18" },
  { id: "k2", staff: "Jordan Smith", template: "Transfer/ambulation assistance", status: "pending" },
];
const inserviceSessions: InserviceSession[] = [
  { id: "i1", title: "Fire Safety Drill and Evacuation Review", facility: "Oakview Personal Care", attendees: [{ staff: "Avery Johnson", attended: true }, { staff: "Morgan Lee", attended: false }] },
];
const notifications: Array<{ id: string; user: string; title: string; body: string; read: boolean; createdAt: string }> = [];
const auditEvents: AuditEvent[] = [];

function record(action: string, entityType: string, entityId: string, actorUserId?: number, metadata?: unknown) {
  auditEvents.unshift({ action, entityType, entityId, actorUserId, createdAt: new Date().toISOString(), metadata });
}

function summarize() {
  const overdue = assignments.filter(a => a.status === "overdue").length;
  const completed = assignments.filter(a => a.status === "completed").length;
  return {
    coursesPublished: courses.filter(c => c.status === "published").length,
    coursesTotal: courses.length,
    assignments: assignments.length,
    completed,
    overdue,
    pendingExternalReviews: externalRecords.filter(r => r.status === "pending").length,
    expiringMedicationCertifications: medicationCertifications.filter(m => m.status === "due_soon" || m.status === "expired").length,
    incompleteCompetencies: competencyRecords.filter(c => c.status === "pending").length,
    compliancePercentage: assignments.length ? Math.round(((assignments.length - overdue) / assignments.length) * 100) : 100,
  };
}

router.get("/caremetric", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json({ organizationId: user.organizationId, role: user.role, summary: summarize(), courses, assignments, externalRecords, medicationCertifications, competencyRecords, inserviceSessions, notifications, auditEvents });
});

router.get("/caremetric/summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json({ organizationId: user.organizationId, role: user.role, ...summarize(), auditEvents });
});

router.post("/caremetric/courses", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ title: z.string().min(3), category: z.string().min(2), hours: z.number().nonnegative().default(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const course: Course = { id: `c${courses.length + 1}`, status: "draft", version: "0.1-draft", ...parsed.data };
  courses.unshift(course);
  record("course_created", "course", course.id, user.id, course);
  res.status(201).json(course);
});

router.post("/caremetric/assignments", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ staff: z.string().min(2), courseId: z.string().min(1), dueDate: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const assignment: Assignment = { id: `a${assignments.length + 1}`, status: "not_started", ...parsed.data };
  assignments.unshift(assignment);
  record("course_assigned", "course_assignment", assignment.id, user.id, assignment);
  res.status(201).json(assignment);
});

router.post("/caremetric/quiz-attempts", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = z.object({ assignmentId: z.string(), answers: z.array(z.boolean()), passingScore: z.number().min(0).max(100).default(80) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const correct = parsed.data.answers.filter(Boolean).length;
  const score = Math.round((correct / Math.max(parsed.data.answers.length, 1)) * 100);
  const passed = score >= parsed.data.passingScore;
  const assignment = assignments.find(a => a.id === parsed.data.assignmentId);
  if (assignment) {
    assignment.score = score;
    assignment.status = passed ? "completed" : "failed";
  }
  record("quiz_attempt", "course_assignment", parsed.data.assignmentId, user.id, { score, passed });
  res.json({ score, passed, certificateReady: passed, assignment });
});

router.post("/caremetric/external-records/:id/review", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !REVIEW_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ status: z.enum(["approved", "rejected"]), reviewComments: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const recordToReview = externalRecords.find(r => r.id === req.params.id);
  if (!recordToReview) { res.status(404).json({ error: "External record not found" }); return; }
  Object.assign(recordToReview, parsed.data);
  record(`external_certificate_${parsed.data.status}`, "external_training_record", recordToReview.id, user.id, recordToReview);
  res.json(recordToReview);
});

router.post("/caremetric/competencies/:id/complete", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ observedBy: z.string().min(2), status: z.enum(["passed", "failed"]), comments: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const competency = competencyRecords.find(c => c.id === req.params.id);
  if (!competency) { res.status(404).json({ error: "Competency not found" }); return; }
  Object.assign(competency, parsed.data, { observedAt: new Date().toISOString().slice(0, 10) });
  record("competency_completed", "competency_record", competency.id, user.id, competency);
  res.json(competency);
});

router.post("/caremetric/inservices/:id/attendance", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ staff: z.string().min(2), attended: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const session = inserviceSessions.find(s => s.id === req.params.id);
  if (!session) { res.status(404).json({ error: "In-service session not found" }); return; }
  const attendee = session.attendees.find(a => a.staff === parsed.data.staff);
  if (attendee) attendee.attended = parsed.data.attended;
  else session.attendees.push(parsed.data);
  record("inservice_attendance_marked", "inservice_session", session.id, user.id, parsed.data);
  res.json(session);
});

router.post("/caremetric/medications/:id", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ expirationDate: z.string().min(8).optional(), status: z.enum(["current", "due_soon", "expired", "missing_documentation"]).optional(), notes: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const medication = medicationCertifications.find(m => m.id === req.params.id);
  if (!medication) { res.status(404).json({ error: "Medication certification not found" }); return; }
  Object.assign(medication, parsed.data);
  record("medication_certification_updated", "medication_certification", medication.id, user.id, medication);
  res.json(medication);
});

router.post("/caremetric/notifications", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ user: z.string().min(2), title: z.string().min(2), body: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const notification = { id: `n${notifications.length + 1}`, read: false, createdAt: new Date().toISOString(), ...parsed.data };
  notifications.unshift(notification);
  record("notification_created", "notification", notification.id, user.id, notification);
  res.status(201).json(notification);
});

router.post("/caremetric/binder-export", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const exportId = `binder-${Date.now()}`;
  record("report_exported", "compliance_binder_export", exportId, user.id, req.body);
  res.status(201).json({ id: exportId, status: "generated", format: req.body?.format ?? "pdf", generatedAt: new Date().toISOString(), summary: summarize() });
});

export default router;
