import {
  ShieldCheck,
  GraduationCap,
  FileCheck,
  ClipboardCheck,
  BellRing,
  FileStack,
  Users,
  UploadCloud,
  Building2,
  HeartHandshake,
  HomeIcon,
  Stethoscope,
  Accessibility,
  BedDouble,
  Database,
  Lock,
  History,
  CalendarCheck,
  ListChecks,
  BarChart3,
  FolderLock,
  SlidersHorizontal,
  LayoutGrid,
  Sparkles,
  Video,
  RefreshCw,
  QrCode,
  Printer,
  FilePenLine,
  GitBranch,
  ClipboardList,
  Gauge,
  Siren,
  ShieldAlert,
  Flame,
  Library,
  BadgeCheck,
  ShieldQuestion,
  Award,
  Pill,
  FileSignature,
  CalendarClock,
  Shuffle,
  MailPlus,
  Rocket,
  Smartphone,
  UserCheck,
  Eye,
  Fingerprint,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

/**
 * Marketing content shared across the public landing page and the dedicated
 * topic pages (Features, Who It's For, Security, How It Works, FAQ). Keeping
 * it in one module means the landing-page teasers and the full pages never
 * drift out of sync.
 */

/** mailto used by every "Request a Demo" affordance across the marketing site. */
export const DEMO_MAILTO =
  "mailto:hello@caremetric.ai?subject=CareMetric%20CareBase%20Demo%20Request";

export type IconItem = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export const SETTINGS: IconItem[] = [
  {
    icon: Building2,
    title: "Personal Care Homes",
    description:
      "12 hours of yearly in-service per direct care worker (up to 6 may be supervised on-the-job training) under 55 Pa. Code Section 2600.65, plus 6 more for staff on a secured dementia unit under Section 2600.236 — tracked per employee, with regulatory credit applied once the operator verifies each completion. Also includes Resident Assessment and Support Plan (RASP) tracking under Section 2600.225/.227.",
  },
  {
    icon: HeartHandshake,
    title: "Assisted Living Facilities",
    description:
      "16 hours of yearly in-service per direct care worker, plus 4 hours of dementia-specific training within 30 days of hire and 2 hours every year after — 55 Pa. Code Section 2800.65/.69, tracked as separate requirements. Also includes Assessment and Support Plan (ASP) tracking, with an expedited track for hospital transfers and other DHS-recognized exceptions.",
  },
  {
    icon: Accessibility,
    title: "Group Homes",
    description:
      "24 hours of yearly training for direct service workers, their supervisors, and program specialists, and 12 hours for most other staff roles per the Section 6400.52(b) role list — 55 Pa. Code Section 6400.52, each role's requirement tracked separately.",
  },
  {
    icon: BedDouble,
    title: "Nursing Homes",
    description:
      "12 hours of yearly in-service per nurse aide under federal OBRA rules (42 CFR 483.95), targeted to each employee's most recent performance review — not just a generic annual class.",
  },
  {
    icon: HomeIcon,
    title: "Home Health Agencies",
    description:
      "12 hours of yearly in-service per home health aide, RN-supervised and documented under 42 CFR 484.80 — tracked across your whole field staff.",
  },
  {
    icon: Stethoscope,
    title: "Hospice Agencies",
    description:
      "12 hours of yearly in-service per hospice aide, RN-supervised and documented under 42 CFR 418.76, with a complete aide curriculum built in.",
  },
];

export type FeatureCategory = {
  /** Stable, URL-safe id for deep-linking (e.g. /features#resident-care). */
  id: string;
  category: string;
  blurb: string;
  items: IconItem[];
};

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    id: "training-compliance",
    category: "Facility Compliance & Training Core",
    blurb: "The system of record for staff requirements, facility evidence, and survey-ready training proof.",
    items: [
      {
        icon: ShieldCheck,
        title: "Compliance Tracking",
        description:
          "Yearly in-services, credentials, medication practicums, resident-facing staff requirements, and facility evidence in one system of record, with automatic alerts before anything lapses.",
      },
      {
        icon: GraduationCap,
        title: "Built-in Course Builder",
        description:
          "Author required training content, quizzes with server-side grading, and certificates inside the same facility operations workflow.",
      },
      {
        icon: ClipboardCheck,
        title: "Competency Checklists",
        description:
          "Configurable competency templates and training plans so every staff role gets the right facility requirements automatically.",
      },
      {
        icon: ListChecks,
        title: "Training Plans, Built Per Role",
        description:
          "Assign the right plan to each role once — or roll it out to an entire facility roster in a single action — and CareMetric CareBase tracks every employee's progress against it automatically.",
      },
      {
        icon: SlidersHorizontal,
        title: "Custom Requirement Catalog",
        description:
          "Beyond the built-in Pennsylvania training types, org admins can define their own — scoped to a specific facility type or all of them — with its own required hours, renewal interval, warning window, evidence-document requirement, and regulatory citation.",
      },
      {
        icon: LayoutGrid,
        title: "Interactive Compliance Matrix",
        description:
          "A color-coded grid of every active employee against every applicable requirement, filterable by facility, status, or due-date window, with click-to-edit records and a one-click CSV export.",
      },
      {
        icon: BarChart3,
        title: "Compliance Reporting Center",
        description:
          "Roll up staff compliance, certifications, practicums, and facility evidence by facility, requirement type, or employee — scoped to what each role is allowed to see.",
      },
      {
        icon: FolderLock,
        title: "Audit-Ready Document Storage",
        description:
          "Training documents, sign-in sheets, and competency attachments live in private storage, accessed only through short-lived signed links tied to the employee and facility they belong to.",
      },
    ],
  },
  {
    id: "ai-course-creation",
    category: "AI-Powered Course Creation",
    blurb: "Draft a complete course from your own source material, then attach an AI presenter video — reviewed by a real person before anyone sees it.",
    items: [
      {
        icon: Sparkles,
        title: "AI Course Curriculum Generation",
        description:
          "Paste in a regulation, policy, or reference document and get a complete draft course back — modules, lesson text or video scripts, and knowledge-check quizzes with answer keys — grounded strictly in that source material. The model is instructed to flag gaps rather than invent a regulation citation it can't verify.",
      },
      {
        icon: Video,
        title: "AI Avatar Video Generation",
        description:
          "Turn a lesson script into a talking-avatar training video instead of recording your own footage — pick an avatar and voice, and CareMetric CareBase submits the job, tracks it to completion, and hosts the finished video in your organization's private storage.",
      },
      {
        icon: RefreshCw,
        title: "Targeted AI Content Regeneration",
        description:
          "Don't like a single lesson, video script, or quiz question set? Point at just that block, describe what to change, and AI rewrites it alone — under the same no-fabricated-citation rules as the initial draft.",
      },
    ],
  },
  {
    id: "live-classes",
    category: "Live Classes & Attendance",
    blurb: "Instructor-led sessions count toward compliance without a paper sign-in sheet to reconcile later.",
    items: [
      {
        icon: CalendarCheck,
        title: "Live Class Scheduling & Sign-In",
        description:
          "Trainers schedule instructor-led classes and capture digital attendee sign-in, so in-person sessions count toward compliance right alongside assigned training items.",
      },
      {
        icon: QrCode,
        title: "QR & Kiosk Check-In",
        description:
          "Each class shows a QR code that rotates every 30 seconds for staff to scan with their own phone, or runs in a shared-device Kiosk Mode where an employee finds their name and enters a personal PIN — no app to install either way.",
      },
      {
        icon: Printer,
        title: "Printable Meeting Notice",
        description:
          "Generate a one-page PDF with the class details and an embedded QR code staff can scan to check in, plus a paper sign-in table as backup for anyone who can't scan — post it, hand it out, or upload the completed sheet back into the class record.",
      },
    ],
  },
  {
    id: "resident-care",
    category: "Resident Care Compliance",
    blurb: "For personal care homes and assisted living facilities: resident-level regulatory tracking, not just staff requirements.",
    items: [
      {
        icon: FilePenLine,
        title: "Digital RASP/ASP Assessment Prep",
        description:
          "Draft the resident assessment on-screen — every ADL, sensory, and behavioral item, mirroring the DHS RASP/ASP structure — with autosaving drafts and a reference PDF on finalize. The signed, DHS-prescribed RASP/ASP form is still what satisfies 55 Pa. Code Section 2600.225/.227 and the parallel Chapter 2800 clause — attach it on the resident's record to close out the requirement.",
      },
      {
        icon: GitBranch,
        title: "Automatic Reassessment & Support-Plan Triggers",
        description:
          "Preadmission screening, the initial assessment (due 15 days after admission for personal care homes; normally 30 days before admission for assisted living facilities), annual reassessment, and any significant-change reassessment are each tracked to their own due date — and completing a reassessment automatically opens the support-plan update it requires.",
      },
      {
        icon: ClipboardList,
        title: "Facility-Wide Resident Compliance Dashboard",
        description:
          "One filterable view lists every resident's assessment status across every facility in the organization, so a facility manager or org admin can see what's due, expired, or missing without opening each resident record individually.",
      },
    ],
  },
  {
    id: "resident-operations",
    category: "Resident Operations & Admissions",
    blurb: "The non-clinical operating workflows a PCH or ALF runs around every resident, from inquiry through discharge.",
    items: [
      {
        icon: BedDouble,
        title: "Admissions, Census & Room Readiness",
        description:
          "Track prospects, preadmission requirements, move-in workspaces, room availability, occupancy, resident agreements, and the current census without maintaining separate intake and bed-list spreadsheets.",
      },
      {
        icon: HeartHandshake,
        title: "Resident Services & Daily Work",
        description:
          "Turn support-plan service requirements into assigned work, record completed, refused, missed, or escalated services, and keep the exception history connected to the resident and responsible staff member.",
      },
      {
        icon: RefreshCw,
        title: "Change-of-Condition Follow-Up",
        description:
          "Route falls, hospital returns, and other resident changes through observation, provider notification, reassessment, support-plan review, and documented follow-up instead of relying on an informal handoff.",
      },
      {
        icon: ListChecks,
        title: "Dietary & Food-Safety Operations",
        description:
          "Keep diets, allergies, texture and hydration needs, meal-intake and weight monitoring, menu reviews, temperatures, and sanitation rounds in one PCH/ALF workspace.",
      },
      {
        icon: CalendarClock,
        title: "Resident Services Calendar",
        description:
          "Coordinate medical, dental, behavioral-health, laboratory, therapy, transportation, family-visit, and activity commitments with driver, vehicle, escort, and return-instruction tracking.",
      },
      {
        icon: FilePenLine,
        title: "Resident Financial Operations",
        description:
          "Version rate agreements, post resident charges, payments, credits, refunds, and linked adjustments, issue statements, track personal funds, and export receivable data for accounting. It is an operational subledger, not a general ledger or claims system.",
      },
      {
        icon: Pill,
        title: "Medication Event Integration",
        description:
          "Bring held, refused, missed, and other medication events from an external medication source into review and follow-up workflows. CareBase does not replace the eMAR or pharmacy system used to administer medications.",
      },
    ],
  },
  {
    id: "survey-readiness",
    category: "Survey & Incident Readiness",
    blurb: "Everything an inspector asks for at the entrance conference, ready before they ask.",
    items: [
      {
        icon: FileStack,
        title: "One-Click Compliance Binder",
        description:
          "Request a real compliance binder PDF for one facility or the full organization. CareBase rebuilds it from live training, credential, practicum, incident, inspection, policy, resident, and readiness data in the background, then delivers it through a short-lived secure link.",
      },
      {
        icon: Gauge,
        title: "Weighted Survey Readiness Score",
        description:
          "A live, per-facility readiness score rolls training, credentials, background checks, inspections, incidents, and policy attestations into one number. Topics are weighted toward the areas DHS most commonly cites — configurable planning weights, not a live citation feed — so the areas most worth your attention surface first.",
      },
      {
        icon: Siren,
        title: "Incident & Complaint Tracking",
        description:
          "Log reportable incidents with severity and status, and CareMetric CareBase schedules the required regulatory notifications — state hotline, law enforcement, licensing agency — each with its own due-by clock. One click generates a formatted incident report PDF with the narrative, investigation findings, and notification log.",
      },
      {
        icon: ShieldAlert,
        title: "Violation & Plan-of-Correction Workflow",
        description:
          "Record a DHS-cited violation against its specific citation and due date, attach evidence for the follow-up visit, and generate a formatted Plan of Correction PDF — status moves through Open, POC Submitted, Corrected, and Verified as the case closes out.",
      },
      {
        icon: Flame,
        title: "Life-Safety & Fire-Drill Records",
        description:
          "Track inspection cadence for fire extinguishers, alarms, sprinklers, generators, and emergency lighting, and log every field 55 Pa. Code Section 2600.132/2800.132 requires for a fire drill — shift, exit route, evacuation duration, and the twice-yearly sleeping-hours drill.",
      },
      {
        icon: Library,
        title: "Template Document Library",
        description:
          "A built-in library of 60+ printable survey-readiness forms — entrance handoff packets, resident chart and medication audits, training trackers, and walkthrough logs — adapted from a real PA Personal Care Home Survey Readiness Binder and organized into searchable categories.",
      },
    ],
  },
  {
    id: "facility-operations",
    category: "Facility Operations, Quality & Evidence",
    blurb: "The operational controls that turn inspections, safety events, complaints, repairs, and improvement work into accountable evidence.",
    items: [
      {
        icon: Siren,
        title: "Emergency Operations",
        description:
          "Manage emergency events, resident and staff accountability, evacuation or relocation, outages, generator fuel, mass notifications, and after-action follow-up from one facility workspace.",
      },
      {
        icon: SlidersHorizontal,
        title: "Maintenance & Work Orders",
        description:
          "Open preventive or corrective work orders, record safety risk, protective action, vendor, parts, cost, downtime, and repair evidence, then require supervisor verification before the issue is treated as closed.",
      },
      {
        icon: ShieldAlert,
        title: "Complaints, Grievances & Resident Rights",
        description:
          "Track complaints and grievances through intake, ombudsman or agency notification, investigation, nonretaliation safeguards, response, appeal, and closure while keeping sensitive reports appropriately scoped.",
      },
      {
        icon: BarChart3,
        title: "QAPI & Quality Improvement",
        description:
          "Run quality assurance and performance improvement (QAPI) projects with a defined problem, root-cause analysis, measures, audit samples, interventions, ownership, and sustainment review instead of a standalone workbook.",
      },
      {
        icon: ClipboardList,
        title: "Closed-Loop Work Queue",
        description:
          "Assign remediation and operational tasks with owners, deadlines, dependencies, approvals, and evidence so a dashboard warning becomes completed work rather than another unresolved alert.",
      },
      {
        icon: FolderLock,
        title: "Evidence Rooms & Regulatory Crosswalk",
        description:
          "Map Chapter 2600 and 2800 requirements to the records that prove them, assemble controlled evidence collections, and share a time-limited read-only room without granting an external reviewer application access.",
      },
    ],
  },
  {
    id: "credentials-screening",
    category: "Credentials, Screening & Medication",
    blurb: "Everything that has to be true about a person before they can work unsupervised or pass medications.",
    items: [
      {
        icon: BadgeCheck,
        title: "Credentials & Clearances Tracking",
        description:
          "Tracks background clearances and professional licensure separately from training records — Act 34 criminal history, Act 73 FBI fingerprint, and Act 33 child abuse clearances, RN/LPN licenses, PA Nurse Aide Registry status, TB screening, and I-9 eligibility — each with its own expiration, verification method, and evidence document.",
      },
      {
        icon: ShieldQuestion,
        title: "Background-Check & Suitability Tracking",
        description:
          "Runs the Older Adults Protective Services Act (OAPSA) provisional-employment countdown — 30 days for PA residents, 90 for non-residents, configurable per organization — alongside the required non-disqualification statement, documented supervision, and a final suitability determination, and flags when a new hire's residency history requires an Act 73 FBI clearance.",
      },
      {
        icon: ShieldAlert,
        title: "Federal Exclusion List Screening",
        description:
          "Every active employee is automatically screened each month against the OIG's List of Excluded Individuals/Entities and, when configured, SAM.gov — fuzzy matches land in a review queue for a human to confirm or dismiss, never acted on automatically.",
      },
      {
        icon: Award,
        title: "Administrator Qualification & CE Tracking",
        description:
          "Tracks an administrator's qualification path — the 100-hour DHS-approved course and competency test, or an NHA license exemption — plus the regional-office qualification notice and a rolling 24-hour annual continuing-education log.",
      },
      {
        icon: Pill,
        title: "Live Pass-Meds Authorization Roster",
        description:
          "One roster answers the question a surveyor actually asks on-site: who is authorized to administer medications right now. It cross-checks each employee's medication-administration certification, current-year practicum, and insulin/diabetes-education authorization into a single yes/no per person.",
      },
      {
        icon: FileSignature,
        title: "Policy Attestation Campaigns",
        description:
          "Publish a policy or procedure document, assign it to a roster with a due date, and capture each employee's electronic acknowledgment against the exact version reviewed, including the signer, time, IP address, user agent, and content hash to support defensible ESIGN/UETA recordkeeping.",
      },
    ],
  },
  {
    id: "scheduling",
    category: "Scheduling & Workforce",
    blurb: "Staff shift coverage across every facility an employee works at.",
    items: [
      {
        icon: CalendarClock,
        title: "Shift Scheduling & Auto-Fill",
        description:
          "Build a weekly or two-week staff shift schedule for any facility and auto-fill it in one click from each employee's typical shift, unit, and days-of-week pattern — managers only touch the exceptions. Schedules stay editable in draft until published, when employees see their upcoming shifts under My Schedule.",
      },
      {
        icon: Shuffle,
        title: "Cross-Facility Float Staff",
        description:
          "Employees can be assigned to more than one facility, and the scheduling roster draws from all of them — but every employee is capped at one shift per date across the whole organization, so a float aide can never be double-booked.",
      },
    ],
  },
  {
    id: "access-onboarding",
    category: "Access, Alerts & Onboarding",
    blurb: "Getting people and evidence in and out of the system safely.",
    items: [
      {
        icon: Users,
        title: "Role-Based Access",
        description:
          "Six built-in roles — from platform admin down to employee — enforced at the database layer, not just the UI.",
      },
      {
        icon: FileCheck,
        title: "Public Certificate Verification",
        description:
          "Every certificate ships with a public, tamper-evident verification link for surveyors and employers.",
      },
      {
        icon: UploadCloud,
        title: "Bulk Employee Import",
        description:
          "Onboard an entire facility roster in minutes with CSV import instead of one-by-one data entry.",
      },
      {
        icon: BellRing,
        title: "Alerts & Retraining Reminders",
        description:
          "Get ahead of expiring certifications and overdue retraining with alerts that escalate to admins if left unactioned — delivered in-app, by email, and by text message, with a weekly digest and per-message delivery confirmation.",
      },
      {
        icon: MailPlus,
        title: "Email-Invite User Provisioning",
        description:
          "Send a role-scoped email invite instead of setting a password yourself — the recipient lands on the same secure reset-password flow used for forgotten passwords, so no admin ever handles or transmits a credential.",
      },
      {
        icon: Rocket,
        title: "Instant Self-Service Signup",
        description:
          "A facility can create its own organization at sign-up with just an organization name and admin contact — no sales call required. Verify the admin email, set a password, and start entering employees and training records the same day under a free trial.",
      },
      {
        icon: Smartphone,
        title: "Installable Mobile App for Employees",
        description:
          "The employee training player installs to a phone's home screen like a native app, with the app shell precached for fast loads and assignment data falling back gracefully when a facility's WiFi or cell signal drops mid-lesson.",
      },
    ],
  },
];

