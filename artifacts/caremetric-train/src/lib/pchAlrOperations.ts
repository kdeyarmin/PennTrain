import type { PchAlrOperationsQueueItem } from "./pchAlrOperationalSnapshot";

export type FacilityProgram = "PCH" | "ALR";
export type OperationsDomain =
  | "Regulatory crosswalk"
  | "Move-in readiness"
  | "Medication safety"
  | "Administrator qualification"
  | "Special care"
  | "Inspection day"
  | "Resident rights"
  | "Emergency preparedness"
  | "Daily operations"
  | "Citation-aware templates";

export interface PchAlrOperationsItem {
  id: string;
  domain: OperationsDomain;
  title: string;
  summary: string;
  citations: string[];
  programs: FacilityProgram[];
  evidenceSources: string[];
  route: string;
  owner: string;
  surveyPrompt: string;
  cadence: string;
}

export const PCH_ALR_OPERATIONS_ITEMS: PchAlrOperationsItem[] = [
  {
    id: "regulation-crosswalk",
    domain: "Regulatory crosswalk",
    title: "Chapter 2600/2800 citation-to-evidence crosswalk",
    summary: "Maps high-risk PCH/ALF obligations to the CareMetric Train modules that hold live proof, due dates, and binder artifacts.",
    citations: ["55 Pa. Code Ch. 2600", "55 Pa. Code Ch. 2800"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Inspection Readiness", "Compliance Binder", "Evidence Room", "Reports"],
    route: "/app/inspection-readiness",
    owner: "Administrator or compliance lead",
    surveyPrompt: "Show the current status and proof location for each requested citation topic.",
    cadence: "Review weekly during survey window and after every corrective action.",
  },
  {
    id: "move-in-packet",
    domain: "Move-in readiness",
    title: "Admission and move-in packet checklist",
    summary: "Coordinates resident admission, assessment/support-plan, rights, contract, designated-person, medication, signature, and copy-provided evidence.",
    citations: ["55 Pa. Code 2600.225", "55 Pa. Code 2600.227", "55 Pa. Code Ch. 2800 resident assessment/support plan"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Residents", "State Forms", "Resident Documents", "Resident Compliance Report"],
    route: "/app/state-forms",
    owner: "Admissions lead or resident records lead",
    surveyPrompt: "Open the resident packet and verify every admission/signature/state-form requirement is linked to signed evidence.",
    cadence: "At admission, after significant change, at annual review, and when the Department requests an update.",
  },
  {
    id: "medication-safety",
    domain: "Medication safety",
    title: "Medication event pattern and follow-up tracker",
    summary: "Turns med errors, refusals, adverse reactions, retraining, and corrective actions into a pattern view by resident, staff, shift, and facility.",
    citations: ["55 Pa. Code 2600.181", "55 Pa. Code Ch. 2600 medication records", "55 Pa. Code Ch. 2800 medication administration"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Who Can Pass Meds", "Incidents", "Practicums", "Competency Records", "Corrective Actions"],
    route: "/app/med-admin-roster",
    owner: "Medication lead",
    surveyPrompt: "Show repeated medication-event patterns and proof that follow-up/retraining closed the loop.",
    cadence: "Review daily for open events and monthly for patterns.",
  },
  {
    id: "administrator-rule-packs",
    domain: "Administrator qualification",
    title: "PCH/ALF administrator qualification rule packs",
    summary: "Separates PCH and ALF administrator expectations, including orientation, approved-course/test proof, continuing education, and coverage evidence.",
    citations: ["55 Pa. Code 2800.64", "55 Pa. Code Ch. 2600 administrator requirements"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Administrator Qualification", "Employee Credentials", "Training Matrix", "Compliance Binder"],
    route: "/app/administrator-qualification",
    owner: "Organization administrator",
    surveyPrompt: "Show administrator qualification, annual training, and backup coverage evidence for this licensed setting.",
    cadence: "Review at hire/designation, quarterly, and before license renewal/survey.",
  },
  {
    id: "special-care",
    domain: "Special care",
    title: "Dementia and special-care designation controls",
    summary: "Connects dementia/special-care unit designation to staff training, staffing coverage, policies, resident placement, and support-plan evidence.",
    citations: ["55 Pa. Code 2800.65", "55 Pa. Code Ch. 2800 special care/dementia-related obligations"],
    programs: ["ALR"],
    evidenceSources: ["Facilities", "Schedule", "Training Plans", "Policy Documents", "Resident Assessment Forms"],
    route: "/app/facilities",
    owner: "Facility administrator",
    surveyPrompt: "Show which units are special-care designated and which assigned staff/residents meet the additional controls.",
    cadence: "Review whenever units, resident placement, schedules, or training requirements change.",
  },
  {
    id: "inspection-day-package",
    domain: "Inspection day",
    title: "Inspection-day evidence package",
    summary: "Packages the entrance handoff, staff roster, resident roster, training, administrator, incident, medication, policy, and POC evidence into an expiring evidence-room collection.",
    citations: ["55 Pa. Code Ch. 2600", "55 Pa. Code Ch. 2800"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Evidence Room", "Compliance Binder", "Inspection Readiness", "Reports"],
    route: "/app/evidence",
    owner: "Binder owner",
    surveyPrompt: "Generate or open the current as-of inspection package and document every request in the handoff log.",
    cadence: "Prepare before survey window; refresh on entrance and when surveyors request new items.",
  },
  {
    id: "rights-grievances",
    domain: "Resident rights",
    title: "Resident rights, complaint, and grievance log",
    summary: "Tracks rights/complaint acknowledgements, ombudsman information, grievances, confidentiality, due dates, outcomes, and non-retaliation evidence.",
    citations: ["55 Pa. Code Ch. 2600 resident rights", "55 Pa. Code Ch. 2800 resident rights"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Residents", "Incidents & Complaints", "Confidential Reports", "Policy Documents"],
    route: "/app/incidents",
    owner: "Resident rights/grievance lead",
    surveyPrompt: "Show rights acknowledgement and the status/outcome of every grievance or complaint sample.",
    cadence: "Review on admission, upon complaint intake, and weekly until closure.",
  },
  {
    id: "emergency-preparedness",
    domain: "Emergency preparedness",
    title: "Emergency plan and drill compliance tracker",
    summary: "Surfaces emergency-plan review, fire drill coverage, evacuation observations, staff training, supply checks, and corrective follow-up.",
    citations: ["55 Pa. Code Ch. 2600 fire safety/emergency preparedness", "55 Pa. Code Ch. 2800 fire safety/emergency preparedness"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Inspections & Equipment", "Training Matrix", "Template Documents", "Compliance Binder"],
    route: "/app/inspections",
    owner: "Safety officer or administrator",
    surveyPrompt: "Show the latest emergency plan review, drill pattern, failed-drill follow-up, and staff training evidence.",
    cadence: "Review monthly and after every drill or emergency event.",
  },
  {
    id: "daily-ops",
    domain: "Daily operations",
    title: "72-hour facility operations queue",
    summary: "Combines staffing, resident deadlines, training due, medication follow-up, incidents, policy attestations, and inspection gaps into one manager queue.",
    citations: ["Operational risk control"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Dashboard", "Schedule", "Alerts", "Resident Compliance Report", "Inspection Readiness"],
    route: "/app",
    owner: "Facility manager",
    surveyPrompt: "Show how the facility prioritizes and owns near-term compliance work before it becomes overdue.",
    cadence: "Review every shift huddle and at the start of each business day.",
  },
  {
    id: "citation-aware-templates",
    domain: "Citation-aware templates",
    title: "Citation-aware policy and template library",
    summary: "Labels templates and policies by facility type, citation, review cadence, required audience, and binder destination.",
    citations: ["55 Pa. Code Ch. 2600", "55 Pa. Code Ch. 2800"],
    programs: ["PCH", "ALR"],
    evidenceSources: ["Template Documents", "Policy Documents", "Policy Attestations", "Compliance Binder"],
    route: "/app/template-documents",
    owner: "Policy owner",
    surveyPrompt: "Show which citation each template/policy supports and whether the current version is adopted and attested.",
    cadence: "Review annually, after regulatory change, and after every survey finding.",
  },
];

export function getPchAlrItemsByProgram(program: FacilityProgram): PchAlrOperationsItem[] {
  return PCH_ALR_OPERATIONS_ITEMS.filter((item) => item.programs.includes(program));
}

export function getPchAlrItemsByDomain(domain: OperationsDomain): PchAlrOperationsItem[] {
  return PCH_ALR_OPERATIONS_ITEMS.filter((item) => item.domain === domain);
}

export function searchPchAlrOperations(query: string): PchAlrOperationsItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return PCH_ALR_OPERATIONS_ITEMS;
  return PCH_ALR_OPERATIONS_ITEMS.filter((item) => [
    item.domain,
    item.title,
    item.summary,
    item.owner,
    item.surveyPrompt,
    item.cadence,
    ...item.citations,
    ...item.evidenceSources,
    ...item.programs,
  ].some((value) => value.toLowerCase().includes(normalized)));
}

export function buildInspectionDayChecklist(items: PchAlrOperationsItem[] = PCH_ALR_OPERATIONS_ITEMS): string[] {
  return items.map((item) => `${item.domain}: ${item.surveyPrompt}`);
}


export interface PchAlrEvidencePackageInput {
  facilityName: string;
  asOfDate: string;
  items?: PchAlrOperationsItem[];
  queue?: PchAlrOperationsQueueItem[];
}

export interface PchAlrEvidencePackageSection {
  id: string;
  heading: string;
  citations: string[];
  owner: string;
  cadence: string;
  evidenceSources: string[];
  route: string;
  openQueueCount: number;
  surveyPrompt: string;
}

const DOMAIN_TO_QUEUE_IDS: Partial<Record<OperationsDomain, string[]>> = {
  "Move-in readiness": ["move-in-readiness"],
  "Medication safety": ["medication-safety"],
  "Administrator qualification": ["daily-training"],
  "Special care": ["daily-training"],
  "Resident rights": ["incidents-rights", "policy-attestations"],
  "Emergency preparedness": ["corrective-actions", "daily-training"],
  "Daily operations": ["daily-training", "move-in-readiness", "medication-safety", "incidents-rights", "corrective-actions", "policy-attestations"],
  "Citation-aware templates": ["policy-attestations"],
};

function openCountForDomain(domain: OperationsDomain, queue: PchAlrOperationsQueueItem[]): number {
  const queueIds = DOMAIN_TO_QUEUE_IDS[domain] ?? [];
  return queue.filter((item) => queueIds.includes(item.id)).reduce((sum, item) => sum + item.count, 0);
}

export function buildPchAlrEvidencePackage(input: PchAlrEvidencePackageInput): PchAlrEvidencePackageSection[] {
  const queue = input.queue ?? [];
  return (input.items ?? PCH_ALR_OPERATIONS_ITEMS).map((item) => ({
    id: item.id,
    heading: `${input.facilityName} — ${item.title} (${input.asOfDate})`,
    citations: item.citations,
    owner: item.owner,
    cadence: item.cadence,
    evidenceSources: item.evidenceSources,
    route: item.route,
    openQueueCount: openCountForDomain(item.domain, queue),
    surveyPrompt: item.surveyPrompt,
  }));
}

export function evidencePackageToText(sections: PchAlrEvidencePackageSection[]): string {
  return sections.map((section) => [
    section.heading,
    `Citations: ${section.citations.join(", ")}`,
    `Owner: ${section.owner}`,
    `Cadence: ${section.cadence}`,
    `Open queue count: ${section.openQueueCount}`,
    `Evidence sources: ${section.evidenceSources.join("; ")}`,
    `Workflow: ${section.route}`,
    `Survey prompt: ${section.surveyPrompt}`,
  ].join("\n")).join("\n\n---\n\n");
}

export function evidencePackageToCsv(sections: PchAlrEvidencePackageSection[]): string {
  const rows = [["section", "citations", "owner", "cadence", "open_queue_count", "evidence_sources", "route", "survey_prompt"]];
  for (const section of sections) {
    rows.push([
      section.heading,
      section.citations.join("; "),
      section.owner,
      section.cadence,
      String(section.openQueueCount),
      section.evidenceSources.join("; "),
      section.route,
      section.surveyPrompt,
    ]);
  }
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}
