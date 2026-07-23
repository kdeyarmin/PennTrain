import type { AuthUser } from "@/lib/auth";
import { viewablePathForRole } from "@/lib/appDomains";

export type CopilotIntent =
  | "navigate"
  | "how-to"
  | "risk"
  | "training"
  | "resident"
  | "support"
  | "staffing"
  | "documents"
  | "general";

export type CopilotSuggestion = {
  title: string;
  prompt: string;
};

export type CopilotAnswer = {
  intent: CopilotIntent;
  title: string;
  answer: string;
  nextSteps: string[];
  links: Array<{ label: string; href: string }>;
  followUpQuestions: string[];
  confidence: "high" | "medium" | "low";
  caution?: string;
};

type CopilotLink = { label: string; href: string; roles?: AuthUser["role"][] };

type KnowledgeItem = {
  keywords: string[];
  title: string;
  answer: string;
  nextSteps: string[];
  links: CopilotLink[];
  intent: CopilotIntent;
  followUpQuestions: string[];
  caution?: string;
  priority?: number;
};

type RouteContext = {
  label: string;
  intent: CopilotIntent;
  focus: string;
  suggestedPrompt: string;
  links?: CopilotLink[];
};

const ORG_ROLES: AuthUser["role"][] = ["org_admin", "facility_manager", "trainer", "auditor"];
const MANAGER_ROLES: AuthUser["role"][] = ["org_admin", "facility_manager"];

const ROUTE_CONTEXTS: Array<{ test: RegExp; context: RouteContext }> = [
  {
    test: /^\/app\/training-matrix/,
    context: {
      label: "Training Matrix",
      intent: "training",
      focus: "identify staff with overdue, due-soon, or missing requirements and decide whether the fix is assignment, exemption, documentation, or competency validation",
      suggestedPrompt: "What training gaps should I triage first on this matrix?",
      links: [{ label: "Training Assignments", href: "/app/course-assignments", roles: MANAGER_ROLES }],
    },
  },
  {
    test: /^\/app\/(alerts|inspection-readiness|compliance-binder|violations|documentation)/,
    context: {
      label: "Compliance Work",
      intent: "risk",
      focus: "prioritize high-severity items, assign owners, gather documentation, and close the loop before deadlines",
      suggestedPrompt: "Help me prioritize the compliance risks on this page.",
      links: [{ label: "Compliance Binder", href: "/app/compliance-binder", roles: ORG_ROLES }],
    },
  },
  {
    test: /^\/app\/(residents|admissions|change-of-condition|resident-care-delivery|services|qapi)/,
    context: {
      label: "Resident Operations",
      intent: "resident",
      focus: "connect resident documentation, follow-up work, service delivery, and quality tracking so nothing falls through the cracks",
      suggestedPrompt: "What should I check for this resident workflow?",
      links: [{ label: "QAPI & Quality", href: "/app/qapi", roles: MANAGER_ROLES }],
    },
  },
  {
    test: /^\/app\/(employees|schedule|workforce-operations|credentials|background-checks|exclusion-screening)/,
    context: {
      label: "Workforce Operations",
      intent: "staffing",
      focus: "keep staff records, schedules, credentials, screenings, and role requirements current",
      suggestedPrompt: "What staff record or credential issue should I resolve first?",
      links: [{ label: "Employees", href: "/app/employees", roles: MANAGER_ROLES }],
    },
  },
  {
    test: /^\/app\/(documents|policy-documents|template-documents|state-forms|dhs-forms)/,
    context: {
      label: "Documents",
      intent: "documents",
      focus: "find the right form or policy, complete required fields, capture signatures, and retain documentation in the correct record",
      suggestedPrompt: "Which document workflow should I use here?",
      links: [{ label: "Documents", href: "/app/documents", roles: ORG_ROLES }],
    },
  },
  {
    test: /^\/me\//,
    context: {
      label: "My Workspace",
      intent: "training",
      focus: "complete assigned training, review schedule items, find certificates, and ask for help when something looks incorrect",
      suggestedPrompt: "How do I finish what is assigned to me?",
      links: [{ label: "My Training", href: "/me/courses", roles: ["employee", ...ORG_ROLES] }],
    },
  },
];