export const STEPS = [
  {
    title: "Configure the operation",
    description:
      "Add facilities, roles, residents, and employees; import the roster; and configure the training, credential, resident, alert, and facility rules that apply.",
  },
  {
    title: "Route the work",
    description:
      "Assign training, services, schedules, reviews, maintenance, incident follow-up, and other operational tasks to the people responsible for completing or approving them.",
  },
  {
    title: "Capture proof as work happens",
    description:
      "Keep completions, signatures, documents, observations, approvals, and audit events attached to the correct employee, resident, facility, requirement, and deadline.",
  },
  {
    title: "See risk and share evidence",
    description:
      "Use dashboards, alerts, work queues, reports, regulatory crosswalks, evidence rooms, and binder exports to fix gaps and answer leadership, auditors, or surveyors with the underlying record.",
  },
];

export const OLD_WAY = [
  "Yearly in-service hours and training records scattered across spreadsheets, binders, and email attachments",
  "Expiring certifications discovered during a survey, not before",
  "Paper practicum sign-off sheets that are easy to lose or fake",
  "Building a compliance binder means a night of printing and hole-punching",
  "No single view of where every facility actually stands",
  "Re-checking each employee's hours against their license type's rules by hand, every renewal cycle",
  "Resident assessments, incident reports, and inspection findings living in separate binders with no link to a plan of correction",
  "Building a new course from scratch, or paying a vendor, every time a policy or regulation changes",
  "Admissions, resident services, food-safety rounds, maintenance, emergency logs, and quality-improvement (QAPI) work split across separate spreadsheets",
];

