// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const DOCUMENTS_BUCKET = "resident-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

type StateAssessmentTemplate = { url: string; sourceLabel: string };

const DHS_ASSESSMENT_FORM_TEMPLATES: Record<string, StateAssessmentTemplate> = {
  RASP: {
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Personal_Care_Home-Resident_Assessment_Support_Plan_RASP.pdf",
    sourceLabel: "PA DHS Personal Care Home RASP form",
  },
  ASP: {
    url: "https://www.pa.gov/content/dam/copapwp-pagov/en/dhs/documents/licensing/bhsl-licensing/documents/Assisted_Living-Assessment_Support_Plan_Form.pdf",
    sourceLabel: "PA DHS Assisted Living Facility (ALF) ASP form",
  },
};

async function fetchStateApprovedAssessmentTemplate(formType: string): Promise<{ templateBytes: Uint8Array; template: StateAssessmentTemplate }> {
  const template = DHS_ASSESSMENT_FORM_TEMPLATES[formType];
  if (!template) throw new Error(`No PA DHS state-approved template configured for ${formType}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(template.url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to download ${template.sourceLabel} (${res.status})`);
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("pdf")) {
      throw new Error(`PA DHS template response for ${template.sourceLabel} was not a PDF (${contentType})`);
    }
    return { templateBytes: new Uint8Array(await res.arrayBuffer()), template };
  } finally {
    clearTimeout(timeout);
  }
}

function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatContact(name: string | null, phone: string | null): string {
  if (!name) return "None";
  return phone ? `${name} (${phone})` : name;
}

// Mirrors artifacts/caremetric-train/src/lib/residentAssessmentFormSchema.ts's item lists --
// duplicated here (a Deno edge function can't import from the frontend package) and must stay in
// sync if that file's item lists ever change.
const ADL_ITEMS = [
  ["eating", "Eating"], ["drinking", "Drinking"], ["transferring", "Transferring In/Out of Bed or Chair"],
  ["toileting", "Toileting"], ["bladderManagement", "Bladder Management"], ["bowelManagement", "Bowel Management"],
  ["ambulating", "Ambulating"], ["hygiene", "Personal Hygiene"], ["managingHealthCare", "Managing Health Care"],
  ["securingHealthCare", "Securing Health Care"], ["turningPositioning", "Turning/Positioning in Bed or Chair"],
  ["laundry", "Doing Laundry"], ["shopping", "Shopping"], ["securingTransportation", "Securing/Using Transportation"],
  ["managingFinances", "Managing Finances"], ["telephoneUsage", "Using the Telephone"],
  ["makingAppointments", "Making/Keeping Appointments"], ["caringForPossessions", "Caring for Personal Possessions"],
  ["writtenCorrespondence", "Written Correspondence"], ["socialLeisureActivities", "Social/Leisure Activities"],
  ["prostheticDevice", "Using a Prosthetic Device"], ["obtainingClothing", "Obtaining Clean Seasonal Clothing"],
] as const;
const BEHAVIORAL_SHARED = [
  ["irritability", "Irritability"], ["judgment", "Judgment"], ["agitation", "Agitation"], ["aggression", "Aggression"],
  ["hallucinations", "Hallucinations"], ["communicationOfNeeds", "Communication of Needs"],
  ["understandingInstructions", "Understanding Instructions"], ["shortTermMemory", "Short-Term Memory"],
  ["longTermMemory", "Long-Term Memory"], ["poisonousMaterials", "Ability to Use and Avoid Poisonous Materials"],
] as const;
const BEHAVIORAL_ITEMS_RASP = [["behavioral", "Behavioral"], ...BEHAVIORAL_SHARED] as const;
const BEHAVIORAL_ITEMS_ASP = [
  ["orientation", "Orientation to Time, Place, and Person"], ...BEHAVIORAL_SHARED,
  ["keyLockingDevices", "Ability to Safely Use Key-Locking Devices"],
] as const;
const SENSORY_ITEMS = [
  ["vision", "Vision"], ["hearing", "Hearing"], ["communication", "Communication"],
  ["olfactory", "Olfactory (Smell)"], ["tactile", "Tactile (Touch)"],
] as const;
const SOCIAL_ITEMS = [
  ["interests", "Hobbies/Interests"], ["solitaryActivities", "Enjoyable Solitary Activities"],
  ["groupActivities", "Enjoyable Group Activities"], ["religiousAffiliation", "Religious Affiliation"],
  ["nonParticipationReason", "Reason for Non-Participation"],
] as const;
// Mirrors residentAssessmentFormSchema.ts's COPY_PROVIDED_OPTIONS/NO_SIGNATURE_REASON_OPTIONS
// labels -- a generic humanize() of the raw code would show different wording than what the
// assessor actually saw in the editor's dropdown (e.g. "unable" -> "Unable" instead of "Unable to
// Sign (Medical/Cognitive)").
const COPY_PROVIDED_LABELS: Record<string, string> = { yes: "Yes", no: "No", na: "N/A" };
const NO_SIGNATURE_REASON_LABELS: Record<string, string> = {
  declined: "Resident/Representative Declined",
  unable: "Unable to Sign (Medical/Cognitive)",
  unavailable: "Not Available to Sign",
  other: "Other",
};
// Mirrors residentAssessmentFormSchema.ts's CARE_DEGREE_OPTIONS/BEHAVIORAL_DEGREE_OPTIONS -- same
// A-E letters mean different things in each scale, so both maps are kept distinct rather than
// merged even though their keys overlap.
const CARE_DEGREE_LABELS: Record<string, string> = {
  A: "A — Independent", B: "B — Prompting/Cueing", C: "C — Some Physical Assistance",
  D: "D — Total Physical Assistance", E: "E — Not Applicable",
};
const BEHAVIORAL_DEGREE_LABELS: Record<string, string> = {
  A: "A — No Problem", B: "B — Minimal Problem", C: "C — Moderate Problem",
  D: "D — Severe Problem", E: "E — Not Applicable",
};

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