const KNOWLEDGE_BASE: KnowledgeItem[] = [
  {
    intent: "training",
    priority: 3,
    keywords: ["training", "course", "quiz", "assignment", "matrix", "certificate", "class", "in-service", "competency", "retraining", "attestation", "ceu"],
    title: "Training and competency workflow",
    answer:
      "Treat training questions as a gap-closure workflow: identify the missing requirement, assign or document the learning, validate hands-on competency when required, and confirm the employee has durable documentation such as a certificate, class roster, or competency record.",
    nextSteps: [
      "Use Training Matrix to separate overdue, due-soon, missing, and completed requirements before acting.",
      "If multiple people need the same requirement, use Training Assignments or Training Plans instead of updating employees one-by-one.",
      "For skills that require observation, finish the loop in Competency Records, Practicums, or In-Service Classes rather than relying only on course completion.",
      "Tell employees to use My Training for courses, quizzes, certificates, and assigned learning status.",
    ],
    links: [
      { label: "Training Matrix", href: "/app/training-matrix", roles: ORG_ROLES },
      { label: "Training Assignments", href: "/app/course-assignments", roles: MANAGER_ROLES },
      { label: "Competency Records", href: "/app/competency-records", roles: ORG_ROLES },
      { label: "My Training", href: "/me/courses" },
    ],
    followUpQuestions: ["Is this gap for one employee or a group?", "Does the requirement need observed competency documentation?", "Is the deadline tied to inspection readiness?"],
  },
  {
    intent: "risk",
    priority: 4,
    keywords: ["alert", "risk", "overdue", "expired", "inspection", "compliance", "violation", "survey", "binder", "evidence", "citation", "deadline", "audit"],
    title: "Compliance risk triage",
    answer:
      "Triage compliance work by resident or staff safety impact, regulatory deadline, documentation availability, and owner clarity. The fastest path is usually: assign an owner, attach proof, document the corrective action, and verify the item no longer appears as an active risk.",
    nextSteps: [
      "Sort or filter the list by severity and due date so urgent risks are handled first.",
      "Open the source record before closing anything; confirm the underlying staff, resident, document, or facility data is corrected.",
      "Store proof in Documentation Room or Compliance Binder when the item may be reviewed during survey or audit.",
      "If the risk reflects a trend, create QAPI follow-up or corrective action instead of treating it as a one-off task.",
    ],
    links: [
      { label: "Alerts", href: "/app/alerts", roles: ORG_ROLES },
      { label: "Inspection Readiness", href: "/app/inspection-readiness", roles: ["org_admin", "facility_manager", "auditor", "platform_admin"] },
      { label: "Compliance Binder", href: "/app/compliance-binder", roles: ORG_ROLES },
      { label: "QAPI & Quality", href: "/app/qapi", roles: MANAGER_ROLES },
    ],
    followUpQuestions: ["What is the due date?", "Who owns the corrective action?", "What documentation would prove this is resolved?"],
  },
  {
    intent: "resident",
    priority: 3,
    keywords: ["resident", "admission", "move in", "facesheet", "assessment", "care", "service", "medication", "qapi", "dietary", "condition", "incident", "change"],
    title: "Resident operations guidance",
    answer:
      "For resident questions, anchor the work to the resident record and the operational queue that owns the next action: admissions for move-in, assessments and service delivery for care needs, change-of-condition for follow-up, medication integration for med safety, and QAPI when patterns or quality projects emerge.",
    nextSteps: [
      "Open the resident or admission workspace and confirm demographics, responsible parties, assessment status, and required signatures are current.",
      "Use Change Follow-Up when a condition change needs owner tracking, due dates, or closure documentation.",
      "Document service or medication-related actions in the operational module that produced the work so downstream reports stay accurate.",
      "Escalate recurring events, avoidable delays, or high-risk patterns to QAPI.",
    ],
    links: [
      { label: "Residents", href: "/app/residents", roles: ORG_ROLES },
      { label: "Admissions & Census", href: "/app/admissions", roles: MANAGER_ROLES },
      { label: "Change Follow-Up", href: "/app/change-of-condition", roles: MANAGER_ROLES },
      { label: "QAPI & Quality", href: "/app/qapi", roles: MANAGER_ROLES },
    ],
    followUpQuestions: ["Is this about move-in, current care, or follow-up?", "Is there a deadline or required signature?", "Does this need QAPI review?"],
  },
  {
    intent: "staffing",
    priority: 2,
    keywords: ["employee", "staff", "schedule", "shift", "credential", "clearance", "background", "exclusion", "role", "hire", "onboard", "workforce"],
    title: "Workforce and credential guidance",
    answer:
      "Workforce questions usually require checking both the employee profile and the requirement that drives the task. Confirm the person, role, facility scope, schedule impact, and credential or screening status before assigning follow-up.",
    nextSteps: [
      "Open the employee profile to verify role, facility assignment, manager, and active status.",
      "Check Credentials & Clearances, Background Checks, or Exclusion Screening for requirement-specific documentation.",
      "Use Schedule or Workforce Operations when the issue affects coverage, shift handoff, or staffing readiness.",
    ],
    links: [
      { label: "Employees", href: "/app/employees", roles: MANAGER_ROLES },
      { label: "Credentials & Clearances", href: "/app/credentials", roles: MANAGER_ROLES },
      { label: "Schedule", href: "/app/schedule", roles: MANAGER_ROLES },
    ],
    followUpQuestions: ["Is this for one employee or a facility-wide pattern?", "Which credential or role requirement is missing?", "Does coverage need an immediate workaround?"],
  },
  {
    intent: "documents",
    priority: 2,
    keywords: ["document", "form", "policy", "signature", "template", "dhs", "upload", "file", "scan", "agreement", "packet"],
    title: "Document and form workflow",
    answer:
      "Document work is strongest when the completed form, signature status, and retention location all line up. Use templates and state-form workflows for structured packets, policies for governed content, and the resident or staff record for documentation that belongs to a person.",
    nextSteps: [
      "Start from the workflow-specific form library or template instead of uploading a disconnected file when possible.",
      "Check whether signatures, attachments, approvals, or renewal dates are required before marking the item complete.",
      "Attach the finished document to the resident, employee, facility, or compliance binder context where reviewers will look for it.",
    ],
    links: [
      { label: "Documents", href: "/app/documents", roles: ORG_ROLES },
      { label: "Policy Documents", href: "/app/policy-documents", roles: MANAGER_ROLES },
      { label: "DHS Forms Library", href: "/app/dhs-forms", roles: ORG_ROLES },
    ],
    followUpQuestions: ["Who or what record should own this document?", "Does it require signatures or renewal?", "Will surveyors need it in a binder?"],
  },
  {
    intent: "navigate",
    priority: 1,
    keywords: ["where", "find", "open", "page", "navigate", "go to", "settings", "user", "facility", "report", "search", "dashboard"],
    title: "Finding the right page",
    answer:
      "When the goal is navigation, start with global search if you know a name, page title, course, facility, resident, or staff member. Otherwise, use the sidebar groups: directory, training, compliance, resident operations, documents, reporting, support, and settings.",
    nextSteps: [
      "Search the exact person, facility, course, document, or report name from the header search box.",
      "Use Reports for summaries and exports; use Settings or Users for configuration and access questions.",
      "If you cannot find a page, ask Copilot using the outcome you want, such as ‘assign annual training’ or ‘prepare inspection binder’."
    ],
    links: [
      { label: "Reports", href: "/app/reports", roles: ORG_ROLES },
      { label: "Users", href: "/app/users", roles: MANAGER_ROLES },
      { label: "Settings", href: "/app/settings", roles: MANAGER_ROLES },
      { label: "Help Center", href: "/app/help", roles: ["org_admin", "facility_manager", "trainer", "auditor"] },
    ],
    followUpQuestions: ["Are you looking for a person, page, report, or setting?", "Do you know the facility or record name?", "What outcome are you trying to complete?"],
  },
  {
    intent: "support",
    priority: 1,
    keywords: ["help", "support", "ticket", "bug", "issue", "stuck", "not working", "question", "error", "broken"],
    title: "Getting help or reporting an issue",
    answer:
      "Use Help Center for workflow guidance and tickets for issues that need follow-up. A strong support request includes the page, affected record, expected result, actual result, urgency, and screenshots or timestamps when available.",
    nextSteps: [
      "Search Help Center for the workflow or page name first; many answers are context-specific.",
      "If creating a ticket, include the affected resident/staff/facility record and what changed immediately before the issue appeared.",
      "For urgent resident safety, staffing coverage, or compliance deadline issues, follow your organization escalation process while the ticket is being reviewed.",
    ],
    links: [
      { label: "Help Center", href: "/app/help", roles: ["org_admin", "facility_manager", "trainer", "auditor"] },
      { label: "Employee Help", href: "/me/help", roles: ["employee"] },
      { label: "Platform Support Tickets", href: "/admin/support-tickets", roles: ["platform_admin"] },
    ],
    followUpQuestions: ["What page were you on?", "What did you expect to happen?", "Is there a resident safety or deadline concern?"],
  },
];

