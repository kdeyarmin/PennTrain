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

const DOCUMENTS_BUCKET = "violation-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

interface CorrectiveActionRow {
  description: string;
  due_date: string;
  completed_date: string | null;
  status: string;
  owner_name: string | null;
  course_assignment_id: string | null;
}

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

  field(label: string, value: string) {
    this.ensureSpace(16);
    this.page.drawText(label, { x: MARGIN, y: this.y, size: 9, font: this.bold, color: rgb(0.35, 0.35, 0.35) });
    this.page.drawText(value || "—", { x: MARGIN + 130, y: this.y, size: 10, font: this.font, color: rgb(0.1, 0.1, 0.1) });
    this.y -= 16;
  }

  paragraph(text: string) {
    const maxWidth = PAGE_WIDTH - MARGIN * 2;
    const words = (text || "—").split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.font.widthOfTextAtSize(candidate, 10) > maxWidth && line) {
        this.ensureSpace(14);
        this.page.drawText(line, { x: MARGIN, y: this.y, size: 10, font: this.font });
        this.y -= 14;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      this.ensureSpace(14);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 10, font: this.font });
      this.y -= 14;
    }
    this.y -= 6;
  }

  row(text: string) {
    this.ensureSpace(14);
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 9.5, font: this.font, color: rgb(0.15, 0.15, 0.15) });
    this.y -= 14;
  }
}

async function buildPocPdf(input: {
  organizationName: string;
  facilityName: string;
  citationRef: string | null;
  citationTopicTitle: string | null;
  inspectionDate: string;
  surveyorName: string | null;
  description: string;
  severity: string;
  status: string;
  pocDueDate: string | null;
  correctiveActions: CorrectiveActionRow[];
}): Promise<Uint8Array> {
  const w = new PdfWriter();
  await w.init();

  w.page.drawText("Plan of Correction", { x: MARGIN, y: w.y, size: 18, font: w.bold, color: rgb(0.16, 0.22, 0.44) });
  w.y -= 22;
  w.page.drawText(`${input.organizationName} — ${input.facilityName}`, { x: MARGIN, y: w.y, size: 11, font: w.font, color: rgb(0.35, 0.35, 0.35) });
  w.y -= 20;

  w.heading("Cited Violation");
  w.field("Citation", input.citationRef ?? (input.citationTopicTitle ?? "—"));
  w.field("Topic", input.citationTopicTitle ?? "—");
  w.field("Inspection Date", input.inspectionDate);
  w.field("Surveyor", input.surveyorName ?? "—");
  w.field("Severity", humanize(input.severity));
  w.field("Status", humanize(input.status));
  w.field("POC Due Date", input.pocDueDate ?? "—");

  w.heading("Violation Description");
  w.paragraph(input.description);

  w.heading("Plan of Correction — Corrective Tasks");
  if (input.correctiveActions.length === 0) {
    w.row("No corrective tasks recorded yet.");
  } else {
    for (const ca of input.correctiveActions) {
      w.row(`${ca.description} — ${humanize(ca.status)} — due ${ca.due_date}${ca.completed_date ? `, completed ${ca.completed_date}` : ""}`);
      if (ca.owner_name) w.row(`  Responsible party: ${ca.owner_name}`);
      if (ca.course_assignment_id) w.row(`  Linked retraining assignment on file.`);
    }
  }

  w.heading("Documentation for Follow-Up Visit");
  w.paragraph(
    "Supporting documentation (corrected policies, training completion records, photos, invoices, etc.) is tracked " +
      "alongside this Plan of Correction in the app and made available to the surveyor at the follow-up visit.",
  );

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

  let body: { violationId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { violationId } = body;
  if (!violationId) return json({ error: "violationId is required" }, 400);

  // RLS-scoped read on the caller's own client: dhs_violations_select already gates who can see
  // this violation (platform_admin, org_admin/auditor org-wide, facility_manager assigned to its
  // facility) -- no separate authorization check needed here.
  const { data: violation, error: violationError } = await callerClient
    .from("dhs_violations")
    .select(
      "id, organization_id, facility_id, citation_ref, inspection_date, surveyor_name, description, severity, status, poc_due_date, " +
        "organizations(name), facilities(name), dhs_citation_topics(title)",
    )
    .eq("id", violationId)
    .maybeSingle();
  if (violationError) return json({ error: violationError.message }, 500);
  if (!violation) return json({ error: "Violation not found" }, 404);

  const { data: correctiveActions } = await callerClient
    .from("corrective_actions")
    .select("description, due_date, completed_date, status, owner_name, course_assignment_id")
    .eq("violation_id", violationId);

  const organizationName = (violation.organizations as unknown as { name: string } | null)?.name ?? "";
  const facilityName = (violation.facilities as unknown as { name: string } | null)?.name ?? "";
  const citationTopicTitle = (violation.dhs_citation_topics as unknown as { title: string } | null)?.title ?? null;

  const pdfBytes = await buildPocPdf({
    organizationName,
    facilityName,
    citationRef: violation.citation_ref,
    citationTopicTitle,
    inspectionDate: violation.inspection_date,
    surveyorName: violation.surveyor_name,
    description: violation.description,
    severity: violation.severity,
    status: violation.status,
    pocDueDate: violation.poc_due_date,
    correctiveActions: (correctiveActions ?? []) as unknown as CorrectiveActionRow[],
  });

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  // Path shape (org/facility/...) matches the "violation-documents" bucket's RLS policies, which
  // read the facility id out of the second folder segment -- see
  // supabase/migrations/..._violation_documents_storage_bucket.sql.
  const path = `${violation.organization_id}/${violation.facility_id}/${violation.id}-poc.pdf`;

  // Always regenerated (upsert:true) -- a POC in draft changes as corrective tasks are added,
  // matching generate-incident-report-pdf's "living document" convention rather than
  // generate-certificate-pdf's cache-once behavior for an immutable issued certificate.
  const { error: uploadError } = await adminClient.storage.from(DOCUMENTS_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  // Keep exactly one 'poc' document row per violation (the generated PDF supersedes any prior
  // draft) -- delete-then-insert rather than upsert since there's no natural conflict key besides
  // violation_id, and evidence rows (document_type='evidence') must be left untouched.
  await adminClient.from("violation_documents").delete().eq("violation_id", violationId).eq("document_type", "poc");
  const { error: docError } = await adminClient.from("violation_documents").insert({
    organization_id: violation.organization_id,
    facility_id: violation.facility_id,
    violation_id: violationId,
    storage_bucket: DOCUMENTS_BUCKET,
    storage_path: path,
    file_name: "Plan of Correction.pdf",
    file_type: "application/pdf",
    document_type: "poc",
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
