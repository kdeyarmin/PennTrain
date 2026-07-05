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
  "mailto:hello@caremetric.ai?subject=CareMetric%20Train%20Demo%20Request";

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
      "12 hours of yearly in-service per direct care worker (up to 6 may be supervised on-the-job training), plus 6 more for staff on a secured dementia unit -- 55 Pa. Code Section 2600.65, tracked automatically per employee.",
  },
  {
    icon: HeartHandshake,
    title: "Assisted Living Residences",
    description:
      "16 hours of yearly in-service per direct care worker, plus dementia-specific training at hire and 2 hours every year after -- 55 Pa. Code Section 2800.65/.69, all tracked against the clock automatically.",
  },
  {
    icon: Accessibility,
    title: "Group Homes",
    description:
      "24 hours of yearly training for direct service workers and their supervisors, 12 hours for every other staff role -- 55 Pa. Code Section 6400.52, each role's requirement tracked separately and automatically.",
  },
  {
    icon: BedDouble,
    title: "Nursing Homes",
    description:
      "12 hours of yearly in-service per nurse aide under federal OBRA rules (42 CFR 483.95), targeted to each employee's most recent performance review -- not just a generic annual class.",
  },
  {
    icon: HomeIcon,
    title: "Home Health Agencies",
    description:
      "12 hours of yearly in-service per home health aide, RN-supervised and documented under 42 CFR 484.80 -- tracked automatically across your whole field staff.",
  },
  {
    icon: Stethoscope,
    title: "Hospice Agencies",
    description:
      "12 hours of yearly in-service per hospice aide, RN-supervised and documented under 42 CFR 418.76, across every discipline on your interdisciplinary team.",
  },
];

export const FEATURES: IconItem[] = [
  {
    icon: ShieldCheck,
    title: "Compliance Tracking",
    description:
      "Yearly in-services, training records, certifications, and medication practicums in one system of record, with automatic alerts before anything lapses.",
  },
  {
    icon: GraduationCap,
    title: "Built-in Course Builder",
    description:
      "Author courses, quizzes with server-side grading, and issue certificates -- no separate training vendor required.",
  },
  {
    icon: ClipboardCheck,
    title: "Competency Checklists",
    description:
      "Configurable competency templates and training plans so every role gets the right requirements, automatically.",
  },
  {
    icon: FileStack,
    title: "One-Click Compliance Binder",
    description:
      "Generate a real, survey-ready compliance binder PDF for any facility in seconds -- no more print-to-PDF workarounds.",
  },
  {
    icon: BellRing,
    title: "Alerts & Retraining Reminders",
    description:
      "Get ahead of expiring certifications and overdue retraining before a surveyor finds them first.",
  },
  {
    icon: FileCheck,
    title: "Public Certificate Verification",
    description:
      "Every certificate ships with a public, tamper-evident verification link for surveyors and employers.",
  },
  {
    icon: Users,
    title: "Role-Based Access",
    description:
      "Six built-in roles -- from platform admin down to employee -- enforced at the database layer, not just the UI.",
  },
  {
    icon: UploadCloud,
    title: "Bulk Employee Import",
    description:
      "Onboard an entire facility roster in minutes with CSV import instead of one-by-one data entry.",
  },
  {
    icon: CalendarCheck,
    title: "Live Class Scheduling & Sign-In",
    description:
      "Trainers schedule instructor-led classes and capture digital attendee sign-in, so in-person sessions count toward compliance right alongside online courses.",
  },
  {
    icon: ListChecks,
    title: "Training Plans, Built Per Role",
    description:
      "Assign the right training plan to each role once, and CareMetric Train tracks every employee's progress against it automatically.",
  },
  {
    icon: BarChart3,
    title: "Compliance Reporting Center",
    description:
      "Roll up training compliance, certifications, and practicums by facility, training type, or employee -- scoped to what each role is allowed to see.",
  },
  {
    icon: FolderLock,
    title: "Audit-Ready Document Storage",
    description:
      "Training documents, sign-in sheets, and competency attachments live in private storage, accessed only through short-lived signed links tied to the employee and facility they belong to.",
  },
];

export const STEPS = [
  {
    title: "Set up your organization",
    description:
      "Add your facilities, import your employee roster, and configure the training types your state requires.",
  },
  {
    title: "Assign training & practicums",
    description:
      "Build training plans and course assignments once, and let CareMetric Train track completion for every employee.",
  },
  {
    title: "Stay survey-ready",
    description:
      "Alerts flag what's expiring, reports show where you stand, and the compliance binder is always one click away.",
  },
];

export const OLD_WAY = [
  "Yearly in-service hours and training records scattered across spreadsheets, binders, and email attachments",
  "Expiring certifications discovered during a survey, not before",
  "Paper practicum sign-off sheets that are easy to lose or fake",
  "Building a compliance binder means a night of printing and hole-punching",
  "No single view of where every facility actually stands",
  "Re-checking each employee's hours against their license type's rules by hand, every renewal cycle",
];

