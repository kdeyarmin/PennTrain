import { viewablePathForRole } from "@/lib/appDomains";
import type { Role } from "@/lib/auth";

export type HelpCopilotIntent =
  | "training"
  | "compliance_risk"
  | "resident_operations"
  | "workforce_credentials"
  | "staffing"
  | "documents_forms"
  | "navigation"
  | "support";

export type HelpCopilotConfidence = "high" | "medium" | "low";

export interface HelpCopilotLink {
  label: string;
  href: string;
}

export interface HelpCopilotAnswer {
  intent: HelpCopilotIntent;
  intentLabel: string;
  confidence: HelpCopilotConfidence;
  answer: string;
  pageGuidance?: string;
  nextSteps: string[];
  links: HelpCopilotLink[];
  followUpQuestions: string[];
  caution?: string;
}

export interface HelpCopilotContext {
  role?: Role;
  currentRoute?: string | null;
}

interface KnowledgeLink extends HelpCopilotLink {
  roles?: Role[];
}

interface KnowledgeEntry {
  intent: HelpCopilotIntent;
  label: string;
  contextLabel: string;
  keywords: string[];
  routePrefixes: string[];
  answer: string;
  roleGuidance?: Partial<Record<Role, string>>;
  nextSteps: string[];
  links: KnowledgeLink[];
  followUpQuestions: string[];
  suggestions: string[];
  caution?: string;
}

