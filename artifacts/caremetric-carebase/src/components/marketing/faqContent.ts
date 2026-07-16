/**
 * FAQ content for the marketing FAQ page and its FAQPage structured data.
 *
 * Kept dependency-free (pure strings, no icon imports) so the build-time
 * prerender script (server/prerender-heads.mjs) can bundle it for Node and
 * bake the same FAQPage JSON-LD into the raw /faq HTML that Faq.tsx builds at
 * runtime. App code should keep importing FAQS from "./content", which
 * re-exports this module.
 */
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