export const NEW_WAY = [
  "Every employee's yearly in-service hours, certifications, and practicums in one system of record",
  "Automatic alerts before certifications lapse or retraining comes due",
  "Digital competency checklists tied to each employee's role",
  "A survey-ready compliance binder PDF generated in seconds",
  "Real-time compliance dashboards across every facility, org-wide",
  "Training types configured once per organization -- hours, renewal windows, and which facility types they apply to -- instead of re-explained to every new hire",
];

export const SECURITY_FEATURES: IconItem[] = [
  {
    icon: Database,
    title: "Row-Level Security by Design",
    description:
      "Every table is protected by Postgres Row-Level Security, not just application code -- the database itself enforces who can see and change what.",
  },
  {
    icon: Users,
    title: "Six Enforced Access Levels",
    description:
      "Platform admin, org admin, facility manager, trainer, employee, and auditor -- each scoped to exactly the data their role should touch.",
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
      "Compliance-determining actions -- quiz grading, certificate issuance, course publishing -- are logged and can't be altered after the fact.",
  },
];

export const FAQS = [
  {
    question: "What is CareMetric Train?",
    answer:
      "CareMetric Train is a multi-tenant compliance-training platform and learning management system built for personal care homes, assisted living residences, group homes, nursing homes, home health, and hospice agencies. It replaces spreadsheets and paper binders with one system for yearly in-services, training records, certifications, medication practicums, and survey-ready reporting.",
  },
  {
    question: "How does CareMetric Train track our staff's yearly in-services?",
    answer:
      "Every employee gets a training plan built from the in-service hours, topics, and renewal windows your facility requires. As staff complete assigned courses, live classes, or outside training, CareMetric Train logs the hours automatically, flags anyone falling behind before their deadline, and rolls it all up into one facility-wide view -- no more reconciling paper sign-in sheets once a year to see who's actually current.",
  },
  {
    question: "How many yearly in-service hours does my type of provider actually need?",
    answer:
      "It depends on your license type, and CareMetric Train already knows the difference: personal care homes need 12 hours per direct care worker per year (55 Pa. Code Section 2600.65), plus 6 more for staff on a secured dementia unit. Assisted living residences need 16 hours (Section 2800.65/.69), plus dementia-specific training at hire and 2 hours annually after that. Group homes need 24 hours for direct service workers and their supervisors, and 12 for every other role (Section 6400.52). Nursing homes, home health agencies, and hospice agencies each require 12 hours per aide per year under federal rules (42 CFR 483.95, 484.80, and 418.76). Set your organization's license type once, and every employee's training plan is built to the right number automatically.",
  },
  {
    question: "Which regulations does it help us comply with?",
    answer:
      "CareMetric Train grew out of Pennsylvania's 55 Pa. Code Chapter 2600 personal care home, Chapter 2800 assisted living, and Chapter 6400 group home training requirements, and every training type, competency checklist, and practicum is configurable -- so your organization can model the specific requirements your state and license type require, whether that's a personal care home, assisted living residence, group home, nursing home, home health, or hospice agency.",
  },
  {
    question: "Do our employees need to install anything?",
    answer:
      "No. CareMetric Train runs in the browser on any device. Employees sign in to a course center to complete assigned training, take quizzes, and download their own certificates -- no app install required.",
  },
  {
    question: "How does the compliance binder actually work?",
    answer:
      "One click generates a real PDF -- not a print-to-PDF workaround -- pulling each facility's current training compliance, practicums, certificates, and alerts into a survey-ready binder, delivered through a short-lived secure link.",
  },
  {
    question: "Can our auditor or surveyor get read-only access?",
    answer:
      "Yes. The built-in auditor role sees the same compliance data your team does -- dashboards, training matrix, reports, documents, audit log -- with zero ability to edit or delete anything.",
  },
  {
    question: "Can we bring over our existing employee roster?",
    answer:
      "Yes. Bulk CSV import lets you onboard an entire facility's staff in minutes instead of entering employees one at a time.",
  },
  {
    question: "Do you support in-person, instructor-led training, or only online courses?",
    answer:
      "Both. Trainers can schedule live classes and capture digital attendee sign-in, so instructor-led sessions count toward each employee's in-service hours right alongside their online course progress -- no separate paper sign-in sheet to reconcile later.",
  },
  {
    question: "Can one organization manage more than one facility?",
    answer:
      "Yes -- CareMetric Train is multi-facility from the ground up. An org admin sees compliance status across every facility in the organization, while a facility manager's view is scoped to just the facility (or facilities) they're assigned to.",
  },
  {
    question: "Can we run compliance reports across the whole organization, not just one facility at a time?",
    answer:
      "Yes. The report center rolls up training compliance, certifications, and practicums by facility, training type, or employee, and it respects the same role-based scoping as the rest of the app -- an org admin sees every facility, a facility manager sees their own.",
  },
];
