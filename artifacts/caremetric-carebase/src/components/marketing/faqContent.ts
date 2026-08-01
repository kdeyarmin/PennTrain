/**
 * FAQ content for the marketing FAQ page and its FAQPage structured data.
 *
 * Kept dependency-free (pure strings, no icon imports) so the build-time
 * prerender script (server/prerender-heads.mjs) can bundle it for Node and
 * bake the same FAQPage JSON-LD into the raw /faq HTML that Faq.tsx builds at
 * runtime. App code should keep importing FAQS from "./content", which
 * re-exports this module.
 */
import { marketingPricingFaqAnswer } from "./marketingPricing";

export const FAQ_CATEGORIES = [
  "Product & replacement",
  "Compliance boundaries",
  "Training & daily operations",
  "Access & security",
  "The questions owners actually ask",
  "Getting started",
] as const;

export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export type MarketingFaq = {
  category: FaqCategory;
  question: string;
  answer: string;
  links?: { label: string; href: string }[];
};

export const FAQS: MarketingFaq[] = [
  {
    category: "Product & replacement",
    question: "What is CareMetric CareBase?",
    answer:
      "An operations, staff-compliance, and survey-readiness platform built first for Pennsylvania personal care homes and assisted living facilities. It connects training, credentials, resident operations, clinical charting, incidents, inspections, scheduling, documents, and documentation in one system, with each role seeing only what it should. The resident clinical record includes native charting plus FHIR integration for externally-sourced medications, allergies, and diagnoses.",
  },
  {
    category: "Product & replacement",
    question: "What can it replace?",
    answer:
      "Depending on how you work today: a training LMS, training and credential spreadsheets, shared-drive compliance folders, paper survey binders, assessment due-date calendars, basic staff scheduling, admissions and census trackers, incident and POC logs, policy acknowledgment tools, work-order sheets, QAPI workbooks, basic resident receivable ledgers, and fragmented clinical note-taking that never lined up with compliance.",
  },
  {
    category: "Product & replacement",
    question: "What does it not replace?",
    answer:
      "Your pharmacy platform or eMAR and your EHR — CareBase integrates with these via FHIR to pull in medications, allergies, and diagnoses read-only — plus payroll and timeclock, HRIS, accounting general ledger, claims or billing system, emergency-call system, and any accredited external training provider your rules still require. CareBase connects to or works alongside them.",
  },
  {
    category: "Product & replacement",
    question: "How much does it cost?",
    answer: marketingPricingFaqAnswer(),
    links: [
      { label: "See pricing", href: "/#pricing" },
      { label: "model your savings", href: "/savings" },
    ],
  },
  {
    category: "Product & replacement",
    question: "Where do the savings come from?",
    answer:
      "Less double entry and cross-checking, tools you no longer need, auto-filled schedules, bulk roster import, automatic reminders, one work queue, and reports generated from live records. We don't promise a set percentage — the savings worksheet uses your own numbers and leaves out savings from avoided risk.",
  },
  {
    category: "Compliance boundaries",
    question: "Which regulations does it help with?",
    answer:
      "Anchored to 55 Pa. Code Chapters 2600 (PCH) and 2800 (ALF): staff orientation and annual training, resident assessments and support plans, administrator qualifications, medication practicums, fire drills, incidents, resident rights, and survey documentation. The training catalog also supports Chapter 6400 and federal aide in-service pathways. It tracks and preserves documentation — it doesn't replace legal advice or official DHS forms.",
  },
  {
    category: "Compliance boundaries",
    question: "Does it guarantee compliance or a deficiency-free survey?",
    answer:
      "No. CareBase makes requirements, deadlines, ownership, and documentation visible so your team can close gaps before review. Outcomes still depend on accurate configuration, qualified staff, truthful documentation, and management follow-through.",
  },
  {
    category: "Compliance boundaries",
    question: "How many annual training hours does my provider type need?",
    answer:
      "It depends on license type, role, and population served — 12 hours for PCH direct care workers, 16 for ALF, 24/12 for Chapter 6400, 12 for nurse, home health, and hospice aides. See the full PA training requirements guide.",
    links: [{ label: "PA training requirements guide", href: "/pa-training-requirements" }],
  },
  {
    category: "Compliance boundaries",
    question: "Does it track resident-level compliance, not just staff?",
    answer:
      "Yes, for PCH and ALF: RASP/ASP preadmission screening, the initial assessment (due 15 days after admission for a personal care home; normally completed 30 days before admission for an assisted living facility), annual and significant-change reassessments, and support-plan updates — each on its own due date. The signed, DHS-prescribed form on file is still what closes the requirement.",
  },
  {
    category: "Training & daily operations",
    question: "How does it track yearly in-service hours?",
    answer:
      "Every employee gets a training plan built from the hours, topics, and renewal windows your facility requires. Assigned training, live classes, and outside records all log hours automatically, and anyone falling behind is flagged before their deadline.",
  },
  {
    category: "Training & daily operations",
    question: "Do you support in-person, instructor-led training?",
    answer:
      "Yes. Trainers schedule live classes and capture attendance with a rotating QR code, a shared-device kiosk mode, or a printed sign-in sheet — sessions count toward in-service hours alongside assigned items.",
  },
  {
    category: "Training & daily operations",
    question: "Who reviews AI-generated training content?",
    answer:
      "A named human reviewer, every time. Drafts are grounded in your own source documents, the model flags gaps instead of inventing citations, and nothing publishes without explicit sign-off — which resets if any block is regenerated.",
  },
  {
    category: "Training & daily operations",
    question: "What is the compliance copilot?",
    answer:
      "A grounded, read-only assistant that answers plain questions from your facility's own records and governed rule versions — with source, effective date, and citation on every answer. It can draft a Plan of Correction or mock-survey request, but a person must confirm before anything is approved or submitted. It never invents a citation or closes a finding on its own.",
    links: [{ label: "See the copilot on Features", href: "/features#compliance-copilot" }],
  },
  {
    category: "Training & daily operations",
    question: "How are incidents, violations, and plans of correction handled?",
    answer:
      "Logging a reportable incident schedules the required notifications — state hotline, law enforcement, licensing — each with its own due-by clock, and generates a formatted report PDF. Confidential pathways and a public safety-reporting route cover sensitive events. DHS-cited violations track against their citation and POC due date through Corrected and Verified.",
  },
  {
    category: "Training & daily operations",
    question: "Can it schedule staff shifts too?",
    answer:
      "Yes. Set up each facility's units and shift types, capture each employee's typical pattern, auto-fill a draft schedule, and publish it to My Schedule. Float staff can work multiple facilities but never double-book across the organization.",
  },
  {
    category: "Training & daily operations",
    question: "Do you screen against background-check and exclusion requirements?",
    answer:
      "Yes. OAPSA provisional-employment countdowns for new hires, Act 34/73/33 clearance tracking, and automatic monthly screening of every active employee against the OIG exclusion list (and SAM.gov when configured) — fuzzy matches go to a human review queue.",
  },
  {
    category: "Training & daily operations",
    question: "Does CareBase keep a resident clinical record?",
    answer:
      "Yes. CareBase includes native charting — vitals, progress notes, assessments, and care plans — plus FHIR integration that syncs medications, allergies, and diagnoses from external clinical systems. Medication administration stays in your pharmacy eMAR; CareBase ingests those events read-only so the chart and compliance picture stay aligned.",
  },
  {
    category: "Access & security",
    question: "Can one organization manage multiple facilities?",
    answer:
      "Yes — multi-facility from the ground up. Org admins see every facility; facility managers see only their assigned sites. Reports respect the same scoping. Portfolio plans add guided multi-site rollout and reporting for larger operators.",
  },
  {
    category: "Access & security",
    question: "Can our auditor or surveyor get read-only access?",
    answer:
      "Yes. The auditor role sees dashboards, the training matrix, reports, and documents with zero ability to edit — plus time-limited documentation rooms scoped to exactly what was requested. More on the security page.",
    links: [{ label: "security page", href: "/security" }],
  },
  {
    category: "Access & security",
    question: "Do employees need to install anything?",
    answer:
      "No. CareBase runs in the browser on any device; the employee training player can also install to a phone's home screen as a lightweight app — no app store required — and supports offline completion when connectivity is limited.",
  },
  {
    category: "Access & security",
    question: "Can staff get text or email reminders?",
    answer:
      "Yes — due-soon and expired alerts by email and (once enabled) text, unresolved alerts escalate to admins, plus a weekly digest and a delivery log so you can confirm a reminder actually went out.",
  },
  {
    category: "Access & security",
    question: "Are there guest portals for families and admissions?",
    answer:
      "Yes. Time-limited guest links cover move-in packages, resident-agreement signing, designated-person access, and documentation-room review — each scoped to exactly what you share, without creating a full user account.",
  },
  {
    category: "The questions owners actually ask",
    question: "What happens during an actual survey?",
    answer:
      "You switch the facility into Survey Day Mode: one screen pins the entrance-conference checklist and live readiness, your latest binder, who's on shift with training and clearance flags, and the documentation rooms you prepared. Hand the surveyor a read-only auditor login or a printed binder generated that morning, and answer document requests from live records. Anything cited goes straight into the plan-of-correction workflow with its due date.",
    links: [{ label: "Survey Day Mode on Features", href: "/features#survey-readiness" }],
  },
  {
    category: "The questions owners actually ask",
    question: "What if my administrator quits?",
    answer:
      "The compliance picture doesn't leave with them. Requirements, deadlines, documentation, and history live in the record — a new administrator inherits a working system on day one instead of deciphering a predecessor's spreadsheet.",
  },
  {
    category: "The questions owners actually ask",
    question: "Can I cancel and keep my records?",
    answer:
      "Yes. Your organization owns its data. If you cancel, you export everything during the wind-down window — your records are yours to keep.",
  },
  {
    category: "The questions owners actually ask",
    question: "My aides aren't tech people. Will they use it?",
    answer:
      "They scan a QR code with their own phone to sign into class, and their training player installs to a home screen like any app — no passwords to remember for kiosk check-in, no app store, no IT department.",
  },
  {
    category: "Getting started",
    question: "Can a new organization start immediately?",
    answer:
      "Yes. Self-serve signup creates your organization with a name, admin contact, and password — no sales call — and you can start entering employees and records the same day under the free trial. Prefer to click around first? Open the live demo sandbox with sample PA facility data.",
    links: [
      { label: "Start free trial", href: "/signup" },
      { label: "Explore live demo", href: "/demo" },
    ],
  },
  {
    category: "Getting started",
    question: "Can we bring over our existing roster?",
    answer:
      "Yes — bulk CSV import onboards an entire facility's staff in minutes instead of one-by-one entry.",
  },
];