export const NEW_WAY = [
  "Every employee's yearly in-service hours, certifications, and practicums in one system of record",
  "Automatic alerts before certifications lapse or retraining comes due",
  "Digital competency checklists tied to each employee's role",
  "A facility or organization compliance binder PDF rebuilt from live records on request",
  "Real-time compliance dashboards across every facility, org-wide",
  "Training types configured once per organization — hours, renewal windows, and which facility types they apply to — instead of re-explained to every new hire",
  "Resident assessments, incidents, and DHS-cited violations tracked to a corrective action and a survey-ready plan of correction",
  "AI-drafted courses from your own source material, reviewed and approved by a real person before anyone sees them",
  "Admissions, resident services, safety, maintenance, quality, and facility evidence routed through accountable work queues",
];

export const SECURITY_FEATURES: IconItem[] = [
  {
    icon: Database,
    title: "Row-Level Security by Design",
    description:
      "Even a bug in a screen can't show one organization another's records: organization, facility, role, and record-scope rules are enforced inside the database itself (Postgres Row-Level Security), not just in the interface.",
  },
  {
    icon: Users,
    title: "Six Enforced Access Levels",
    description:
      "Platform admin, org admin, facility manager, trainer, employee, and auditor — each scoped to exactly the data their role should touch.",
  },
  {
    icon: Lock,
    title: "Private Storage, Signed URLs",
    description:
      "Documents, certificates, sign-in sheets, and compliance binders live in private storage and are only ever accessed through short-lived signed links.",
  },
  {
    icon: History,
    title: "Immutable Audit Trail",
    description:
      "Compliance-determining actions — quiz grading, certificate issuance, course publishing — are logged and can't be altered after the fact.",
  },
  {
    icon: UserCheck,
    title: "Human Review Gate on AI Content",
    description:
      "A training content version drafted or touched by AI can't be published until a named reviewer explicitly signs off, and that approval is cleared automatically the moment any block is AI-regenerated — a stale sign-off can never cover new content.",
  },
  {
    icon: Eye,
    title: "Audited Support Impersonation",
    description:
      "When support needs to sign in as a user to help troubleshoot, it requires a written reason, can't target another platform admin or a deactivated account, and every session start and end is written to an immutable, reviewable audit log.",
  },
  {
    icon: Fingerprint,
    title: "Version-Bound E-Signature Evidence",
    description:
      "Policy attestations are written through a dedicated function that captures the signer, timestamp, IP address, user agent, and a content hash of the exact document version reviewed — evidence designed to support ESIGN/UETA recordkeeping, not a generic checkbox.",
  },
  {
    icon: KeyRound,
    title: "Hashed, Never-Plaintext Secrets",
    description:
      "Class check-in PINs are bcrypt-hashed at rest and verified inside the database itself — the plaintext value is never stored, and only an authorized admin, manager, or trainer can set one for an employee.",
  },
];