// Mirrors artifacts/caremetric-train/src/lib/residentAssessmentFormSchema.ts's getIncompleteSections
// -- advisory only, never blocks finalize/PDF export (see that function's comment for why). Printed
// on the PDF itself so a gap left at finalization stays visible on the document DHS/an auditor sees,
// not just in the CareMetric editor.
const SECTION_LABELS: Record<string, string> = {
  info: "Resident & Assessment Info",
  section1: "Personal Care, Supervision, Mobility, Meds",
  section2: "Medical, Dental, Dietary, Sensory",
  section3: "Mental / Behavioral / Cognitive",
  section4: "Social & Recreational",
  summary: "Summary & Participation",
};

function degreeItemAnswered(formType: string, item: AnyRecord): boolean {
  const degreeAnswered = formType === "ASP" ? !!item.degreePreliminary && !!item.degreeAllOther : !!item.degree;
  const needAnswered = !!item.serviceNeedNotApplicable || !!(item.serviceNeedDescription ?? "").trim();
  const planAnswered = !!item.planNotApplicable || !!(item.planDescription ?? "").trim();
  return degreeAnswered && needAnswered && planAnswered;
}

function simpleNeedAnswered(item: AnyRecord): boolean {
  return item.applicable === false || !!(item.description ?? "").trim();
}

function diagnosisRowsAnswered(rows: AnyRecord[] | undefined, none: boolean | undefined): boolean {
  const list = rows ?? [];
  return !!none || (list.length > 0 && list.every((r) => !!(r.description ?? "").trim()));
}

function getIncompleteSections(formType: string, content: AnyRecord): string[] {
  const incomplete: string[] = [];

  if (!content.assessmentInfo?.assessmentReason || !content.assessmentInfo?.supportPlanReason) {
    incomplete.push("info");
  }

  const section1Answered =
    (["supervision", "mobility", "medications"] as const).every((k) =>
      !!(content.section1?.[k]?.needsDescription ?? "").trim() && !!(content.section1?.[k]?.planDescription ?? "").trim())
    && ADL_ITEMS.every(([key]) => degreeItemAnswered(formType, content.section1?.items?.[key] ?? {}));
  if (!section1Answered) incomplete.push("section1");

  const section2Answered =
    diagnosisRowsAnswered(content.section2?.physicalDiagnoses, content.section2?.noPhysicalDiagnoses)
    && diagnosisRowsAnswered(content.section2?.dental, content.section2?.noDental)
    && diagnosisRowsAnswered(content.section2?.dietary, content.section2?.noDietary)
    && SENSORY_ITEMS.every(([key]) => simpleNeedAnswered(content.section2?.sensory?.[key] ?? {}));
  if (!section2Answered) incomplete.push("section2");

  const behavioralList = formType === "ASP" ? BEHAVIORAL_ITEMS_ASP : BEHAVIORAL_ITEMS_RASP;
  const section3Answered =
    diagnosisRowsAnswered(content.section3?.psychologicalDiagnoses, content.section3?.noPsychologicalDiagnoses)
    && behavioralList.every(([key]) => degreeItemAnswered(formType, content.section3?.items?.[key] ?? {}));
  if (!section3Answered) incomplete.push("section3");

  const section4Answered = SOCIAL_ITEMS.every(([key]) => simpleNeedAnswered(content.section4?.items?.[key] ?? {}));
  if (!section4Answered) incomplete.push("section4");

  const summaryAnswered =
    !!(content.summary?.overallWellness ?? "").trim()
    && !!(content.participation?.assessorName ?? "").trim()
    && !!(content.participation?.assessorTitle ?? "").trim()
    && !!(content.participation?.assessorSignedDate ?? "").trim();
  if (!summaryAnswered) incomplete.push("summary");

  return incomplete;
}

