import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;

// Static generated asset checked into the built app, not something regenerated live at request
// time -- a fixed edition string keeps the PDF's bytes (and its git diff) stable across rebuilds
// that don't actually change the manual's content.
const EDITION = "Edition 1";
const EDITION_DATE = "2026";

const TITLE_COLOR: [number, number, number] = [0.16, 0.22, 0.44];
const BODY_COLOR: [number, number, number] = [0.12, 0.12, 0.12];
const MUTED_COLOR: [number, number, number] = [0.45, 0.45, 0.45];
const RULE_COLOR: [number, number, number] = [0.75, 0.75, 0.78];

interface Section {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

const SECTIONS: Section[] = [
  {
    title: "Getting Started & Roles",
    paragraphs: [
      "CareMetric CareBase is a multi-tenant facility management and compliance platform for personal care homes, assisted living residences, and related care providers. Every account is assigned exactly one role, and that role determines which part of the app you land in after signing in and which pages and actions are available to you. There are six roles: platform_admin, org_admin, facility_manager, trainer, employee, and auditor.",
      "platform_admin is reserved for the CareMetric CareBase team. It has broad access across every organization on the platform, under /admin, and is the only role that can author training content -- creating and publishing training content, quizzes, and their questions and answers. org_admin and facility_manager are the two operator-facing admin roles, working under /app: they manage facilities, staff, training compliance, scheduling, documents, and reporting for their own organization. facility_manager's day-to-day access can additionally be narrowed to specific assigned facilities.",
      "trainer works under /trainer, focused on running training classes, monitoring who is due for retraining, and looking up facility/employee rosters. employee is the self-service role under /me, where staff take assigned training items, view their own training records, download their certificates, and complete policy attestations. auditor is a read-only role under /app with visibility into nearly everything org_admin and facility_manager can see -- compliance status, reports, the audit log -- but no ability to create, edit, or delete records.",
    ],
    bullets: [
      "platform_admin -- /admin -- every organization, training-content authoring, platform settings",
      "org_admin -- /app -- full management of one organization",
      "facility_manager -- /app -- management scoped to assigned facilities",
      "trainer -- /trainer -- classes, retraining monitor, facility/employee lookup",
      "employee -- /me -- own training assignments, training records, certificates, attestations",
      "auditor -- /app (read-only) -- compliance visibility without edit rights",
    ],
  },
  {
    title: "Facilities & Employees",
    paragraphs: [
      "Facilities (/app/facilities) are the physical locations your organization operates -- personal care homes, assisted living residences, or other licensed sites. Each facility record carries its own license number and facility type, which in turn controls which compliance modules apply to it: some workflows, like Practicums, the Medication Administration Roster, Residents, and Inspections, only appear for facility types that require them.",
      "Employees (/app/employees) is your staff roster. Every employee belongs to a home facility, and can optionally be assigned to work additional facilities for scheduling purposes. Opening an employee's detail page brings together everything about that person in one place: their training record status, credentials, background checks, assigned training items, and practicum progress, so a facility_manager preparing for an inspection doesn't have to hunt across five different pages.",
      "New employees can be added one at a time or in bulk via CSV import, which is useful when onboarding an entire facility's existing staff at once.",
    ],
    bullets: [
      "Add or edit a facility, including its license number and facility type",
      "Add employees individually, or bulk-import a CSV of your existing staff",
      "Open any employee's detail page to see their full compliance picture",
    ],
  },
  {
    title: "Scheduling",
    paragraphs: [
      "The Schedule module (/app/schedule) provides basic shift scheduling for facility staff. Start at Schedule Setup (/app/schedule/setup) to define the building blocks: facility units (wings or areas of the building), shift definitions (your typical shift time templates, such as 7a-3p or 3p-11p), and each employee's usual recurring pattern by day of week.",
      "Once those are in place, create a new draft schedule for a facility and period, then use the auto-fill action to populate it from every employee's typical pattern -- it fills in the gaps around any shifts you've already entered by hand, and manual entries always take precedence. When the draft looks right, publish it; employees only see their own shifts once a schedule is published, at /me/schedule.",
      "Note that scheduling in CareMetric CareBase is not qualification-gated -- the system does not currently check that a scheduled employee holds a specific certification before assigning them a shift. Also, an employee can only be scheduled for one shift per calendar date across all facilities; there is no same-day float between two facilities.",
    ],
    bullets: [
      "Set up facility units, shift definitions, and employee shift preferences",
      "Create a draft schedule and run auto-fill to populate it",
      "Review, adjust, and publish the schedule so employees can see it",
    ],
  },
  {
    title: "Training Matrix & Training Content",
    paragraphs: [
      "The Training Matrix (/app/training-matrix) is the master grid of who owes what: every employee against every applicable training type, with each cell showing a compliance status of Compliant, Due Soon, Expired, Missing, or Not Applicable. It is the fastest way to spot gaps before they become a citation.",
      "Courses (/app/courses) is where your organization's required training content is managed -- modules built from text, video, and quizzes, delivered to employees who are enrolled via a training assignment. Training content itself is authored exclusively by CareMetric CareBase's platform team (including AI-assisted course generation) to keep regulated training content consistent and reviewed; org_admin and facility_manager browse and assign courses but do not edit their content.",
      "When an employee completes a training item and passes its quiz, a certificate is generated automatically and becomes available on their My Certificates page. Certificates carry a unique verification link (/verify/:slug) that can be checked by anyone, without logging in -- useful for proving a credential to a state surveyor or a business partner.",
    ],
    bullets: [
      "Review the Training Matrix for compliance gaps across your whole roster",
      "Assign required training to employees via Training Assignments",
      "Employees take training content and quizzes at /me/courses",
      "Passing a quiz auto-issues a certificate, verifiable at /verify/:slug",
    ],
  },
  {
    title: "Training Plans & Competency Tracking",
    paragraphs: [
      "Training Plans (/app/training-plans) let you bundle a set of required trainings into a single named plan -- for example, a new-hire onboarding plan, or an annual refresher plan for medication aides -- and assign that whole bundle to an employee at once rather than assigning each training individually.",
      "Competency Templates and Competency Records (/app/competency-templates, /app/competency-records) support skills validation that goes beyond a course quiz: a template defines a checklist of discrete competencies (for example, individual steps of a medication pass or a fire-safety procedure), and a competency record captures a specific employee being observed and signed off against that checklist by a qualified evaluator.",
      "Together, training plans and competency tracking cover both halves of staff readiness: that someone has completed the required training, and that someone has demonstrably shown they can do the task correctly.",
    ],
    bullets: [
      "Build a training plan from a set of required trainings and assign it to employees",
      "Create a competency template listing the specific skills to validate",
      "Record a completed competency check-off against an employee",
    ],
  },
  {
    title: "Practicums & Medication Administration Roster",
    paragraphs: [
      "Practicums (/app/practicums) track the hands-on, supervised practicum hours required for certain staff roles at personal care homes and assisted living residences, alongside their due dates and compliance status. This module only appears for facilities of a type that requires practicums.",
      "The Medication Administration Roster (/app/med-admin-roster) is the authoritative list of which employees are currently certified to administer medications at a given facility, and is one of the first documents a state surveyor will ask to see during an inspection. Keeping it current depends on the underlying training records and credentials staying up to date, since roster eligibility is derived from those records rather than tracked separately.",
    ],
    bullets: [
      "Track practicum hours and due dates for medication-administration-eligible staff",
      "Review the current medication administration roster before an inspection",
    ],
  },
  {
    title: "Credentials, Background Checks & Exclusion Screening",
    paragraphs: [
      "Employee Credentials (/app/credentials) tracks licenses, certifications, and clearances that expire and must be renewed -- things like CPR cards, professional licenses, and other credential types -- each with its own expiration date and compliance status, independent of the course/quiz training system.",
      "Background Checks (/app/background-checks) records the criminal background check status required before or during employment, and Exclusion Screening (/app/exclusion-screening) tracks whether staff have been checked against federal and state exclusion/debarment lists that would prohibit them from working in a healthcare setting. Both are sensitive, restricted views -- available to org_admin, facility_manager, and auditor, but intentionally not to trainer.",
      "For facilities that require one, Administrator Qualification (/app/administrator-qualification) tracks the specific qualification records required for a facility's administrator of record.",
    ],
    bullets: [
      "Log and track expiration dates for licenses and clearances under Credentials",
      "Record background check completion and results",
      "Run and record exclusion list screening results",
    ],
  },
  {
    title: "Incidents & DHS Violations / Plans of Correction",
    paragraphs: [
      "Incidents (/app/incidents) is the reportable-incident log: falls, injuries, medication errors, and other events that must be documented, investigated, and in many cases reported to state agencies within a required time window. Each incident tracks the staff involved, required notifications and their due dates, investigation findings, root cause, and any corrective actions -- and can be exported as a formal incident report PDF once a final report is submitted.",
      "Violations (/app/violations) tracks formal DHS citations issued against a facility and the corresponding Plan of Correction (POC) -- what the facility committed to do, by when, to resolve the citation. Both incidents and violations are restricted to org_admin, facility_manager, and auditor, reflecting how sensitive this data is; trainer and self-service employee access are both excluded.",
      "Staying ahead of open corrective actions across incidents and violations is one of the most effective ways to walk into a state inspection with confidence rather than surprises.",
    ],
    bullets: [
      "Log a new incident, its narrative, staff involved, and required notifications",
      "Track investigation findings, root cause, and corrective actions to closure",
      "Record a DHS violation and its Plan of Correction, with due dates",
    ],
  },
  {
    title: "Residents & Resident Compliance",
    paragraphs: [
      "For personal care home and assisted living facilities, Residents (/app/residents) maintains a compliance-oriented resident registry -- census information plus flags such as whether a resident is in a specialized dementia care unit (SDCU) or receiving hospice services. This module deliberately does not include clinical charting, an eMAR, or care plans; it exists to track compliance dates and census, not to serve as a clinical record system.",
      "Resident Compliance (/app/resident-compliance) reports on resident-level compliance items -- assessments and other resident-specific requirements -- against their due dates, using the same Compliant / Due Soon / Expired / Missing status model used everywhere else in the app. Resident Assessment Forms let you configure the specific assessment content used for a facility's residents.",
      "Like Practicums and the Medication Administration Roster, resident modules only appear for facilities of the applicable type, and are restricted to org_admin, facility_manager, and auditor.",
    ],
    bullets: [
      "Maintain your resident census, including SDCU and hospice flags",
      "Track resident-level compliance items against their due dates",
      "Configure resident assessment form content as needed",
    ],
  },
  {
    title: "Inspections & Equipment",
    paragraphs: [
      "Inspection Items (/app/inspections) tracks recurring physical-plant and equipment compliance requirements -- fire extinguisher inspections, generator testing, and similar items -- each with a next-due date and status. Inspection Readiness (/app/inspection-readiness) rolls this up into a facility-level readiness view so you can see at a glance which facilities are prepared for a walkthrough and which have open items.",
      "This is the one facility-type-restricted module that trainer can also see, reflecting that physical-plant compliance is generally less sensitive than staff credentialing or resident data.",
    ],
    bullets: [
      "Log inspection items and their recurring due dates",
      "Review facility-level inspection readiness before a walkthrough",
    ],
  },
  {
    title: "Alerts & Notifications",
    paragraphs: [
      "Alerts (/app/alerts) is the platform's early-warning system: as training records, credentials, practicums, and other compliance items approach or pass their due dates, the system raises alerts at a severity of critical, warning, or info so nothing falls through the cracks silently. Alerts are visible to every org role, including auditor, since staying aware of open alerts is central to compliance oversight even without edit rights.",
      "Reviewing open alerts regularly, rather than waiting for the monthly report, is the single best habit for keeping a facility's compliance posture in good shape.",
    ],
    bullets: [
      "Review open alerts, sorted by severity",
      "Resolve the underlying compliance gap to clear an alert",
    ],
  },
  {
    title: "Reports & the Compliance Binder",
    paragraphs: [
      "Reports (/app/reports) provides summary views across your organization's compliance data -- training, credentials, incidents, and more -- for day-to-day monitoring. For a single, comprehensive export, the Compliance Binder (/app/compliance-binder) generates a multi-page PDF snapshot of your organization's (or, for a facility_manager, their assigned facilities') full compliance picture: facility and resident census, training and practicum status, certificates issued, open alerts, policy attestation status, credentials, incidents, inspection items, and a citation-weighted readiness summary ordered the way a DHS surveyor actually works through a review.",
      "The Compliance Binder is generated on demand, uploaded securely, and made available through a time-limited download link -- it is not stored anywhere you can browse to later, so generate a fresh copy whenever you need one for an inspection or an internal review.",
    ],
    bullets: [
      "Use Reports for ongoing, day-to-day compliance monitoring",
      "Generate a Compliance Binder before an inspection or board review",
      "Download promptly -- the binder's link expires after a short window",
    ],
  },
  {
    title: "Policy Documents & Attestations",
    paragraphs: [
      "Policy Documents (/app/policy-documents) is where your organization's written policies live -- versioned, so that once a policy is published its content is locked, and any revision creates a new version rather than silently editing history out from under staff who already attested to it.",
      "An attestation campaign attaches a policy version to a roster of employees who must read and formally acknowledge it by a due date. Employees complete their attestations from their own My Attestations page (/me/attestations); each signed attestation records who signed, when, how they authenticated, and their IP address, forming the audit trail you would need to demonstrate policy acknowledgment was genuine and not just assumed.",
    ],
    bullets: [
      "Publish a policy document and start a new version when it changes",
      "Launch an attestation campaign to a roster of employees with a due date",
      "Employees complete attestations at /me/attestations",
    ],
  },
  {
    title: "Documents & Template Documents",
    paragraphs: [
      "Documents (/app/documents, and /me/documents for employees) is general-purpose file storage tied to your organization, facilities, or individual employees -- scanned certificates, sign-in sheets, or any other supporting file worth keeping on record.",
      "Template Documents (/app/template-documents) is a reference library of standard forms and templates relevant to compliance operations, kept separate from your organization's own uploaded documents so the two don't get mixed together.",
    ],
    bullets: [
      "Upload and organize supporting documents by facility or employee",
      "Browse the template document library for standard forms",
    ],
  },
  {
    title: "Audit Log",
    paragraphs: [
      "The Audit Log (/app/audit) is a chronological record of who changed what, and when, across your organization's data. It is available to org_admin and auditor. facility_manager is deliberately excluded from this particular page, since the audit log is organization-wide by design and is not scoped down to a facility_manager's assigned facilities the way most other modules are.",
      "The audit log is often the first place to look when reconciling an unexpected change to a record, or when responding to a question about who took a particular action.",
    ],
  },
  {
    title: "Settings & Users",
    paragraphs: [
      "Users (/app/users) is where org_admin and facility_manager manage the accounts within their organization -- inviting new staff, assigning roles, and deactivating accounts that should no longer have access. Role assignment is deliberately constrained: an org_admin can create any non-platform_admin role in their own organization, while a facility_manager can only create trainer or employee accounts.",
      "Settings (/app/settings) covers organization-level configuration -- branding and other organization-wide preferences that shape how the app appears and behaves for your organization's users.",
    ],
    bullets: [
      "Invite and manage user accounts under Users",
      "Configure organization-wide preferences under Settings",
    ],
  },
  {
    title: "Getting Help",
    paragraphs: [
      "The Help Center is your first stop whenever something is unclear or isn't working as expected. It brings together three resources: a searchable FAQ of answers to common questions, a library of Job Aides (short, task-focused how-to guides for specific workflows), and this User Manual, all in one place so you don't have to guess which page might have the answer.",
      "When the FAQ and Job Aides don't cover your situation, submit a support ticket directly from the Help Center. Give it a clear subject, pick the category that best matches your issue (general question, technical issue, billing, training content, account access, or feature request), set a priority, and describe what's happening in the message -- the more specific, the faster it can be resolved. Every ticket you submit is visible only to you and the CareMetric CareBase support team.",
      "Once a ticket is open, you can check on it any time from the Help Center: replies from the support team appear in the ticket's message thread, and you'll see its status move from Open to In Progress and eventually to Resolved. If a resolved ticket turns out not to have actually fixed things, you can reopen it rather than starting a brand-new ticket from scratch.",
    ],
    bullets: [
      "Search the FAQ and Job Aides first -- many answers are already there",
      "Submit a ticket with a clear subject, category, priority, and description",
      "Check back on your ticket for support replies, and reopen it if needed",
    ],
  },
];

class PdfWriter {
  private constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private page: PDFPage,
    private y: number,
  ) {}

