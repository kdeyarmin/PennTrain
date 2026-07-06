import { createClient } from "jsr:@supabase/supabase-js@2";
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

function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
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

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

class PdfWriter {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;

  async init() {
    this.doc = await PDFDocument.create();
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
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

function degreeSummary(item: AnyRecord): string {
  if (item.degreePreliminary || item.degreeAllOther) {
    return `Preliminary: ${item.degreePreliminary || "—"}, All Other: ${item.degreeAllOther || "—"}`;
  }
  return item.degree || "—";
}

function planSummary(item: AnyRecord): string {
  const parts: string[] = [];
  if (item.planNotApplicable) return "Plan: N/A";
  if (item.planDescription) parts.push(item.planDescription);
  if (item.planFrequency) parts.push(`Frequency: ${humanize(item.planFrequency)}`);
  if (item.planResponsibleParty) parts.push(`Responsible: ${item.planResponsibleParty}${item.planResponsiblePartyOther ? ` (${item.planResponsiblePartyOther})` : ""}`);
  return parts.length ? parts.join(" — ") : "—";
}

function writeDegreeItem(w: PdfWriter, label: string, item: AnyRecord) {
  w.row(`${label} — Degree: ${degreeSummary(item)}`);
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
  content: AnyRecord;
}): Promise<Uint8Array> {
  const w = new PdfWriter();
  await w.init();
  const content = input.content ?? {};

  w.page.drawText(`Resident ${input.formType}${input.formType === "ASP" ? "" : " (Resident Assessment-Support Plan)"}`, {
    x: MARGIN, y: w.y, size: 17, font: w.bold, color: rgb(0.16, 0.22, 0.44),
  });
  w.y -= 20;
  w.page.drawText(`Version ${input.versionNumber} — ${humanize(input.status)}`, { x: MARGIN, y: w.y, size: 10, font: w.font, color: rgb(0.35, 0.35, 0.35) });
  w.y -= 20;

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
    w.row(`${s.needsDescription || "—"}`);
    w.row(`Plan: ${s.planDescription || "—"}`);
  }
  for (const [key, label] of ADL_ITEMS) {
    writeDegreeItem(w, label, content.section1?.items?.[key] ?? {});
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
    writeDegreeItem(w, label, content.section3?.items?.[key] ?? {});
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
      w.row(`${p.name || "—"} (${p.relationshipToResident || "—"}) — signed ${p.signedDate || "—"}`);
    }
  }

  return await w.doc.save();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
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

  // RLS-scoped read on the caller's own client: resident_assessment_forms_select already gates who
  // can see this form (platform_admin, org_admin/auditor org-wide, facility_manager assigned to its
  // facility) -- no separate authorization check needed here, same pattern as generate-poc-document.
  const { data: form, error: formError } = await callerClient
    .from("resident_assessment_forms")
    .select(
      "id, organization_id, facility_id, resident_id, compliance_item_id, form_type, reason, version_number, status, " +
        "content, prepared_by_name, prepared_by_title, prepared_date, finalized_at, " +
        "facilities(name, license_number, address, city, state, zip), residents(first_name, last_name, date_of_birth, admission_date)",
    )
    .eq("id", formId)
    .maybeSingle();
  if (formError) return json({ error: formError.message }, 500);
  if (!form) return json({ error: "Assessment form not found" }, 404);

  const facility = form.facilities as unknown as {
    name: string; license_number: string | null; address: string | null; city: string | null; state: string | null; zip: string | null;
  } | null;
  const resident = form.residents as unknown as { first_name: string; last_name: string; date_of_birth: string | null; admission_date: string } | null;

  const facilityAddress = facility
    ? [facility.address, facility.city, facility.state, facility.zip].filter(Boolean).join(", ")
    : "—";

  const pdfBytes = await buildAssessmentPdf({
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
    content: (form.content ?? {}) as AnyRecord,
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const path = `${form.organization_id}/${form.facility_id}/${form.resident_id}-${form.form_type.toLowerCase()}-v${form.version_number}-${form.id}.pdf`;

  const { error: uploadError } = await adminClient.storage.from(DOCUMENTS_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  // One resident_documents row per assessment-form version -- delete-then-insert keyed on this
  // form's id (via document_label) so re-generating (e.g. after a draft edit before finalize)
  // doesn't accumulate duplicates, mirroring generate-poc-document's delete-then-insert convention.
  const documentLabel = `resident_assessment_form:${form.id}`;
  await adminClient.from("resident_documents").delete().eq("resident_id", form.resident_id).eq("document_label", documentLabel);
  const { error: docError } = await adminClient.from("resident_documents").insert({
    organization_id: form.organization_id,
    facility_id: form.facility_id,
    resident_id: form.resident_id,
    compliance_item_id: form.compliance_item_id,
    storage_bucket: DOCUMENTS_BUCKET,
    storage_path: path,
    file_name: `${form.form_type} v${form.version_number}.pdf`,
    file_type: "application/pdf",
    document_label: documentLabel,
    uploaded_by_profile_id: callerUser.id,
  });
  if (docError) return json({ error: docError.message }, 500);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  return json({ success: true, url: signedUrlData.signedUrl, path, expiresIn: SIGNED_URL_TTL_SECONDS });
});