const ROLE_LABELS: Record<AuthUser["role"], string> = {
  platform_admin: "platform administrator",
  org_admin: "organization administrator",
  facility_manager: "facility manager",
  trainer: "trainer",
  employee: "employee",
  auditor: "auditor",
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  return normalize(value).split(" ").filter((token) => token.length > 2);
}

function canUseLink(link: CopilotLink, role: AuthUser["role"]) {
  return !link.roles || link.roles.includes(role);
}

function findRouteContext(location: string): RouteContext | undefined {
  return ROUTE_CONTEXTS.find(({ test }) => test.test(location))?.context;
}

function scoreKnowledgeItem(item: KnowledgeItem, normalizedQuestion: string, questionTokens: string[], routeContext?: RouteContext) {
  const keywordScore = item.keywords.reduce((total, keyword) => {
    const normalizedKeyword = normalize(keyword);
    if (normalizedQuestion.includes(normalizedKeyword)) return total + Math.max(2, normalizedKeyword.split(" ").length * 2);
    return total;
  }, 0);
  const tokenScore = questionTokens.reduce((total, token) => total + item.keywords.filter((keyword) => normalize(keyword).includes(token)).length, 0);
  const routeScore = routeContext?.intent === item.intent ? 3 : 0;
  return keywordScore + tokenScore + routeScore + (item.priority ?? 0);
}

