// @ts-nocheck -- retained: npm pdf-lib/canvas modules cause widespread type errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { toWinAnsi } from "../_shared/pdfText.ts";


function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const DOCUMENTS_BUCKET = "violation-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
// One isolate gets 2s of CPU. Five renders is comfortably inside that and a violation with more
// than five unrendered versions at once does not exist outside a backfill.
const MAX_VERSION_RENDERS_PER_REQUEST = 5;
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

// Word-wraps text so no drawn line exceeds maxWidth. A single token wider than maxWidth (e.g. a
// pasted URL) is hard-broken across lines rather than left to overflow -- nothing is ever clipped
// at the page edge.
function wrapTextToLines(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  // toWinAnsi: widthOfTextAtSize throws on non-CP1252 characters (names, pasted narrative)
  // before any draw runs, which 500'd the whole document.
  const words = toWinAnsi(text || "—").split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["—"];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    let remaining = word;
    if (font.widthOfTextAtSize(remaining, size) > maxWidth) {
      if (line) {
        lines.push(line);
        line = "";
      }
      while (remaining.length > 1 && font.widthOfTextAtSize(remaining, size) > maxWidth) {
        let cut = remaining.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(remaining.slice(0, cut), size) > maxWidth) cut--;
        lines.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
      }
      line = remaining;
      continue;
    }
    const candidate = line ? `${line} ${remaining}` : remaining;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = remaining;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
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
    this.page.drawText(toWinAnsi(text), { x: MARGIN, y: this.y, size: 13, font: this.bold, color: rgb(0.16, 0.22, 0.44) });
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
    this.page.drawText(toWinAnsi(value || "—"), { x: MARGIN + 130, y: this.y, size: 10, font: this.font, color: rgb(0.1, 0.1, 0.1) });
    this.y -= 16;
  }

  paragraph(text: string) {
    // Delegate to wrapTextToLines so a single long token (a pasted URL in a violation
    // description) is hard-broken instead of drawn past the page edge and lost in print.
    for (const line of wrapTextToLines(text, PAGE_WIDTH - MARGIN * 2, this.font, 10)) {
      this.ensureSpace(14);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 10, font: this.font });
      this.y -= 14;
    }
    this.y -= 6;
  }

  row(text: string) {
    // Sub-rows arrive prefixed with two spaces; continuation lines stay aligned under that indent.
    const indent = text.match(/^ */)![0];
    const indentWidth = this.font.widthOfTextAtSize(indent, 9.5);
    for (const line of wrapTextToLines(text.slice(indent.length), PAGE_WIDTH - MARGIN * 2 - indentWidth, this.font, 9.5)) {
      this.ensureSpace(14);
      this.page.drawText(line, { x: MARGIN + indentWidth, y: this.y, size: 9.5, font: this.font, color: rgb(0.15, 0.15, 0.15) });
      this.y -= 14;
    }
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
  /** Present only when rendering a frozen plan_of_correction_versions row. */
  version?: {
    versionNumber: number;
    submittedAt: string;
    amendmentReason: string | null;
    snapshotSha256: string | null;
  };
}): Promise<Uint8Array> {
  const w = new PdfWriter();
  await w.init();

  w.page.drawText("Plan of Correction", { x: MARGIN, y: w.y, size: 18, font: w.bold, color: rgb(0.16, 0.22, 0.44) });
  w.y -= 22;
  w.page.drawText(toWinAnsi(`${input.organizationName} — ${input.facilityName}`), { x: MARGIN, y: w.y, size: 11, font: w.font, color: rgb(0.35, 0.35, 0.35) });
  w.y -= 20;

  // A frozen version says so on its face, and carries the digest of the record it was rendered
  // from -- that is what lets a surveyor check this sheet against what the database holds.
  if (input.version) {
    w.heading(`Submitted Version ${input.version.versionNumber}`);
    w.field("Submitted", input.version.submittedAt.slice(0, 10));
    if (input.version.amendmentReason) w.field("Amendment Reason", input.version.amendmentReason);
    if (input.version.snapshotSha256) w.field("Record Digest", `SHA-256 ${input.version.snapshotSha256}`);
    w.paragraph(
      "This document is a rendering of the plan of correction exactly as it was submitted on the " +
        "date above. Later amendments are recorded as further versions and do not change this one.",
    );
  }

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface PocVersionRow {
  id: string;
  violation_id: string;
  organization_id: string;
  facility_id: string;
  version_number: number;
  submitted_at: string;
  amendment_reason: string | null;
  snapshot: Record<string, unknown>;
  snapshot_sha256: string | null;
  pdf_sha256: string | null;
}

/**
 * Renders one frozen version and stamps its path and digest. Everything describing the plan comes
 * from the snapshot, never from the live rows -- that is the whole point of a version. Only the
 * organization and facility names are read live, because they name who filed it rather than what
 * was filed.
 *
 * Idempotent by construction: the object is written with upsert:false, and if it already exists
 * the bytes on disk are hashed rather than replaced, so a re-render can never leave a digest that
 * disagrees with what is stored. record_plan_of_correction_version_pdf refuses a second stamp.
 */
async function renderPocVersion(
  adminClient: ReturnType<typeof createClient>,
  version: PocVersionRow,
  names: { organizationName: string; facilityName: string; citationTopicTitle: string | null },
): Promise<{ path: string; sha256: string }> {
  const snapshotViolation = (version.snapshot?.violation ?? {}) as Record<string, unknown>;
  const snapshotActions = (version.snapshot?.corrective_actions ?? []) as CorrectiveActionRow[];

  const pdfBytes = await buildPocPdf({
    organizationName: names.organizationName,
    facilityName: names.facilityName,
    citationRef: (snapshotViolation.citation_ref as string | null) ?? null,
    citationTopicTitle: names.citationTopicTitle,
    inspectionDate: (snapshotViolation.inspection_date as string) ?? "—",
    surveyorName: (snapshotViolation.surveyor_name as string | null) ?? null,
    description: (snapshotViolation.description as string) ?? "",
    severity: (snapshotViolation.severity as string) ?? "unknown",
    status: (snapshotViolation.status as string) ?? "unknown",
    pocDueDate: (snapshotViolation.poc_due_date as string | null) ?? null,
    correctiveActions: snapshotActions,
    version: {
      versionNumber: version.version_number,
      submittedAt: version.submitted_at,
      amendmentReason: version.amendment_reason,
      snapshotSha256: version.snapshot_sha256,
    },
  });

  // Same org/facility folder shape the bucket's RLS policies read (org first, facility second);
  // the violation folder is what keeps each version beside its siblings.
  const path = `${version.organization_id}/${version.facility_id}/${version.violation_id}/v${version.version_number}.pdf`;

  const { error: uploadError } = await adminClient.storage.from(DOCUMENTS_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: false,
  });

  let storedBytes = pdfBytes;
  if (uploadError) {
    const { data: existing, error: downloadError } = await adminClient.storage
      .from(DOCUMENTS_BUCKET).download(path);
    if (downloadError || !existing) throw new Error(uploadError.message);
    storedBytes = new Uint8Array(await existing.arrayBuffer());
  }

  const sha256 = await sha256Hex(storedBytes);
  const { error: stampError } = await adminClient.rpc("record_plan_of_correction_version_pdf", {
    p_version_id: version.id,
    p_bucket: DOCUMENTS_BUCKET,
    p_path: path,
    p_sha256: sha256,
  });
  if (stampError) throw new Error(stampError.message);

  return { path, sha256 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json(req, { error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json(req, { error: "Caller profile not found or inactive" }, 403);
  }

  // Auditors can read violations, but regenerating a POC PDF overwrites storage and replaces the
  // metadata row via the service-role client. That is a write, and it stays with the roles that
  // already manage Plans of Correction.
  if (!["platform_admin", "org_admin", "facility_manager"].includes(callerProfile.role)) {
    return json(req, { error: "Only organization administrators and facility managers can generate a Plan of Correction document" }, 403);
  }

  let body: { violationId?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const { violationId } = body;
  if (!violationId) return json(req, { error: "violationId is required" }, 400);

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
  if (violationError) return json(req, { error: violationError.message }, 500);
  if (!violation) return json(req, { error: "Violation not found" }, 404);

  const { data: correctiveActions, error: correctiveActionsError } = await callerClient
    .from("corrective_actions")
    .select("description, due_date, completed_date, status, owner_name, course_assignment_id")
    .eq("violation_id", violationId);
  // A POC without its corrective tasks reads as an empty remediation plan -- fail the
  // request instead of rendering an incomplete document on a transient query error.
  if (correctiveActionsError) return json(req, { error: correctiveActionsError.message }, 500);

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

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
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
  if (uploadError) return json(req, { error: uploadError.message }, 500);

  // Update the existing 'poc' row in place when present. Delete-then-insert left a window where
  // insert failure after a successful delete dropped the metadata while storage still held the
  // PDF. Evidence rows (document_type='evidence') are left untouched by filtering on 'poc'.
  const { data: existingPoc, error: existingPocError } = await adminClient
    .from("violation_documents")
    .select("id")
    .eq("violation_id", violationId)
    .eq("document_type", "poc")
    .maybeSingle();
  if (existingPocError) return json(req, { error: existingPocError.message }, 500);

  if (existingPoc?.id) {
    const { error: docError } = await adminClient.from("violation_documents").update({
      storage_bucket: DOCUMENTS_BUCKET,
      storage_path: path,
      file_name: "Plan of Correction.pdf",
      file_type: "application/pdf",
      uploaded_by_profile_id: callerUser.id,
    }).eq("id", existingPoc.id);
    if (docError) return json(req, { error: docError.message }, 500);
  } else {
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
    if (docError) return json(req, { error: docError.message }, 500);
  }

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json(req, { error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  // Back-fill the frozen versions. plan_of_correction_versions has carried pdf_storage_path and
  // pdf_sha256 since 20260801021000 and nothing ever wrote either, so an "immutable version" was a
  // jsonb snapshot with no document beside it while the only PDF in the bucket was this one --
  // overwritten on every regeneration. Every submit calls this function, and so does the Generate
  // button, which is what makes a version missed once (a closed tab, a transient storage error)
  // get its document the next time anyone touches the violation.
  //
  // Capped per request: this isolate has 2s of CPU and pdf-lib is not free. Whatever is left is
  // reported back and picked up on the next invocation.
  const { data: unrenderedVersions, error: versionsError } = await callerClient
    .from("plan_of_correction_versions")
    .select(
      "id, violation_id, organization_id, facility_id, version_number, submitted_at, " +
        "amendment_reason, snapshot, snapshot_sha256, pdf_sha256",
    )
    .eq("violation_id", violationId)
    .is("pdf_sha256", null)
    .order("version_number", { ascending: true });

  let versionsRendered = 0;
  let versionsFailed = 0;
  if (!versionsError) {
    for (const version of (unrenderedVersions ?? []).slice(0, MAX_VERSION_RENDERS_PER_REQUEST)) {
      try {
        await renderPocVersion(adminClient, version as unknown as PocVersionRow, {
          organizationName, facilityName, citationTopicTitle,
        });
        versionsRendered += 1;
      } catch (error) {
        versionsFailed += 1;
        // Recorded on the row rather than only in the log: "pending" on the page has to be able to
        // say whether it is still coming or has stopped coming.
        await adminClient.rpc("record_plan_of_correction_version_pdf_failure", {
          p_version_id: (version as unknown as PocVersionRow).id,
          p_error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const versionsPending = Math.max(
    0,
    (unrenderedVersions?.length ?? 0) - versionsRendered - versionsFailed,
  );

  return json(req, {
    success: true,
    url: signedUrlData.signedUrl,
    path,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    versionsRendered,
    versionsFailed,
    versionsPending,
  });
});