  static async create() {
    const doc = await PDFDocument.create();
    doc.setTitle("CareMetric CareBase — User Manual");
    doc.setAuthor("CareMetric CareBase");
    doc.setSubject("CareMetric CareBase User Manual");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    return new PdfWriter(doc, font, bold, page, PAGE_HEIGHT - MARGIN);
  }

  get document() {
    return this.doc;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  text(str: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.font;
    const [r, g, b] = opts.color ?? BODY_COLOR;
    this.ensureSpace(size + 4);
    this.page.drawText(str, { x: MARGIN, y: this.y, size, font, color: rgb(r, g, b) });
    this.y -= size + (opts.gap ?? 6);
  }

  heading(str: string, opts: { size?: number } = {}) {
    const size = opts.size ?? 17;
    this.ensureSpace(size + 30);
    this.y -= 8;
    this.page.drawText(str, { x: MARGIN, y: this.y, size, font: this.bold, color: rgb(...TITLE_COLOR) });
    this.y -= 10;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color: rgb(...RULE_COLOR),
    });
    this.y -= 16;
  }

  paragraph(str: string, opts: { size?: number; color?: [number, number, number] } = {}) {
    const size = opts.size ?? 10.5;
    const lineGap = size + 5;
    const maxWidth = PAGE_WIDTH - MARGIN * 2;
    const words = str.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        this.ensureSpace(lineGap);
        this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.font, color: rgb(...(opts.color ?? BODY_COLOR)) });
        this.y -= lineGap;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      this.ensureSpace(lineGap);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.font, color: rgb(...(opts.color ?? BODY_COLOR)) });
      this.y -= lineGap;
    }
    this.y -= 8;
  }

  bulletList(items: string[]) {
    const size = 10.5;
    const lineGap = size + 6;
    const bulletIndent = 14;
    const maxWidth = PAGE_WIDTH - MARGIN * 2 - bulletIndent;
    for (const item of items) {
      const words = item.split(/\s+/);
      let line = "";
      let first = true;
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
          this.ensureSpace(lineGap);
          const x = MARGIN + (first ? 0 : bulletIndent);
          this.page.drawText(first ? `•  ${line}` : line, { x, y: this.y, size, font: this.font, color: rgb(...BODY_COLOR) });
          this.y -= lineGap;
          line = word;
          first = false;
        } else {
          line = candidate;
        }
      }
      if (line) {
        this.ensureSpace(lineGap);
        const x = MARGIN + (first ? 0 : bulletIndent);
        this.page.drawText(first ? `•  ${line}` : line, { x, y: this.y, size, font: this.font, color: rgb(...BODY_COLOR) });
        this.y -= lineGap;
      }
      this.y -= 3;
    }
    this.y -= 6;
  }

  async save() {
    return await this.doc.save();
  }
}