const MANAGEMENT_ROLES: Role[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const REPORTING_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const MANAGER_ROLES: Role[] = ["org_admin", "facility_manager"];

const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  {
    intent: "training",
    label: "Training",
    contextLabel: "training workflow",
    keywords: [
      "training", "course", "class", "assignment", "assign training", "quiz", "certificate",
      "learning plan", "in service", "overdue training", "completion",
    ],
    routePrefixes: [
      "/app/training-matrix", "/app/courses", "/app/course-assignments", "/app/training-plans",
      "/trainer", "/me/courses", "/me/trainings", "/me/certificates",
    ],
    answer: "Use the training workflow to confirm the requirement, assign the correct course or plan, and monitor completion from the appropriate roster.",
    roleGuidance: {
      employee: "Open My Training Assignments to see what is required, resume a course, or review a due date. Completed items and certificates are available from your training record.",
      trainer: "Use Training Assignments or In-Service Classes to assign learning, record attendance, and follow incomplete or unsuccessful attempts.",
    },
    nextSteps: [
      "Confirm the employee, facility, requirement, and due date.",
      "Open the assignment or class roster and review its current status.",
      "Record completion, attendance, or any required follow-up in the same workflow.",
    ],
    links: [
      { label: "Training matrix", href: "/app/training-matrix", roles: MANAGEMENT_ROLES },
      { label: "Training assignments", href: "/app/course-assignments", roles: MANAGEMENT_ROLES },
      { label: "In-service classes", href: "/trainer/classes", roles: ["org_admin", "facility_manager", "trainer"] },
      { label: "My training assignments", href: "/me/courses" },
      { label: "My training records", href: "/me/trainings", roles: ["employee"] },
    ],
    followUpQuestions: [
      "How do I assign required training?",
      "Where can I see overdue training?",
      "How does an employee find a certificate?",
    ],
    suggestions: ["How do I assign required training?", "Where can I see overdue training?"],
  },
  {
    intent: "compliance_risk",
    label: "Compliance risk",
    contextLabel: "compliance workflow",
    keywords: [
      "compliance", "risk", "alert", "overdue", "violation", "plan of correction", "inspection",
      "survey", "citation", "incident", "complaint", "corrective action", "readiness",
    ],
    routePrefixes: [
      "/app/alerts", "/app/violations", "/app/inspection-readiness", "/app/inspections",
      "/app/incidents", "/app/complaints", "/app/regulatory", "/app/work",
    ],
    answer: "Start with the open risk or finding, confirm its owner and due date, then keep the supporting records and closure review connected to the same work item.",
    nextSteps: [
      "Open the item and confirm its severity, deadline, facility, and assigned owner.",
      "Record the immediate response and assign any corrective work that remains.",
      "Complete the required review before marking the item closed.",
    ],
    links: [
      { label: "Alerts", href: "/app/alerts", roles: MANAGEMENT_ROLES },
      { label: "Inspection readiness", href: "/app/inspection-readiness", roles: REPORTING_ROLES },
      { label: "Violations and plans of correction", href: "/app/violations", roles: REPORTING_ROLES },
      { label: "Operational work queue", href: "/app/work", roles: ["org_admin", "facility_manager", "auditor"] },
      { label: "My work", href: "/me/work", roles: ["employee"] },
    ],
    followUpQuestions: [
      "How do I prioritize overdue compliance work?",
      "Where do I document corrective actions?",
      "How do I prepare for an inspection?",
    ],
    suggestions: ["What compliance work needs attention first?", "How do I prepare for an inspection?"],
    caution: "Use this workflow guidance with current facility policy and applicable regulatory requirements. It does not make a legal or regulatory determination.",
  },
  {
    intent: "resident_operations",
    label: "Resident operations",
    contextLabel: "resident workflow",
    keywords: [
      "resident", "admission", "move in", "assessment", "support plan", "service", "refusal",
      "change of condition", "hospital", "appointment", "care delivery", "state form",
    ],
    routePrefixes: [
      "/app/residents", "/app/resident-compliance", "/app/state-forms", "/app/services",
      "/app/resident-care-delivery", "/app/admissions", "/app/change-of-condition",
      "/app/resident-services-calendar", "/me/services", "/me/change-of-condition",
      "/me/resident-services-calendar",
    ],
    answer: "Open the resident's active workflow, verify the assigned task and timing, and record observable facts, actions, notifications, and follow-up in the resident record.",
    roleGuidance: {
      employee: "Use My Services, My Change Follow-Ups, or the assigned services calendar to complete only the resident work assigned to you and escalate concerns to the appropriate supervisor.",
    },
    nextSteps: [
      "Confirm the resident and the active assessment, service, appointment, or follow-up.",
      "Record what occurred and any notification or exception required by policy.",
      "Escalate urgent changes and leave the workflow open until required follow-up is complete.",
    ],
    links: [
      { label: "Residents", href: "/app/residents", roles: REPORTING_ROLES },
      { label: "Resident care delivery", href: "/app/resident-care-delivery", roles: ["org_admin", "facility_manager", "auditor"] },
      { label: "My services", href: "/me/services", roles: ["employee"] },
      { label: "My change follow-ups", href: "/me/change-of-condition", roles: ["employee"] },
    ],
    followUpQuestions: [
      "Where do I record a missed or refused service?",
      "How do I document a change in condition?",
      "Where are resident state forms tracked?",
    ],
    suggestions: ["Where do I record a missed service?", "How do I document a change in condition?"],
    caution: "This guidance does not replace clinical judgment, provider direction, emergency procedures, or facility policy.",
  },
  {
    intent: "workforce_credentials",
    label: "Workforce and credentials",
    contextLabel: "workforce or credentialing workflow",
    keywords: [
      "employee", "staff", "credential", "clearance", "background check", "license", "expiration",
      "qualification", "onboarding", "exclusion screening", "workforce",
    ],
    routePrefixes: [
      "/app/employees", "/app/credentials", "/app/background-checks", "/app/exclusion-screening",
      "/app/administrator-qualification", "/app/workforce-operations", "/trainer/employees",
      "/me/credentials",
    ],
    answer: "Use the employee record and credentialing views together: confirm the person's role and facility, add the required credential or clearance, and resolve missing or expiring items before assigning restricted work.",
    roleGuidance: {
      employee: "Open My Credentials to review your own licenses, clearances, expiration dates, and any items that need an updated document.",
    },
    nextSteps: [
      "Confirm which qualification or clearance applies to the employee's role.",
      "Review the current status, source document, issue date, and expiration date.",
      "Assign an owner for renewal or follow-up and verify eligibility before restricted work.",
    ],
    links: [
      { label: "Employees", href: "/app/employees", roles: ["org_admin", "facility_manager", "auditor"] },
      { label: "Credentials and clearances", href: "/app/credentials", roles: REPORTING_ROLES },
      { label: "Background checks", href: "/app/background-checks", roles: REPORTING_ROLES },
      { label: "My credentials", href: "/me/credentials", roles: ["employee"] },
    ],
    followUpQuestions: [
      "Where can I see credentials expiring soon?",
      "How do I update an employee clearance?",
      "How does an employee review their own credentials?",
    ],
    suggestions: ["Which credentials are expiring soon?", "How do I update a clearance?"],
    caution: "Confirm qualification and clearance requirements against current policy before assigning restricted duties.",
  },
  {
    intent: "staffing",
    label: "Staffing and scheduling",
    contextLabel: "staffing or scheduling page",
    keywords: [
      "staffing", "schedule", "shift", "coverage", "open shift", "call off", "overtime", "ratio",
      "hours gap", "swap", "availability", "time off",
    ],
    routePrefixes: ["/app/schedule", "/app/workforce-operations", "/me/schedule", "/me/shift"],
    answer: "Review the coverage window, required roles, and employee eligibility before changing a shift. Resolve uncovered time with a qualified available employee and document any approval required by your organization.",
    roleGuidance: {
      employee: "Use My Schedule or My Shift to review assigned work, submit the available self-service action, and contact your manager when a coverage issue cannot be resolved there.",
    },
    nextSteps: [
      "Open the schedule for the affected facility and date range.",
      "Confirm the coverage gap, required qualification, and available staff.",
      "Save the approved assignment or request and recheck coverage totals.",
    ],
    links: [
      { label: "Organization schedule", href: "/app/schedule", roles: MANAGER_ROLES },
      { label: "Workforce operations", href: "/app/workforce-operations", roles: MANAGER_ROLES },
      { label: "My schedule", href: "/me/schedule", roles: ["employee"] },
      { label: "My shift", href: "/me/shift", roles: ["employee"] },
    ],
    followUpQuestions: [
      "How do I find a coverage gap?",
      "Where does an employee review their shifts?",
      "What should I check before assigning an open shift?",
    ],
    suggestions: ["How do I resolve a coverage gap?", "What should I check before assigning a shift?"],
    caution: "Verify required staffing levels, employee qualifications, availability, and approval rules before finalizing coverage.",
  },
  {
    intent: "documents_forms",
    label: "Documents and forms",
    contextLabel: "documents or forms page",
    keywords: [
      "document", "form", "upload", "policy", "procedure", "template", "dhs form", "pdf", "binder",
      "report", "packet", "signature", "attestation", "download",
    ],
    routePrefixes: [
      "/app/documents", "/app/policy-documents", "/app/template-documents", "/app/dhs-forms",
      "/app/compliance-binder", "/app/reports", "/app/state-forms", "/me/documents",
      "/me/attestations",
    ],
    answer: "Choose the workflow based on the document's purpose: resident or employee files for records, Policies for controlled procedures, Templates for reusable forms, and the DHS Forms Library for official state forms.",
    roleGuidance: {
      employee: "Use My Documents for files shared with you and My Attestations for policies that require your acknowledgement.",
    },
    nextSteps: [
      "Identify whether the item is a person-specific record, controlled policy, reusable template, or official state form.",
      "Open the matching library and confirm the version, owner, and effective or expiration date.",
      "Upload, complete, sign, or export the item from that workflow so its status remains traceable.",
    ],
    links: [
      { label: "Documents", href: "/app/documents", roles: MANAGEMENT_ROLES },
      { label: "Policies and procedures", href: "/app/policy-documents", roles: REPORTING_ROLES },
      { label: "Template documents", href: "/app/template-documents", roles: REPORTING_ROLES },
      { label: "DHS forms library", href: "/app/dhs-forms", roles: REPORTING_ROLES },
      { label: "My documents", href: "/me/documents", roles: ["employee"] },
      { label: "My attestations", href: "/me/attestations", roles: ["employee"] },
    ],
    followUpQuestions: [
      "Where should I upload this document?",
      "How do I find the current DHS form?",
      "What is the difference between a policy and a template?",
    ],
    suggestions: ["Where should I upload a document?", "How do I find the right state form?"],
    caution: "Use the current approved version and verify official forms against the issuing agency before use.",
  },
  {
    intent: "navigation",
    label: "Navigation",
    contextLabel: "current page",
    keywords: ["where", "find", "open", "go to", "navigate", "page", "menu", "sidebar", "dashboard"],
    routePrefixes: ["/app", "/trainer", "/me"],
    answer: "Tell me the task you are trying to complete rather than only the page name. I can point you to the relevant workflow and show only links available to your role.",
    nextSteps: [
      "Describe the record, task, or deadline you need to work on.",
      "Use one of the suggested links in the answer.",
      "If the page is not available for your role, ask a manager or administrator for the appropriate access or assistance.",
    ],
    links: [
      { label: "Organization dashboard", href: "/app", roles: ["org_admin", "facility_manager", "auditor"] },
      { label: "Trainer dashboard", href: "/trainer", roles: ["trainer"] },
      { label: "My dashboard", href: "/me", roles: ["employee"] },
    ],
    followUpQuestions: [
      "Where do I manage training?",
      "Where do I review compliance risks?",
      "Where do I find documents and forms?",
    ],
    suggestions: ["Where do I manage training?", "Where do I find documents and forms?"],
  },
  {
    intent: "support",
    label: "Support",
    contextLabel: "support workflow",
    keywords: ["support", "ticket", "problem", "error", "broken", "not working", "can't", "cannot", "help"],
    routePrefixes: ["/app/help", "/me/help"],
    answer: "Search the FAQs and job aides first. If the issue continues, submit a support ticket with the page, what you expected, what happened, and the steps that reproduce the problem.",
    nextSteps: [
      "Check the relevant FAQ or job aide for the workflow.",
      "Retry once and note the page, time, and exact message shown.",
      "Submit a ticket with those details and a screenshot or attachment when appropriate.",
    ],
    links: [{ label: "Help Center", href: "/app/help" }],
    followUpQuestions: [
      "What should I include in a support ticket?",
      "How do I find a page-specific job aide?",
      "Where can I review my existing tickets?",
    ],
    suggestions: ["What should I include in a support ticket?", "How do I find a job aide?"],
  },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "for", "how", "i", "in", "is", "it", "my", "of",
  "on", "the", "this", "to", "we", "what", "when", "where", "with",
]);

