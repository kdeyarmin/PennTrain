export interface CarebaseGlossaryRoute {
  label: string;
  href: string;
}

export interface CarebaseGlossaryTerm {
  term: string;
  category: "Workflow" | "Compliance" | "People" | "Training" | "Security" | "Operations";
  definition: string;
  relatedRoutes: CarebaseGlossaryRoute[];
}

export const CAREBASE_GLOSSARY_TERMS: CarebaseGlossaryTerm[] = [
  {
    term: "Work item",
    category: "Workflow",
    definition: "An actionable queue entry that asks a user to review, complete, assign, or resolve a specific operational or compliance task.",
    relatedRoutes: [{ label: "Work Queue", href: "/app/work" }],
  },
  {
    term: "Task",
    category: "Workflow",
    definition: "A concrete piece of work assigned to a role or person, often represented as a work item when it needs attention in CareBase.",
    relatedRoutes: [{ label: "Today", href: "/app/today" }, { label: "Work Queue", href: "/app/work" }],
  },
  {
    term: "Alert",
    category: "Workflow",
    definition: "A high-visibility signal that something needs timely attention, such as a failed background job, overdue compliance activity, or uncovered shift.",
    relatedRoutes: [{ label: "Today", href: "/app/today" }, { label: "System Jobs", href: "/admin/system-jobs" }],
  },
  {
    term: "Incident",
    category: "Compliance",
    definition: "A recorded resident, staff, safety, or operational event that may require investigation, follow-up, documentation, and trend review.",
    relatedRoutes: [{ label: "Incidents", href: "/app/incidents" }],
  },
  {
    term: "Complaint",
    category: "Compliance",
    definition: "A concern submitted by a resident, family member, staff member, or other stakeholder that requires intake, response, and resolution tracking.",
    relatedRoutes: [{ label: "Complaints", href: "/app/complaints" }],
  },
  {
    term: "Violation",
    category: "Compliance",
    definition: "A compliance finding or regulatory deficiency that must be tracked, remediated, and supported with documentation.",
    relatedRoutes: [{ label: "Compliance", href: "/app/compliance" }],
  },
  {
    term: "Plan of correction",
    category: "Compliance",
    definition: "The documented remediation plan that explains how a deficiency or violation will be corrected and prevented from recurring.",
    relatedRoutes: [{ label: "Compliance", href: "/app/compliance" }],
  },
  {
    term: "Documentation",
    category: "Compliance",
    definition: "A file, note, attestation, training record, or other artifact used to prove that a requirement was met or an issue was corrected.",
    relatedRoutes: [{ label: "Compliance Binder", href: "/app/compliance-binder" }],
  },
  {
    term: "Compliance binder",
    category: "Compliance",
    definition: "The organized collection of documentation, policies, reports, and exports used to support survey readiness and audits.",
    relatedRoutes: [{ label: "Compliance Binder", href: "/app/compliance-binder" }],
  },
  {
    term: "Audit log",
    category: "Security",
    definition: "A chronological record of sensitive actions and system events used for accountability, troubleshooting, and compliance review.",
    relatedRoutes: [{ label: "Audit Log", href: "/admin/audit" }],
  },
  {
    term: "Attestation",
    category: "Compliance",
    definition: "A user confirmation that a required review, policy acknowledgment, or compliance action has been completed truthfully.",
    relatedRoutes: [{ label: "Compliance", href: "/app/compliance" }],
  },
  {
    term: "Credential",
    category: "People",
    definition: "A license, certification, or qualification attached to a staff member that may expire and affect readiness for assigned work.",
    relatedRoutes: [{ label: "Credentials", href: "/app/credentials" }, { label: "Employees", href: "/app/employees" }],
  },
  {
    term: "Training record",
    category: "Training",
    definition: "Proof that an employee completed required learning, course work, or a competency activity.",
    relatedRoutes: [{ label: "Training", href: "/app/training-matrix" }],
  },
  {
    term: "Course assignment",
    category: "Training",
    definition: "A required learning activity assigned to an employee or group with completion status and due-date expectations.",
    relatedRoutes: [{ label: "Courses", href: "/app/courses" }],
  },
  {
    term: "Facility",
    category: "Operations",
    definition: "A care location or operating site within an organization where residents, staff, schedules, and compliance work are managed.",
    relatedRoutes: [{ label: "Facilities", href: "/app/facilities" }],
  },
  {
    term: "Resident",
    category: "Operations",
    definition: "A person receiving care whose profile, support needs, documents, family access, and incidents may be managed in CareBase.",
    relatedRoutes: [{ label: "Residents", href: "/app/residents" }],
  },
  {
    term: "Support plan",
    category: "Operations",
    definition: "A care or service plan that documents resident needs, goals, responsibilities, and review expectations.",
    relatedRoutes: [{ label: "Residents", href: "/app/residents" }],
  },
  {
    term: "QAPI",
    category: "Compliance",
    definition: "Quality Assurance and Performance Improvement activities used to identify trends, improve care processes, and document follow-through.",
    relatedRoutes: [{ label: "QAPI", href: "/app/qapi" }],
  },
  {
    term: "Survey Day",
    category: "Compliance",
    definition: "A readiness view focused on records, documentation, tasks, and exports that are commonly needed during a regulatory survey.",
    relatedRoutes: [{ label: "Survey Day", href: "/app/survey-day" }],
  },
  {
    term: "Guest access",
    category: "Security",
    definition: "A limited public or external access flow that lets a guest use a specific tokenized workflow without receiving ordinary staff access.",
    relatedRoutes: [{ label: "Family Portal", href: "/resident-portal" }, { label: "Guest Documentation", href: "/evidence-access" }],
  },
  {
    term: "Public token",
    category: "Security",
    definition: "A time-limited access token used by selected guest workflows; it should be scoped, auditable, and scrubbed from browser history after use.",
    relatedRoutes: [{ label: "Guest Documentation", href: "/evidence-access" }],
  },
];

export function searchCarebaseGlossary(query: string): CarebaseGlossaryTerm[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return CAREBASE_GLOSSARY_TERMS;

  return CAREBASE_GLOSSARY_TERMS.filter((entry) => {
    const routeText = entry.relatedRoutes.map((route) => `${route.label} ${route.href}`).join(" ");
    return [entry.term, entry.category, entry.definition, routeText]
      .some((value) => value.toLowerCase().includes(normalized));
  });
}