async function buildManual(): Promise<Uint8Array> {
  const pdf = await PdfWriter.create();

  pdf.text("CareMetric CareBase", { size: 30, bold: true, color: TITLE_COLOR, gap: 12 });
  pdf.text("User Manual", { size: 20, bold: true, gap: 20 });
  pdf.text(`${EDITION} — ${EDITION_DATE}`, { size: 11, color: MUTED_COLOR, gap: 6 });
  pdf.text("Multi-Tenant Healthcare Facility Management Platform", { size: 11, color: MUTED_COLOR, gap: 40 });
  pdf.paragraph(
    "This manual is a complete walkthrough of CareMetric CareBase for every role in the system -- " +
      "platform administrators, organization and facility administrators, trainers, employees, and " +
      "auditors. Use the table of contents on the next page to jump straight to the area you need, or " +
      "read start to finish if you're getting oriented for the first time.",
    { size: 11, color: MUTED_COLOR },
  );

  pdf.newPage();
  pdf.heading("Table of Contents", { size: 18 });
  const tocEntries = SECTIONS.map((s, i) => `${i + 1}.  ${s.title}`);
  for (const entry of tocEntries) {
    pdf.text(entry, { size: 11.5, gap: 12 });
  }

  for (const section of SECTIONS) {
    pdf.newPage();
    pdf.heading(section.title);
    for (const paragraph of section.paragraphs) {
      pdf.paragraph(paragraph);
    }
    if (section.bullets?.length) {
      pdf.bulletList(section.bullets);
    }
  }

  const totalPages = pdf.document.getPageCount();
  const footerFont = await pdf.document.embedFont(StandardFonts.Helvetica);
  const pages = pdf.document.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const label = `Page ${i + 1} of ${totalPages}`;
    const size = 8.5;
    const width = footerFont.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: (PAGE_WIDTH - width) / 2,
      y: MARGIN / 2 - 6,
      size,
      font: footerFont,
      color: rgb(...MUTED_COLOR),
    });
  }

  return await pdf.save();
}

async function main() {
  const outPath = fileURLToPath(new URL("../../artifacts/caremetric-carebase/public/CareMetric-CareBase-User-Manual.pdf", import.meta.url));
  const bytes = await buildManual();
  await writeFile(outPath, bytes);
  console.log(`Wrote ${outPath} (${(bytes.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