class PdfWriter {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;

  async init(templateBytes?: Uint8Array) {
    this.doc = await PDFDocument.create();
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);

    if (templateBytes) {
      const template = await PDFDocument.load(templateBytes);
      const pages = await this.doc.copyPages(template, template.getPageIndices());
      for (const page of pages) this.doc.addPage(page);
    }

    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < MARGIN) this.newPage();
  }

  heading(text: string) {
    this.ensureSpace(28);
    this.y -= 20;
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 13, font: this.bold, color: rgb(0.16, 0.22, 0.44) });
    this.y -= 4;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75, color: rgb(0.16, 0.22, 0.44),
    });
    this.y -= 14;
  }

  subheading(text: string) {
    this.ensureSpace(18);
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 10.5, font: this.bold, color: rgb(0.1, 0.1, 0.1) });
    this.y -= 14;
  }

  field(label: string, value: string) {
    this.ensureSpace(16);
    this.page.drawText(label, { x: MARGIN, y: this.y, size: 9, font: this.bold, color: rgb(0.35, 0.35, 0.35) });
    this.wrapText(value || "—", MARGIN + 150, PAGE_WIDTH - MARGIN - (MARGIN + 150), 10);
  }

  wrapText(text: string, x: number, maxWidth: number, size: number) {
    const words = (text || "—").split(/\s+/);
    let line = "";
    let first = true;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        this.ensureSpace(14);
        this.page.drawText(line, { x, y: this.y, size, font: this.font, color: rgb(0.1, 0.1, 0.1) });
        this.y -= 14;
        line = word;
        first = false;
      } else {
        line = candidate;
      }
    }
    if (line || first) {
      this.ensureSpace(14);
      this.page.drawText(line, { x, y: this.y, size, font: this.font, color: rgb(0.1, 0.1, 0.1) });
      this.y -= 14;
    }
  }

  row(text: string) {
    this.ensureSpace(14);
    this.wrapText(text, MARGIN, PAGE_WIDTH - MARGIN * 2, 9.5);
  }
}

function degreeLabel(labels: Record<string, string>, code: string): string {
  return code ? (labels[code] ?? code) : "—";
}

function degreeSummary(formType: string, item: AnyRecord, labels: Record<string, string>): string {
  // Branch on the authoritative formType, not field truthiness: DegreeItemEditor's onChange always
  // mirrors degree into degreePreliminary (see ResidentAssessmentFormEditor.tsx's DegreeSelect), so a
  // truthy-check on degreePreliminary alone would render RASP items as "Preliminary/All Other" too,
  // when only ASP's doubled Preliminary/All-Other mechanic actually applies.
  if (formType === "ASP") {
    return `Preliminary: ${degreeLabel(labels, item.degreePreliminary)}, All Other: ${degreeLabel(labels, item.degreeAllOther)}`;
  }
  return degreeLabel(labels, item.degree);
}

function planSummary(item: AnyRecord): string {
  const parts: string[] = [];
  if (item.planNotApplicable) return "Plan: N/A";
  if (item.planDescription) parts.push(item.planDescription);
  if (item.planFrequency) parts.push(`Frequency: ${humanize(item.planFrequency)}${item.planFrequencyOther ? ` (${item.planFrequencyOther})` : ""}`);
  if (item.planResponsibleParty) parts.push(`Responsible: ${item.planResponsibleParty}${item.planResponsiblePartyOther ? ` (${item.planResponsiblePartyOther})` : ""}`);
  return parts.length ? parts.join(" — ") : "—";
}

