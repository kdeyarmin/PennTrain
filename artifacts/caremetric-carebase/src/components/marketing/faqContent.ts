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
      "A multi-tenant operations, workforce-compliance, and survey-readiness platform built first for Pennsylvania personal care homes and assisted living facilities. It connects training, credentials, resident operations, incidents, inspections, scheduling, documents, and evidence in one role-based system. It is not an EHR or eMAR.",
  },
  {
    question: "What can it replace?",
    answer:
      "Depending on how you work today: a training LMS, training and credential spreadsheets, shared-drive compliance folders, paper survey binders, assessment due-date calendars, basic staff scheduling, admissions and census trackers, incident and POC logs, policy acknowledgment tools, work-order sheets, QAPI workbooks, and basic resident receivable ledgers.",
  },
  {
    question: "What does it not replace?",
    answer:
      "Your eMAR or pharmacy platform, EHR or clinical chart, payroll and timeclock, HRIS, accounting general ledger, claims or billing system, emergency-call system, and any accredited external training provider your rules still require. CareBase works alongside them.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Per facility per month, every module included, unlimited employees and residents. Single-facility pricing is $349 per facility per month; organizations with 3 or more facilities use the $299 per-facility monthly rate. The free trial lasts 14 days. See pricing and model your savings.",
  },
  {
    question: "Where do the savings come from?",
    answer:
      "Less duplicate entry and reconciliation, retired point tools, auto-filled schedules, bulk roster import, automatic reminders, one work queue, and reports generated from live records. We don't promise a universal percentage — the savings worksheet uses your own numbers and excludes risk avoidance.",
  },
  {
    question: "Which regulations does it help with?",
    answer:
      "Anchored to 55 Pa. Code Chapters 2600 (PCH) and 2800 (ALF): staff orientation and annual training, resident assessments and support plans, administrator qualifications, medication practicums, fire drills, incidents, resident rights, and survey evidence. The training catalog also supports Chapter 6400 and federal aide in-service pathways. It tracks and preserves evidence — it doesn't replace legal advice or official DHS forms.",
  },
  {
    question: "Does it guarantee compliance or a deficiency-free survey?",
    answer:
      "No. CareBase makes requirements, deadlines, ownership, and evidence visible so your team can close gaps before review. Outcomes still depend on accurate configuration, qualified staff, truthful documentation, and management follow-through.",
  },
  {
    question: "How many annual training hours does my provider type need?",
    answer:
      "It depends on license type, role, and population served — 12 hours for PCH direct care workers, 16 for ALF, 24/12 for Chapter 6400, 12 for nurse, home health, and hospice aides. See the full PA training requirements guide.",
  },
  {
    question: "Does it track resident-level compliance, not just staff?",
    answer:
      "Yes, for PCH and ALF: RASP/ASP preadmission screening, the 15-day initial assessment, annual and significant-change reassessments, and support-plan updates — each on its own due date. The signed, DHS-prescribed form on file is still what closes the requirement.",
  },
  {
    question: "How does it track yearly in-service hours?",
    answer:
      "Every employee gets a training plan built from the hours, topics, and renewal windows your facility requires. Assigned training, live classes, and outside records all log hours automatically, and anyone falling behind is flagged before their deadline.",
  },
  {
    question: "Do you support in-person, instructor-led training?",
    answer:
      "Yes. Trainers schedule live classes and capture attendance with a rotating QR code, a shared-device kiosk mode, or a printed sign-in sheet — sessions count toward in-service hours alongside assigned items.",
  },
  {
    question: "Who reviews AI-generated training content?",
    answer:
      "A named human reviewer, every time. Drafts are grounded in your own source documents, the model flags gaps instead of inventing citations, and nothing publishes without explicit sign-off — which resets if any block is regenerated.",
  },
  {
    question: "How are incidents, violations, and plans of correction handled?",
    answer:
      "Logging a reportable incident schedules the required notifications — state hotline, law enforcement, licensing — each with its own due-by clock, and generates a formatted report PDF. DHS-cited violations track against their citation and POC due date through Corrected and Verified.",
  },
  {
    question: "Can it schedule staff shifts too?",
    answer:
      "Yes. Set up each facility's units and shift types, capture each employee's typical pattern, auto-fill a draft schedule, and publish it to My Schedule. Float staff can work multiple facilities but never double-book across the organization.",
  },
  {
    question: "Do you screen against background-check and exclusion requirements?",
    answer:
      "Yes. OAPSA provisional-employment countdowns for new hires, Act 34/73/33 clearance tracking, and automatic monthly screening of every active employee against the OIG exclusion list (and SAM.gov when configured) — fuzzy matches go to a human review queue.",
  },
  {
    question: "Can one organization manage multiple facilities?",
    answer:
      "Yes — multi-facility from the ground up. Org admins see every facility; facility managers see only their assigned sites. Reports respect the same scoping.",
  },
  {
    question: "Can our auditor or surveyor get read-only access?",
    answer:
      "Yes. The auditor role sees dashboards, the training matrix, reports, and documents with zero ability to edit — plus time-limited evidence rooms scoped to exactly what was requested. More on the security page.",
  },
  {
    question: "Do employees need to install anything?",
    answer:
      "No. CareBase runs in the browser on any device; the employee training player can also install to a phone's home screen as a lightweight app — no app store required.",
  },
  {
    question: "Can staff get text or email reminders?",
    answer:
      "Yes — due-soon and expired alerts by email and (once enabled) text, unresolved alerts escalate to admins, plus a weekly digest and a delivery log so you can confirm a reminder actually went out.",
  },
  {
    question: "What happens during an actual survey?",
    answer:
      "You open the readiness dashboard at the entrance conference, hand the surveyor a read-only auditor login or a printed binder generated that morning, and answer document requests from live records instead of a filing cabinet. Anything cited goes straight into the plan-of-correction workflow with its due date.",
  },
  {
    question: "What if my administrator quits?",
    answer:
      "The compliance picture doesn't leave with them. Requirements, deadlines, evidence, and history live in the record — a new administrator inherits a working system on day one instead of deciphering a predecessor's spreadsheet.",
  },
  {
    question: "Can I cancel and keep my records?",
    answer:
      "Yes. Your organization owns its data. If you cancel, you export everything during the wind-down window — records are yours, not hostages.",
  },
  {
    question: "My aides aren't tech people. Will they use it?",
    answer:
      "They scan a QR code with their own phone to sign into class, and their training player installs to a home screen like any app — no passwords to remember for kiosk check-in, no app store, no IT department.",
  },
  {
    question: "Can a new organization start immediately?",
    answer:
      "Yes. Self-serve signup creates your organization with a name, admin contact, and password — no sales call — and you can start entering employees and records the same day under the free trial.",
  },
  {
    question: "Can we bring over our existing roster?",
    answer:
      "Yes — bulk CSV import onboards an entire facility's staff in minutes instead of one-by-one entry.",
  },
];
