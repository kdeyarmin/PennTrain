import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

const courses = [
  { id: "c1", title: "Resident Rights and Dignity Essentials", status: "published", hours: 0.75, category: "Resident Rights" },
  { id: "c2", title: "Recognizing and Reporting Abuse or Neglect", status: "published", hours: 1, category: "Abuse Reporting" },
];
const assignments = [
  { id: "a1", staff: "Avery Johnson", courseId: "c1", status: "in_progress", dueDate: "2026-07-20" },
  { id: "a2", staff: "Morgan Lee", courseId: "c2", status: "overdue", dueDate: "2026-07-01" },
];
const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorUserId?: number; createdAt: string; metadata?: unknown }> = [];
const MAX_AUDIT_EVENTS = 200;

function record(action: string, entityType: string, entityId: string, actorUserId?: number, metadata?: unknown) {
  auditEvents.unshift({ action, entityType, entityId, actorUserId, createdAt: new Date().toISOString(), metadata });
  if (auditEvents.length > MAX_AUDIT_EVENTS) auditEvents.length = MAX_AUDIT_EVENTS;
}

router.get("/caremetric/summary", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const overdue = assignments.filter(a => a.status === "overdue").length;
  res.json({
    organizationId: user.organizationId,
    role: user.role,
    coursesPublished: courses.filter(c => c.status === "published").length,
    assignments: assignments.length,
    overdue,
    compliancePercentage: assignments.length ? Math.round(((assignments.length - overdue) / assignments.length) * 100) : 100,
    auditEvents,
  });
});

router.post("/caremetric/courses", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ title: z.string().min(3), category: z.string().min(2), hours: z.number().nonnegative().default(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const course = { id: `c${courses.length + 1}`, status: "draft", ...parsed.data };
  courses.unshift(course);
  record("course_created", "course", course.id, user.id, course);
  res.status(201).json(course);
});

router.post("/caremetric/assignments", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ staff: z.string().min(2), courseId: z.string().min(1), dueDate: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const assignment = { id: `a${assignments.length + 1}`, status: "not_started", ...parsed.data };
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
  if (passed) {
    const assignment = assignments.find(a => a.id === parsed.data.assignmentId);
    if (assignment) assignment.status = "completed";
  }
  record("quiz_attempt", "course_assignment", parsed.data.assignmentId, user.id, { score, passed });
  res.json({ score, passed, certificateReady: passed });
});

router.post("/caremetric/binder-export", requireAuth, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({
    format: z.enum(["pdf", "csv", "html"]).optional(),
    sections: z.array(z.string().min(1)).max(50).optional(),
    facilityId: z.string().optional(),
    staffIds: z.array(z.string()).max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const exportId = `binder-${Date.now()}`;
  record("report_exported", "compliance_binder_export", exportId, user.id, parsed.data);
  res.status(201).json({ id: exportId, status: "generated", format: parsed.data.format ?? "pdf", generatedAt: new Date().toISOString() });
});

export default router;