function confidenceForScore(score: number): CopilotAnswer["confidence"] {
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function uniqueLinks(links: CopilotLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.href)) return false;
    seen.add(link.href);
    return true;
  });
}

function pageLabel(location: string, routeContext?: RouteContext) {
  if (routeContext) return routeContext.label;
  if (location === "/" || location === "/app" || location === "/admin" || location === "/me") return "Dashboard";
  return location.replace(/^\//, "").replace(/[/-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getCopilotSuggestions(role: AuthUser["role"], location: string): CopilotSuggestion[] {
  const routeContext = findRouteContext(location);
  const base: CopilotSuggestion[] = [
    { title: "Find my next step", prompt: routeContext?.suggestedPrompt ?? "What should I do next on this page?" },
    { title: "Resolve a risk", prompt: "How should I triage overdue compliance risks?" },
    { title: "Explain workflow", prompt: "Explain the best workflow for training assignments and competency documentation." },
  ];

  if (role === "employee") {
    return [
      { title: "Finish training", prompt: "How do I complete my assigned training and find certificates?" },
      { title: "Schedule help", prompt: "Where can I see my schedule and shift information?" },
      { title: "Ask support", prompt: "What should I include when I need help?" },
    ];
  }

  if (routeContext?.intent === "resident") {
    return [{ title: "Resident workflow", prompt: routeContext.suggestedPrompt }, ...base.slice(1)];
  }

  if (routeContext?.intent === "staffing") {
    return [{ title: "Staffing workflow", prompt: routeContext.suggestedPrompt }, ...base.slice(1)];
  }

  return base;
}

export function answerCareMetricCopilot(question: string, user: AuthUser, location: string): CopilotAnswer {
  const routeContext = findRouteContext(location);
  const normalizedQuestion = normalize(question);
  const questionTokens = tokenize(question);
  const scored = KNOWLEDGE_BASE.map((entry) => ({
    entry,
    score: scoreKnowledgeItem(entry, normalizedQuestion, questionTokens, routeContext),
  })).sort((a, b) => b.score - a.score);
  const best = scored[0] ?? { entry: KNOWLEDGE_BASE[0], score: 0 };
  const item = best.score > 0 ? best.entry : routeContext ? KNOWLEDGE_BASE.find((entry) => entry.intent === routeContext.intent) ?? best.entry : best.entry;
  const isVagueQuestion = questionTokens.length < 3 && !routeContext;
  const confidence = isVagueQuestion ? "low" : confidenceForScore(best.score);
  const routeLinks = routeContext?.links ?? [];
  const roleLinks = uniqueLinks([...routeLinks, ...item.links])
    .filter((link) => canUseLink(link, user.role))
    .map((link) => ({ ...link, href: viewablePathForRole(link.href, user.role) }))
    .filter((link): link is CopilotLink => !!link.href);
  const roleLabel = ROLE_LABELS[user.role];
  const currentPage = pageLabel(location, routeContext);
  const pageGuidance = routeContext ? ` On this page, focus on how to ${routeContext.focus}.` : "";
  const lowConfidenceGuidance =
    confidence === "low"
      ? " I may need a little more detail, so I am giving the safest general workflow and the questions I would ask next."
      : "";

  return {
    intent: item.intent,
    title: item.title,
    answer: `${item.answer} Based on your ${roleLabel} access and current page (${currentPage}), prioritize actions you can verify directly in CareMetric.${pageGuidance}${lowConfidenceGuidance}`,
    nextSteps: item.nextSteps,
    links: roleLinks.map(({ label, href }) => ({ label, href })),
    followUpQuestions: item.followUpQuestions,
    confidence,
    caution:
      item.caution ??
      "Copilot guidance is workflow support, not legal, clinical, or regulatory advice. Confirm time-sensitive decisions against your organization policy and applicable regulations.",
  };
}
