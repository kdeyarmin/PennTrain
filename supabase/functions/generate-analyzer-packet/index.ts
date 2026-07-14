// @ts-nocheck
// Renders the approved document-analyzer forms into a single export/print packet PDF.
// Platform_admin only: the caller-scoped read of document_analyzer_jobs (platform_admin
// RLS) is the authorization proof before the service-role client stores the packet and
// signs its URL. Only approved rows can be exported -- approval is the human gate the
// review workflow enforces upstream -- and the packet renders the reviewed draft, never
// raw AI output.
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const ANALYZER_BUCKET = "state-form-analyzer";
const SIGNED_URL_TTL_SECONDS = 600;
const MAX_PACKET_JOBS = 200;

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

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

function truncate(str: string, maxWidth: number, font: PDFFont, size: number) {
  let s = str;
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth - 6) {
    s = s.slice(0, -1);
  }
  return s === str ? s : s.slice(0, -1) + "…";
}

// Extracted handwriting transcriptions routinely carry characters outside WinAnsi (check
// marks, smart punctuation from OCR, accented names beyond Latin-1); pdf-lib's standard
// Helvetica throws on the first such character, which would fail the whole packet.
// Substitute rather than crash -- the reviewer approved the on-screen text; the PDF marks
// what it cannot render.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ ");
function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "  ")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WINANSI_EXTRA.has(ch)) {
      out += ch;
    } else if (ch === "✓" || ch === "✔" || ch === "☑") {
      out += "[x]";
    } else if (ch === "☐" || ch === "☒") {
      out += "[ ]";
    } else {
      out += "?";
    }
  }
  return out;
}

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }
      // A single unbroken token wider than the line (long IDs, run-together scans) would
      // silently run past the page edge -- break it at character level instead.
      let chunk = "";
      for (const ch of word) {
        if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
  }
  return lines;
}

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
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    return new PdfWriter(doc, font, bold, page, PAGE_HEIGHT - MARGIN);
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  text(str: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const [r, g, b] = opts.color ?? [0, 0, 0];
    const maxWidth = PAGE_WIDTH - MARGIN * 2;
    for (const line of wrapText(toWinAnsi(str), maxWidth, font, size)) {
      this.ensureSpace(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color: rgb(r, g, b) });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 3;
  }

  heading(str: string) {
    this.ensureSpace(34);
    this.y -= 10;
    this.text(str, { size: 13, bold: true, gap: 8 });
  }

  field(label: string, value: string) {
    this.text(`${label}: ${value || "—"}`, { size: 10, gap: 2 });
  }

  divider() {
    this.ensureSpace(14);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 4 },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y + 4 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    this.y -= 10;
  }

  table(headers: string[], rows: string[][], widths: number[]) {
    const size = 8.5;
    const rowHeight = size + 7;
    const drawRow = (cells: string[], bold: boolean) => {
      this.ensureSpace(rowHeight);
      let x = MARGIN;
      const font = bold ? this.bold : this.font;
      for (let i = 0; i < cells.length; i++) {
        const w = widths[i];
        this.page.drawText(truncate(toWinAnsi(cells[i] ?? ""), w, font, size), { x, y: this.y, size, font, color: rgb(0, 0, 0) });
        x += w;
      }
      this.y -= rowHeight;
    };
    drawRow(headers, true);
    this.ensureSpace(2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + rowHeight - 4 },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y + rowHeight - 4 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    for (const row of rows) drawRow(row, false);
  }

  async save() {
    return await this.doc.save();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const callerClient = createClient<any>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, is_active, first_name, last_name")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }
  if (callerProfile.role !== "platform_admin") {
    return json({ error: "not authorized to export analyzer packets" }, 403);
  }
  if (!serviceRoleKey) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, 500);

  let body: { job_ids?: string[] } = {};
  if (req.headers.get("content-length") !== "0") {
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
  }
  // A provided-but-degenerate filter (empty array, non-strings) must never widen into an
  // export-everything request -- validate instead of sanitize.
  let requestedIds: string[] | null = null;
  if (body.job_ids !== undefined) {
    if (
      !Array.isArray(body.job_ids)
      || body.job_ids.length === 0
      || body.job_ids.some((id) => typeof id !== "string" || id.length === 0)
    ) {
      return json({ error: "job_ids must be a non-empty array of job ids" }, 400);
    }
    requestedIds = Array.from(new Set(body.job_ids));
    if (requestedIds.length > MAX_PACKET_JOBS) {
      return json({ error: `A packet can include at most ${MAX_PACKET_JOBS} forms; export in smaller batches.` }, 400);
    }
  }

  let jobsQuery = callerClient
    .from("document_analyzer_jobs")
    .select(
      "id, file_name, resident_name, facility_name, state_form_template, review_due_date, " +
        "admission_date, notes, issues, confidence, page_count, model, approved_for_export, " +
        "approved_by, approved_at, facility_id, chart_resident_id, created_at",
      { count: "exact" },
    )
    .eq("approved_for_export", true)
    .order("approved_at", { ascending: true })
    .limit(MAX_PACKET_JOBS);
  if (requestedIds) jobsQuery = jobsQuery.in("id", requestedIds);
  const { data: jobs, error: jobsError, count: approvedCount } = await jobsQuery;
  if (jobsError) return json({ error: jobsError.message }, 500);
  if (!jobs || jobs.length === 0) {
    return json({ error: "No approved forms to export. Approve at least one reviewed form first." }, 400);
  }
  if (requestedIds && jobs.length !== requestedIds.length) {
    return json({ error: "Every requested form must exist and be approved for export" }, 409);
  }
  const totalApproved = approvedCount ?? jobs.length;
  const omittedCount = Math.max(0, totalApproved - jobs.length);

  const approverIds = Array.from(new Set(jobs.map((j) => j.approved_by).filter(Boolean)));
  const facilityIds = Array.from(new Set(jobs.map((j) => j.facility_id).filter(Boolean)));
  const [approversRes, facilitiesRes] = await Promise.all([
    approverIds.length > 0
      ? callerClient.from("profiles").select("id, first_name, last_name").in("id", approverIds)
      : Promise.resolve({ data: [], error: null }),
    facilityIds.length > 0
      ? callerClient.from("facilities").select("id, name").in("id", facilityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (approversRes.error) return json({ error: approversRes.error.message }, 500);
  if (facilitiesRes.error) return json({ error: facilitiesRes.error.message }, 500);
  const approverById = new Map((approversRes.data ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  const facilityById = new Map((facilitiesRes.data ?? []).map((f) => [f.id, f.name]));

  const pdf = await PdfWriter.create();
  const generatedAt = new Date().toISOString();

  pdf.text("State Form Conversion Packet", { size: 20, bold: true, gap: 4 });
  pdf.text("Approved historical state forms converted to current templates", { size: 11, gap: 12 });
  pdf.text(`Generated: ${generatedAt}`, { size: 9, color: [0.4, 0.4, 0.4], gap: 1 });
  pdf.text(`Requested by: ${callerProfile.first_name} ${callerProfile.last_name} (platform admin)`, {
    size: 9,
    color: [0.4, 0.4, 0.4],
    gap: 1,
  });
  pdf.text(`Forms included: ${jobs.length}`, { size: 9, color: [0.4, 0.4, 0.4], gap: 6 });
  if (omittedCount > 0) {
    pdf.text(
      `NOTE: ${omittedCount} additional approved form${omittedCount === 1 ? "" : "s"} did not fit this packet's `
        + `${MAX_PACKET_JOBS}-form limit and are NOT included. Export again with a narrower selection to cover them.`,
      { size: 9, bold: true, gap: 4 },
    );
  }
  pdf.text(
    "Each form below was extracted from a scanned historical document, corrected during "
      + "super-admin review, and explicitly approved for export. Verify against the original "
      + "scan before filing with the Department of Human Services.",
    { size: 8, color: [0.5, 0.5, 0.5], gap: 4 },
  );

  // Cover roster: which resident each converted document in this packet belongs to,
  // in the same order as the pages that follow.
  pdf.heading("Documents in this packet");
  pdf.table(
    ["#", "Resident", "State form", "Facility", "Review due"],
    jobs.map((job, index) => [
      String(index + 1),
      job.resident_name || "—",
      job.state_form_template || "—",
      (job.facility_id ? facilityById.get(job.facility_id) : undefined) ?? job.facility_name ?? "—",
      job.review_due_date || "—",
    ]),
    [24, 130, 150, 120, 80],
  );

  for (const job of jobs) {
    pdf.newPage();
    pdf.text(job.state_form_template || "State form", { size: 15, bold: true, gap: 4 });
    pdf.text(`Converted from: ${job.file_name}`, { size: 9, color: [0.4, 0.4, 0.4], gap: 8 });

    pdf.field("Resident name", job.resident_name);
    pdf.field("Facility (as written on form)", job.facility_name);
    pdf.field("System facility", job.facility_id ? (facilityById.get(job.facility_id) ?? "—") : "—");
    pdf.field("Review due date", job.review_due_date);
    pdf.field("Admission date", job.admission_date ?? "");
    pdf.field("Resident chart", job.chart_resident_id ? `Linked (${job.chart_resident_id})` : "Not linked");

    pdf.heading("Transferred handwritten notes and corrections");
    pdf.text(job.notes || "—", { size: 9.5, gap: 4 });

    const issues = Array.isArray(job.issues) ? job.issues : [];
    if (issues.length > 0) {
      pdf.heading(`Reviewer verifications (${issues.length})`);
      for (const issue of issues) {
        const field = typeof issue?.field === "string" ? issue.field : "document";
        const message = typeof issue?.message === "string" ? issue.message : "";
        pdf.text(`• [${field}] ${message}`, { size: 9, gap: 1 });
      }
      pdf.text("", { gap: 2 });
    }

    pdf.divider();
    pdf.text(
      `Extraction: ${job.model ?? "—"} · confidence ${job.confidence ?? "—"}% · ${job.page_count ?? "—"} page(s)`,
      { size: 8, color: [0.5, 0.5, 0.5], gap: 1 },
    );
    const approver = job.approved_by ? (approverById.get(job.approved_by) ?? "platform admin") : "platform admin";
    const approvedAt = job.approved_at ? new Date(job.approved_at).toISOString() : "—";
    pdf.text(`Approved for export by ${approver} at ${approvedAt}`, { size: 8, color: [0.5, 0.5, 0.5] });
  }

  const pdfBytes = await pdf.save();
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  // Deterministic per-admin path: re-exports overwrite instead of accumulating orphaned
  // PHI-bearing objects; each generation is still recorded in audit_logs below.
  const path = `exports/packet-${callerUser.id}.pdf`;
  const { error: uploadError } = await adminClient.storage
    .from(ANALYZER_BUCKET)
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(ANALYZER_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  // The deterministic path above means each re-export overwrites the previous packet
  // object, so this audit row is the only durable record of the generation. If it cannot
  // be written, withhold the download link rather than hand out an unrecorded PHI export.
  const { error: auditError } = await adminClient.from("audit_logs").insert({
    organization_id: null,
    actor_profile_id: callerUser.id,
    entity_type: "document_analyzer_packet",
    entity_id: path,
    action: "generated",
    new_values: { job_ids: jobs.map((j) => j.id), storage_path: path },
  });
  if (auditError) {
    return json({ error: `The packet was generated but could not be recorded in the audit log (${auditError.message}). The download link is withheld until the export can be audited.` }, 500);
  }

  return json({
    success: true,
    url: signedUrlData.signedUrl,
    path,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    jobCount: jobs.length,
    omittedCount,
  });
});