function writeDegreeItem(w: PdfWriter, formType: string, label: string, item: AnyRecord, labels: Record<string, string>) {
  w.row(`${label} — Degree: ${degreeSummary(formType, item, labels)}`);
  if (!item.serviceNeedNotApplicable && item.serviceNeedDescription) w.row(`  Need: ${item.serviceNeedDescription}`);
  w.row(`  ${planSummary(item)}`);
}

function writeSimpleNeedItem(w: PdfWriter, label: string, item: AnyRecord) {
  if (!item.applicable) { w.row(`${label} — Not applicable`); return; }
  w.row(`${label}${item.description ? `: ${item.description}` : ""}`);
  w.row(`  ${planSummary(item)}`);
}

function writeDiagnosisRows(w: PdfWriter, title: string, rows: AnyRecord[], none: boolean) {
  w.subheading(title);
  if (none || !rows?.length) { w.row("None"); return; }
  for (const r of rows) {
    w.row(`${r.description || "—"} — ${planSummary(r)}`);
  }
}

async function buildAssessmentPdf(input: {
  formType: string;
  reason: string;
  versionNumber: number;
  status: string;
  preparedByName: string | null;
  preparedByTitle: string | null;
  preparedDate: string | null;
  finalizedAt: string | null;
  facilityName: string;
  facilityLicenseNumber: string | null;
  facilityAddress: string;
  residentName: string;
  residentDob: string | null;
  admissionDate: string;
  primaryPhysicianName: string | null;
  primaryPhysicianPhone: string | null;
  dentistName: string | null;
  dentistPhone: string | null;
  caseManagerName: string | null;
  caseManagerPhone: string | null;
  designatedPersonName: string | null;
  informalSupports: { name: string; relationship: string | null; phone: string | null }[];
  content: AnyRecord;
}): Promise<{ pdfBytes: Uint8Array; template: StateAssessmentTemplate }> {
  const { templateBytes, template } = await fetchStateApprovedAssessmentTemplate(input.formType);
  const w = new PdfWriter();
  await w.init(templateBytes);
  const content = input.content ?? {};

  w.page.drawText(`CareMetric completion addendum for PA DHS ${input.formType}${input.formType === "ASP" ? "" : " (Resident Assessment-Support Plan)"}`, {
    x: MARGIN, y: w.y, size: 17, font: w.bold, color: rgb(0.16, 0.22, 0.44),
  });
  w.y -= 20;
  w.page.drawText(`Version ${input.versionNumber} — ${humanize(input.status)}`, { x: MARGIN, y: w.y, size: 10, font: w.font, color: rgb(0.35, 0.35, 0.35) });
  w.y -= 20;
  w.page.drawText(`DHS template source: ${template.sourceLabel}`, { x: MARGIN, y: w.y, size: 8.5, font: w.font, color: rgb(0.35, 0.35, 0.35) });
  w.y -= 12;
  w.wrapText(template.url, MARGIN, PAGE_WIDTH - (MARGIN * 2), 8);
  w.y -= 8;

  // The generated artifact starts with the unmodified PA DHS state-approved form pages. CareMetric's
  // structured data follows only as a completion addendum so the document the app creates is the DHS
  // form packet, not a replacement form invented by the product.
  w.row(
    `This packet begins with the official PA DHS ${input.formType} form. The following pages are a `
    + `CareMetric completion addendum generated from the facility's saved entries for that state form.`
  );
  w.y -= 6;

  const incompleteSections = getIncompleteSections(input.formType, content);
  if (incompleteSections.length > 0) {
    w.row(`INCOMPLETE AT FINALIZATION -- sections with unanswered items: ${incompleteSections.map((k) => SECTION_LABELS[k]).join(", ")}.`);
    w.y -= 6;
  }

  w.heading("Facility & Preparer");
  w.field("Facility", input.facilityName);
  w.field("License #", input.facilityLicenseNumber ?? "—");
  w.field("Address", input.facilityAddress);
  w.field("Prepared By", `${input.preparedByName ?? "—"}${input.preparedByTitle ? `, ${input.preparedByTitle}` : ""}`);
  w.field("Prepared Date", input.preparedDate ?? "—");
  if (input.finalizedAt) w.field("Finalized", new Date(input.finalizedAt).toLocaleString());

  w.heading("Part I & II — Resident and Assessment Information");
  w.field("Resident", input.residentName);
  w.field("Date of Birth", input.residentDob ?? "—");
  w.field("Admission Date", input.admissionDate);

  w.subheading("Formal Supports");
  w.row(`Physician: ${formatContact(input.primaryPhysicianName, input.primaryPhysicianPhone)}`);
  w.row(`Dentist: ${formatContact(input.dentistName, input.dentistPhone)}`);
  w.row(`Case Manager: ${formatContact(input.caseManagerName, input.caseManagerPhone)}`);
  if (input.formType === "ASP") w.row(`Designated Person: ${input.designatedPersonName || "None"}`);

  w.subheading("Informal Supports");
  if (!input.informalSupports.length) {
    w.row("None on file");
  } else {
    for (const s of input.informalSupports) {
      w.row(`${s.name}${s.relationship ? ` — ${s.relationship}` : ""}${s.phone ? ` (${s.phone})` : ""}`);
    }
  }

  w.field("Reason for Assessment", humanize(content.assessmentInfo?.assessmentReason));
  w.field("Reason for Support Plan", humanize(content.assessmentInfo?.supportPlanReason));
  w.field("Last Assessment Date", content.assessmentInfo?.lastAssessmentDate || "—");
  w.field("Last Support Plan Date", content.assessmentInfo?.lastSupportPlanDate || "—");
  if (content.assessmentInfo?.changeDescription) w.field("Change Description", content.assessmentInfo.changeDescription);
  if (content.residentInfo?.comments) w.field("Comments", content.residentInfo.comments);

  w.heading("Section 1 — Personal Care Needs, Supervision, Mobility, Medications");
  for (const key of ["supervision", "mobility", "medications"] as const) {
    const s = content.section1?.[key] ?? {};
    w.subheading(humanize(key));
    w.row(`Degree: ${degreeLabel(CARE_DEGREE_LABELS, s.level)}`);
    w.row(`${s.needsDescription || "—"}`);
    w.row(`Plan: ${planSummary(s)}`);
  }
  for (const [key, label] of ADL_ITEMS) {
    writeDegreeItem(w, input.formType, label, content.section1?.items?.[key] ?? {}, CARE_DEGREE_LABELS);
  }

  w.heading("Section 2 — Medical, Dental, Dietary, Sensory Needs");
  writeDiagnosisRows(w, "Physical Medical Diagnoses", content.section2?.physicalDiagnoses ?? [], !!content.section2?.noPhysicalDiagnoses);
  writeDiagnosisRows(w, "Dental Needs", content.section2?.dental ?? [], !!content.section2?.noDental);
  writeDiagnosisRows(w, "Dietary Needs", content.section2?.dietary ?? [], !!content.section2?.noDietary);
  w.subheading("Sensory Needs");
  for (const [key, label] of SENSORY_ITEMS) {
    writeSimpleNeedItem(w, label, content.section2?.sensory?.[key] ?? {});
  }

  w.heading("Section 3 — Mental Health, Behavioral Health, Cognitive Functioning");
  writeDiagnosisRows(w, "Psychological Diagnoses", content.section3?.psychologicalDiagnoses ?? [], !!content.section3?.noPsychologicalDiagnoses);
  const behavioralList = input.formType === "ASP" ? BEHAVIORAL_ITEMS_ASP : BEHAVIORAL_ITEMS_RASP;
  for (const [key, label] of behavioralList) {
    writeDegreeItem(w, input.formType, label, content.section3?.items?.[key] ?? {}, BEHAVIORAL_DEGREE_LABELS);
  }

  w.heading("Section 4 — Social and Recreational Needs");
  for (const [key, label] of SOCIAL_ITEMS) {
    writeSimpleNeedItem(w, label, content.section4?.items?.[key] ?? {});
  }

  w.heading("Part IV — Summary and Determination");
  w.row(content.summary?.overallWellness || "—");

  w.heading("Part V — Participation");
  w.field("Assessor", `${content.participation?.assessorName || "—"}, ${content.participation?.assessorTitle || "—"}`);
  w.field("Date Signed", content.participation?.assessorSignedDate || "—");
  const participants: AnyRecord[] = content.participation?.participants ?? [];
  if (participants.length === 0) {
    w.row("No participants recorded.");
  } else {
    for (const p of participants) {
      const copyPart = p.copyProvided
        ? ` — Copy Provided: ${COPY_PROVIDED_LABELS[p.copyProvided] ?? humanize(p.copyProvided)}${p.copyRequested ? " (Requested)" : ""}`
        : "";
      const reasonPart = !p.signedDate && p.noSignatureReason
        ? ` — Reason Not Signed: ${NO_SIGNATURE_REASON_LABELS[p.noSignatureReason] ?? humanize(p.noSignatureReason)}${p.noSignatureReasonOther ? ` (${p.noSignatureReasonOther})` : ""}`
        : "";
      w.row(`${p.name || "—"} (${p.relationshipToResident || "—"}) — signed ${p.signedDate || "—"}${copyPart}${reasonPart}`);
    }
  }

  return { pdfBytes: await w.doc.save(), template };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient<any>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }

  let body: { formId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { formId } = body;
  if (!formId) return json({ error: "formId is required" }, 400);

  // RLS-scoped read on the caller's own client: resident_assessment_forms_select gates who can even
  // SEE this form (platform_admin, org_admin/auditor org-wide, facility_manager assigned to its
  // facility) -- but that's a read policy, and it includes auditor, who must not be able to trigger
  // a service-role write. Unlike generate-poc-document (which only ever runs against an
  // already-finalized violation record), this function can be pointed at a still-draft form, so a
  // status check and an explicit write-role check are both required before the service-role
  // upload/insert below, mirroring resident_documents_insert's RLS policy exactly.
  const { data: form, error: formError } = await callerClient
    .from("resident_assessment_forms")
    .select(
      "id, organization_id, facility_id, resident_id, compliance_item_id, form_type, reason, version_number, status, " +
        "content, prepared_by_name, prepared_by_title, prepared_date, finalized_at, " +
        "facilities(name, license_number, address, city, state, zip), " +
        "residents(first_name, last_name, date_of_birth, admission_date, primary_physician_name, primary_physician_phone, " +
        "dentist_name, dentist_phone, case_manager_name, case_manager_phone, designated_person_name)",
    )
    .eq("id", formId)
    .maybeSingle();
  if (formError) return json({ error: formError.message }, 500);
  if (!form) return json({ error: "Assessment form not found" }, 404);

  if (form.status !== "finalized") {
    return json({ error: "Only finalized assessment forms can be exported to PDF" }, 400);
  }

  const isPlatformAdmin = callerProfile.role === "platform_admin";
  const isOrgAdminInOrg = callerProfile.role === "org_admin" && callerProfile.organization_id === form.organization_id;
  let hasWriteAccess = isPlatformAdmin || isOrgAdminInOrg;
  if (!hasWriteAccess && callerProfile.role === "facility_manager" && callerProfile.organization_id === form.organization_id) {
    const { data: assignment } = await callerClient
      .from("facility_assignments")
      .select("id")
      .eq("profile_id", callerUser.id)
      .eq("facility_id", form.facility_id)
      .maybeSingle();
    hasWriteAccess = !!assignment;
  }
  if (!hasWriteAccess) {
    return json({ error: "Not authorized to generate this document" }, 403);
  }

  // Finalizing locks the form's own content, but Part-I fields (resident DOB, physician/dentist/
  // case-manager contact info, informal supports) are pulled live from residents/
  // resident_informal_supports at generation time, not snapshotted. Without this check, retrying
  // generation after that live data later changes would silently produce a different PDF for an
  // already-finalized, supposedly-locked document -- so once a document has been generated for this
  // form once, refuse to regenerate it rather than let it drift. This intentionally only covers the
  // "finalize succeeded, PDF generation then failed" retry case this endpoint exists for.
  const documentLabel = `resident_assessment_form:${form.id}`;
  const { data: existingDocument, error: existingDocumentError } = await callerClient
    .from("resident_documents")
    .select("id")
    .eq("resident_id", form.resident_id)
    .eq("document_label", documentLabel)
    .maybeSingle();
  if (existingDocumentError) return json({ error: existingDocumentError.message }, 500);
  if (existingDocument) {
    return json({
      error: "A document has already been generated for this finalized form. Contact an administrator if it needs to be replaced.",
    }, 409);
  }

  const facility = form.facilities as unknown as {
    name: string; license_number: string | null; address: string | null; city: string | null; state: string | null; zip: string | null;
  } | null;
  const resident = form.residents as unknown as {
    first_name: string; last_name: string; date_of_birth: string | null; admission_date: string;
    primary_physician_name: string | null; primary_physician_phone: string | null;
    dentist_name: string | null; dentist_phone: string | null;
    case_manager_name: string | null; case_manager_phone: string | null;
    designated_person_name: string | null;
  } | null;

  const facilityAddress = facility
    ? [facility.address, facility.city, facility.state, facility.zip].filter(Boolean).join(", ")
    : "—";

  // Part I "Informal Supports" (up to 5 rows both forms ask for) -- a resident-scoped child table,
  // not embedded in resident_assessment_forms.content since it's a live resident fact, not a
  // per-version assessment answer.
  const { data: informalSupports, error: supportsError } = await callerClient
    .from("resident_informal_supports")
    .select("name, relationship, phone")
    .eq("resident_id", form.resident_id)
    .order("sort_order");
  if (supportsError) return json({ error: supportsError.message }, 500);

  const { pdfBytes, template } = await buildAssessmentPdf({
    formType: form.form_type,
    reason: form.reason,
    versionNumber: form.version_number,
    status: form.status,
    preparedByName: form.prepared_by_name,
    preparedByTitle: form.prepared_by_title,
    preparedDate: form.prepared_date,
    finalizedAt: form.finalized_at,
    facilityName: facility?.name ?? "—",
    facilityLicenseNumber: facility?.license_number ?? null,
    facilityAddress,
    residentName: resident ? `${resident.last_name}, ${resident.first_name}` : "—",
    residentDob: resident?.date_of_birth ?? null,
    admissionDate: resident?.admission_date ?? "—",
    primaryPhysicianName: resident?.primary_physician_name ?? null,
    primaryPhysicianPhone: resident?.primary_physician_phone ?? null,
    dentistName: resident?.dentist_name ?? null,
    dentistPhone: resident?.dentist_phone ?? null,
    caseManagerName: resident?.case_manager_name ?? null,
    caseManagerPhone: resident?.case_manager_phone ?? null,
    designatedPersonName: resident?.designated_person_name ?? null,
    informalSupports: informalSupports ?? [],
    content: (form.content ?? {}) as AnyRecord,
  });

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const path = `${form.organization_id}/${form.facility_id}/${form.resident_id}-${form.form_type.toLowerCase()}-v${form.version_number}-${form.id}.pdf`;

  const { error: uploadError } = await adminClient.storage.from(DOCUMENTS_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  // One resident_documents row per assessment-form version -- the existence check above already
  // guarantees no row with this document_label exists yet, so this is always a fresh insert. The PDF
  // starts with the official PA DHS form pages and is therefore flagged as the state form created by
  // the app; the RPC below then completes the linked compliance item with that exact document.
  const { data: insertedDocument, error: docError } = await adminClient.from("resident_documents").insert({
    organization_id: form.organization_id,
    facility_id: form.facility_id,
    resident_id: form.resident_id,
    compliance_item_id: form.compliance_item_id,
    storage_bucket: DOCUMENTS_BUCKET,
    storage_path: path,
    file_name: `PA DHS ${form.form_type} v${form.version_number}.pdf`,
    file_type: "application/pdf",
    document_label: documentLabel,
    uploaded_by_profile_id: callerUser.id,
    is_state_form: true,
    state_form_source_label: template.sourceLabel,
    state_form_source_url: template.url,
  })
    .select("id")
    .single();
  if (docError) {
    await adminClient.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return json({ error: docError.message }, 500);
  }

  if (form.compliance_item_id && insertedDocument?.id) {
    const { error: completeError } = await callerClient.rpc("complete_resident_compliance_item", {
      p_item_id: form.compliance_item_id,
      p_document_id: insertedDocument.id,
    });
    if (completeError) {
      await adminClient.from("resident_documents").delete().eq("id", insertedDocument.id);
      await adminClient.storage.from(DOCUMENTS_BUCKET).remove([path]);
      return json({ error: completeError.message }, 500);
    }
  }

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  return json({ success: true, url: signedUrlData.signedUrl, path, documentId: insertedDocument?.id, expiresIn: SIGNED_URL_TTL_SECONDS });
});