export const FAQS = [
  {
    question: "What is CareMetric CareBase?",
    answer:
      "CareMetric CareBase is a multi-tenant operations, workforce-compliance, and survey-readiness platform built first for Pennsylvania personal care homes and assisted living facilities. It connects staff training and qualification, resident regulatory and non-clinical operations, incidents, complaints, inspections, maintenance, emergency readiness, scheduling, documents, quality work, and evidence reporting in one role-based system. It is not an EHR or eMAR.",
  },
  {
    question: "What software and manual systems can CareMetric CareBase replace?",
    answer:
      "Depending on how your organization works today, CareBase can consolidate a training LMS or course-delivery tool, training and credential spreadsheets, shared-drive compliance folders, paper survey binders, resident assessment due-date calendars, basic staff scheduling, admissions and census trackers, incident and plan-of-correction logs, policy acknowledgment tools, maintenance work-order sheets, resident-service calendars, quality-improvement (QAPI) workbooks, and basic resident receivable or personal-funds ledgers. The savings page separates full replacements from systems that should remain connected.",
  },
  {
    question: "Where do the time and cost savings come from?",
    answer:
      "Savings come from reducing duplicate entry and reconciliation, consolidating replaceable point tools, auto-filling schedules, importing rosters in bulk, sending reminders automatically, reusing approved training content, routing follow-up through one work queue, and generating reports and binders from live records. CareBase does not promise a universal percentage; the Value & Savings page provides an editable model based on your own hours, labor cost, current software spend, expected time reduction, and CareBase price.",
  },
  {
    question: "What does CareMetric CareBase not replace?",
    answer:
      "CareBase should work alongside, not replace, your eMAR or pharmacy platform, EHR or clinical chart, payroll and timeclock, HRIS, accounting general ledger, claims or billing system, emergency-call system, and any approved or accredited external training provider you still need. Its resident finance module is an operational subledger with exports, its schedule is not payroll, and medication integration routes external events rather than documenting bedside administration.",
  },
  {
    question: "How does CareMetric CareBase track our staff's yearly in-services?",
    answer:
      "Every employee gets a training plan built from the in-service hours, topics, and renewal windows your facility requires. As staff complete assigned training items, live classes, or outside training, CareMetric CareBase logs the hours against the right requirement — with regulatory credit applied once the operator verifies each completion — flags anyone falling behind before their deadline, and rolls it all up into one facility-wide view. No more reconciling paper sign-in sheets once a year to see who's actually current.",
  },
  {
    question: "How many yearly in-service hours does my type of provider actually need?",
    answer:
      "It depends on license type, role, assignment, and population served. Pennsylvania personal care homes generally require 12 annual hours per direct care worker under 55 Pa. Code Section 2600.65, with up to 6 hours of on-the-job training counting toward that total, plus 6 additional dementia hours for staff in a secured dementia care unit under Section 2600.236. Assisted living direct care staff need 16 annual hours under Section 2800.65, while Section 2800.69 adds 4 hours of dementia-specific training within 30 days of hire and 2 hours annually thereafter. CareBase maps facility type and employee applicability to separate hour buckets and topic requirements; the operator still reviews assignments and evidence for each person.",
  },
  {
    question: "Which regulations does it help us comply with?",
    answer:
      "CareMetric CareBase is anchored to Pennsylvania's 55 Pa. Code Chapter 2600 personal care home and Chapter 2800 Assisted Living Facility (ALF) requirements, including staff orientation and annual training, resident assessments and support-plan follow-up, administrator qualifications, medication-practicum evidence, fire drills and emergency preparedness, incidents, complaints, resident rights, and survey evidence. Its training catalog also supports Chapter 6400 and selected federal aide in-service pathways. The platform tracks, routes, and preserves evidence; it does not replace legal advice, official DHS forms, required professional judgment, or the facility's responsibility to comply.",
  },
  {
    question: "Does using CareMetric CareBase guarantee compliance or a deficiency-free survey?",
    answer:
      "No. CareBase makes requirements, deadlines, ownership, exceptions, and evidence visible and helps teams close gaps before review. Compliance still depends on accurate configuration, qualified staff, timely and truthful documentation, use of current official forms, management follow-through, and the facts observed by regulators. Dashboards and AI-assisted tools are decision support, not legal advice or a guarantee of survey results.",
  },
  {
    question: "Do our employees need to install anything?",
    answer:
      "No. CareMetric CareBase runs in the browser on any device, and the employee training player can also be installed to a phone's home screen as a lightweight app for faster access. Employees sign in to their self-service workspace to complete assigned training, take quizzes, view schedules, and download their own certificates — no app store required.",
  },
  {
    question: "How does the compliance binder actually work?",
    answer:
      "One click generates a real PDF — not a print-to-PDF workaround — pulling each facility's current training compliance, practicums, certificates, resident assessments, incidents, inspection items, and a weighted readiness score into a survey-ready binder, delivered through a short-lived secure link.",
  },
  {
    question: "Can our auditor or surveyor get read-only access?",
    answer:
      "Yes. The built-in auditor role sees the same compliance data your team does — dashboards, training matrix, reports, documents, audit log — with zero ability to edit or delete anything.",
  },
  {
    question: "Can we bring over our existing employee roster?",
    answer:
      "Yes. Bulk CSV import lets you onboard an entire facility's staff in minutes instead of entering employees one at a time.",
  },
  {
    question: "Do you support in-person, instructor-led training as well as assigned training items?",
    answer:
      "Both. Trainers can schedule live classes and capture attendance with a rotating QR code, a shared-device kiosk mode, or a printed sign-in sheet — so instructor-led sessions count toward each employee's in-service hours right alongside their assigned training item progress.",
  },
  {
    question: "Can one organization manage more than one facility?",
    answer:
      "Yes — CareMetric CareBase is multi-facility from the ground up. An org admin sees compliance status across every facility in the organization, while a facility manager's view is scoped to just the facility (or facilities) they're assigned to.",
  },
  {
    question: "Can we run compliance reports across the whole organization, not just one facility at a time?",
    answer:
      "Yes. The report center rolls up training compliance, certifications, and practicums by facility, training type, or employee, and it respects the same role-based scoping as the rest of the app — an org admin sees every facility, a facility manager sees their own.",
  },
  {
    question: "Does CareMetric CareBase track resident-level compliance, not just staff requirements?",
    answer:
      "Yes, for personal care homes and assisted living facilities. CareMetric CareBase tracks each resident's Resident Assessment and Support Plan (RASP/ASP) preadmission screening, initial assessment (due 15 days after admission for PCH; normally 30 days before admission for ALF), annual reassessment, significant-change reassessment, and support-plan updates — each with its own due date — alongside a digital drafting tool mirroring the DHS assessment structure. Every item still requires the signed, DHS-prescribed form on file to be marked complete; there's no substitute.",
  },
  {
    question: "Do you screen employees against background-check and exclusion requirements?",
    answer:
      "Yes. CareMetric CareBase tracks OAPSA-driven background-check status and the provisional-employment countdown for new hires, and automatically screens every active employee each month against the federal OIG exclusion list (and SAM.gov, when configured) — fuzzy matches go to a human review queue rather than being acted on automatically.",
  },
  {
    question: "Does it track administrator licensing and continuing education?",
    answer:
      "Yes — separate from staff in-service hours, CareMetric CareBase tracks each administrator's qualification path (the 100-hour DHS-approved course plus competency test, or an NHA license exemption), the regional-office qualification notice, and a rolling 24-hour annual continuing-education requirement, with supporting documents attached to each record.",
  },
  {
    question: "Can CareMetric CareBase schedule staff shifts too?",
    answer:
      "Yes. Beyond training compliance, CareMetric CareBase includes a shift-scheduling module: set up each facility's units and shift types, capture each employee's typical weekly pattern, auto-fill a draft schedule from those patterns, and publish it so employees see their upcoming shifts under My Schedule.",
  },
  {
    question: "How does the AI training-content generation work, and who reviews it?",
    answer:
      "Paste in a regulation, policy, or reference document and CareMetric CareBase drafts complete training content — lesson content, video scripts, and quizzes — grounded in that source text, with an optional AI avatar video for any lesson. The model is instructed to flag gaps instead of inventing a citation, and no AI-touched training content can publish until a named reviewer explicitly signs off.",
  },
  {
    question: "How do you handle incidents, DHS violations, and plans of correction?",
    answer:
      "Log a reportable incident and CareMetric CareBase schedules the required regulatory notifications with their own due-by clocks and generates a formatted incident report PDF. A DHS-cited violation gets tracked against its specific citation and POC due date, with evidence attachments and a generated Plan of Correction PDF, through to Corrected and Verified.",
  },
  {
    question: "Can employees get text or email reminders, not just in-app alerts?",
    answer:
      "Yes. A background dispatcher sends training due-soon and expired alerts by email and, once an organization turns it on, by text message too — with unresolved alerts automatically escalating to admins, a weekly compliance digest, and a delivery log on the Settings page so you can confirm a reminder actually went out.",
  },
  {
    question: "Can a new organization sign up and start using it immediately?",
    answer:
      "Yes. A facility can create its own organization at sign-up with just an organization name and admin contact — no sales call required. Verify the admin email, set a password, and start entering employees and training records immediately under a free trial.",
  },
];