const VAGUE_QUESTIONS = new Set([
  "help", "help me", "i need help", "what do i do", "what should i do", "how does this work",
]);

function normalizedRoute(route: string | null | undefined): string {
  return (route?.match(/^([^?#]*)/)?.[1] ?? "").replace(/\/+$/, "") || "/";
}

function routeMatches(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(`${prefix}/`);
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenizeHelpQuestion(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !STOP_WORDS.has(token))
      .map(stem),
  )];
}

function entryRouteMatch(entry: KnowledgeEntry, route: string): boolean {
  return entry.routePrefixes.some((prefix) => routeMatches(route, prefix));
}

function scoreEntry(entry: KnowledgeEntry, question: string, tokens: string[], route: string): number {
  const normalizedQuestion = question.toLowerCase();
  const questionTokens = new Set(tokens);
  let score = entryRouteMatch(entry, route) ? 8 : 0;

  entry.keywords.forEach((keyword) => {
    const keywordTokens = tokenizeHelpQuestion(keyword);
    const matchingTokens = keywordTokens.filter((token) => questionTokens.has(token)).length;
    score += matchingTokens * 2;
    if (keyword.length > 3 && normalizedQuestion.includes(keyword)) score += 4;
  });

  return score;
}

function isVagueQuestion(question: string, tokens: string[]): boolean {
  const normalized = question.toLowerCase().trim().replace(/[?.!]+$/, "");
  return VAGUE_QUESTIONS.has(normalized) || tokens.length === 0;
}

function confidenceFor(score: number, vague: boolean): HelpCopilotConfidence {
  if (vague) return "low";
  if (score >= 12) return "high";
  if (score >= 5) return "medium";
  return "low";
}

function linksForRole(links: KnowledgeLink[], role: Role | undefined): HelpCopilotLink[] {
  if (!role) return [];
  return links.flatMap((link) => {
    if (link.roles && !link.roles.includes(role)) return [];
    const href = viewablePathForRole(link.href, role);
    return href ? [{ label: link.label, href }] : [];
  });
}

function fallbackEntry(route: string): KnowledgeEntry {
  return KNOWLEDGE_BASE.find((entry) => entry.intent === "navigation" && entryRouteMatch(entry, route))
    ?? KNOWLEDGE_BASE.find((entry) => entry.intent === "support")!;
}

export function getHelpCopilotAnswer(question: string, context: HelpCopilotContext = {}): HelpCopilotAnswer {
  const route = normalizedRoute(context.currentRoute);
  const tokens = tokenizeHelpQuestion(question);
  const vague = isVagueQuestion(question, tokens);
  const ranked = KNOWLEDGE_BASE
    .map((entry) => ({ entry, score: scoreEntry(entry, question, tokens, route) }))
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0]?.score > 0 ? ranked[0] : { entry: fallbackEntry(route), score: 0 };
  const routeAware = entryRouteMatch(selected.entry, route);
  const roleAnswer = context.role ? selected.entry.roleGuidance?.[context.role] : undefined;

  return {
    intent: selected.entry.intent,
    intentLabel: selected.entry.label,
    confidence: confidenceFor(selected.score, vague),
    answer: roleAnswer ?? selected.entry.answer,
    pageGuidance: routeAware
      ? `Because you opened Help from a ${selected.entry.contextLabel}, this answer prioritizes that workflow.`
      : undefined,
    nextSteps: selected.entry.nextSteps,
    links: linksForRole(selected.entry.links, context.role),
    followUpQuestions: selected.entry.followUpQuestions,
    caution: selected.entry.caution,
  };
}

export function getHelpCopilotPromptSuggestions(
  currentRoute: string | null | undefined,
  role?: Role,
): string[] {
  const route = normalizedRoute(currentRoute);
  const contextual = KNOWLEDGE_BASE
    .filter((entry) => entryRouteMatch(entry, route))
    .flatMap((entry) => entry.suggestions);
  const roleFallback = role === "employee"
    ? ["Where can I find my assigned training?", "How do I review my schedule?"]
    : ["What compliance work needs attention first?", "Where do I manage employee training?"];

  return [...new Set([...contextual, ...roleFallback])].slice(0, 3);
}
