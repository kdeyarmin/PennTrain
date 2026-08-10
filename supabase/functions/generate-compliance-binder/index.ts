// @ts-nocheck -- retained: npm pdf-lib/canvas modules cause widespread type errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { CRON_SECRET_HEADER, requireCronRequest } from "../_shared/cronAuth.ts";
import { paToday } from "../_shared/paDay.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { facilityTypeLabel } from "../_shared/facilityTypes.ts";

const BINDER_JOB_KEY = "binder-export-generation";
const BINDER_BUCKET = "binder-exports";
const SIGNED_URL_TTL_SECONDS = 600;


function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const MAX_LISTED_ROWS = 500;

// Every facility this app serves is in Pennsylvania (America/New_York) -- binder
// timestamps must render in that zone explicitly rather than the Deno runtime's
// default (UTC on Supabase), which would date evening incidents and signatures one
// day late and contradict the DHS state form generated from the same records.
const PA_TIME_ZONE = "America/New_York";

const STATUS_LABELS: Record<string, string> = {
  compliant: "Compliant",
  due_soon: "Due Soon",
  expired: "Expired",
  missing: "Missing",
  not_applicable: "N/A",
  pending_review: "Pending Review",
};

function truncate(str: string, maxWidth: number, font: PDFFont, size: number) {
  let s = str;
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth - 6) {
    s = s.slice(0, -1);
  }
  return s === str ? s : s.slice(0, -1) + "…";
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
      // A single unbroken token wider than the line (long IDs, pasted URLs) would
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
  private tocEntries: { title: string; page: number }[] = [];
  private cover: { orgName: string; subtitle: string; meta: string[] } | null = null;

  private constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private page: PDFPage,
    private y: number,
    private tocPage: PDFPage,
  ) {}

  static async create() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    // Reserve the first page for the cover + table of contents; content starts on page 2.
    const tocPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    return new PdfWriter(doc, font, bold, page, PAGE_HEIGHT - MARGIN, tocPage);
  }

  setCover(orgName: string, subtitle: string, meta: string[]) {
    this.cover = { orgName, subtitle, meta };
  }

  private ensureSpace(height: number) {
    if (this.y - height < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  text(str: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const [r, g, b] = opts.color ?? [0, 0, 0];
    // Word-wrap to the drawable width -- a single drawText would clip long strings
    // (readiness caveats, appendix notes) at the page edge. The gap applies once,
    // after the last line, so callers' vertical rhythm is unchanged.
    const lines = wrapText(str, PAGE_WIDTH - MARGIN * 2, font, size);
    for (let i = 0; i < lines.length; i++) {
      this.ensureSpace(size + 4);
      this.page.drawText(lines[i], { x: MARGIN, y: this.y, size, font, color: rgb(r, g, b) });
      this.y -= size + (i === lines.length - 1 ? (opts.gap ?? 6) : 3);
    }
  }

  heading(str: string) {
    this.ensureSpace(34);
    this.y -= 10;
    this.text(str, { size: 13, bold: true, gap: 10 });
    // Record the 1-based page this heading landed on for the table of contents (page 1 is the
    // reserved cover/TOC page, so content headings resolve to page 2+).
    this.tocEntries.push({ title: str, page: this.doc.getPages().indexOf(this.page) + 1 });
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
        this.page.drawText(truncate(cells[i] ?? "", w, font, size), { x, y: this.y, size, font, color: rgb(0, 0, 0) });
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

  // Draws the cover title block and a table of contents onto the reserved first page. The cover is
  // drawn first (plain drawText, effectively never throws), so a later failure never leaves a blank
  // page. Assumes the TOC fits on one page (binders have ~15 sections); extra entries are dropped.
  private renderFrontMatter() {
    const p = this.tocPage;
    let y = PAGE_HEIGHT - MARGIN;
    if (this.cover) {
      p.drawText(this.cover.orgName, { x: MARGIN, y, size: 20, font: this.bold, color: rgb(0, 0, 0) });
      y -= 26;
      p.drawText(this.cover.subtitle, { x: MARGIN, y, size: 14, font: this.font, color: rgb(0, 0, 0) });
      y -= 22;
      for (const line of this.cover.meta) {
        p.drawText(line, { x: MARGIN, y, size: 9, font: this.font, color: rgb(0.4, 0.4, 0.4) });
        y -= 13;
      }
      y -= 16;
    }
    p.drawText("Table of Contents", { x: MARGIN, y, size: 14, font: this.bold, color: rgb(0, 0, 0) });
    y -= 20;
    for (const entry of this.tocEntries) {
      if (y < MARGIN + 16) break;
      const num = String(entry.page);
      const numWidth = this.font.widthOfTextAtSize(num, 10);
      const title = truncate(entry.title, PAGE_WIDTH - 2 * MARGIN - numWidth - 16, this.font, 10);
      p.drawText(title, { x: MARGIN, y, size: 10, font: this.font, color: rgb(0.1, 0.1, 0.1) });
      p.drawText(num, { x: PAGE_WIDTH - MARGIN - numWidth, y, size: 10, font: this.font, color: rgb(0.1, 0.1, 0.1) });
      y -= 15;
    }
  }

  private drawFooters() {
    const pages = this.doc.getPages();
    const total = pages.length;
    for (let i = 0; i < total; i++) {
      const label = `Page ${i + 1} of ${total}`;
      const w = this.font.widthOfTextAtSize(label, 8);
      pages[i].drawText(label, { x: PAGE_WIDTH - MARGIN - w, y: 24, size: 8, font: this.font, color: rgb(0.5, 0.5, 0.5) });
    }
  }

  async save() {
    // Both are best-effort: a failure here must never lose the assembled binder content.
    try { this.renderFrontMatter(); } catch (_e) { /* keep the binder without a TOC */ }
    try { this.drawFooters(); } catch (_e) { /* page numbers are best-effort */ }
    return await this.doc.save();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Compliance binder worker is missing required Supabase environment variables");
    return json(req, { error: "Service is not configured" }, 500);
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Cron worker path: claim queued binder_export_jobs, render, store, finish.
  if (req.headers.has(CRON_SECRET_HEADER)) {
    const denied = requireCronRequest(req, corsHeadersForRequest(req));
    if (denied) return denied;
    return await runWorkerBatch(req, adminClient);
  }

  // User paths (caller-authorized): enqueue an export, or fetch a finished export's URL.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json(req, { error: "Invalid or expired session" }, 401);

  let body: { job_id?: string; organization_id?: string; facility_id?: string; facility_ids?: string[] } = {};
  if (req.headers.get("content-length") !== "0") {
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
  }

  if (body.job_id) {
    // Download path: RLS on binder_export_jobs proves the caller may see this export
    // before the service-role client signs the stored object.
    const { data: job, error: jobError } = await callerClient
      .from("binder_export_jobs")
      .select("id, status, storage_bucket, storage_path, last_error_message, organization_id")
      .eq("id", body.job_id)
      .maybeSingle();
    if (jobError) return json(req, { error: jobError.message }, 500);
    if (!job) return json(req, { error: "binder export not found" }, 404);
    if (job.status === "failed") {
      return json(req, { success: false, status: "failed", error: job.last_error_message ?? "Binder generation failed" }, 200);
    }
    if (job.status !== "succeeded" || !job.storage_path) {
      return json(req, { success: true, status: job.status }, 202);
    }
    const bucket = job.storage_bucket ?? BINDER_BUCKET;
    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
      .from(bucket)
      .createSignedUrl(job.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signedUrlError || !signedUrlData) {
      return json(req, { error: signedUrlError?.message ?? "failed to create signed url" }, 500);
    }

    const appendixPrefix = `${job.organization_id}/${job.id}-appendix`;
    let appendix: {
      manifestUrl?: string;
      sections: Array<{ key: string; title: string; included: number; total: number; csvUrl?: string }>;
    } | null = null;
    try {
      const { data: manifestBlob, error: manifestError } = await adminClient.storage
        .from(bucket)
        .download(`${appendixPrefix}/manifest.json`);
      if (!manifestError && manifestBlob) {
        const manifest = JSON.parse(await manifestBlob.text()) as {
          sections?: Array<{ key: string; title: string; included: number; total: number; csvPath: string }>;
        };
        const sections = [];
        for (const section of manifest.sections ?? []) {
          const { data: signedCsv } = await adminClient.storage
            .from(bucket)
            .createSignedUrl(section.csvPath, SIGNED_URL_TTL_SECONDS);
          sections.push({
            key: section.key,
            title: section.title,
            included: section.included,
            total: section.total,
            csvUrl: signedCsv?.signedUrl,
          });
        }
        const { data: signedManifest } = await adminClient.storage
          .from(bucket)
          .createSignedUrl(`${appendixPrefix}/manifest.json`, SIGNED_URL_TTL_SECONDS);
        appendix = { manifestUrl: signedManifest?.signedUrl, sections };
      }
    } catch {
      appendix = null;
    }

    return json(req, {
      success: true,
      status: "succeeded",
      url: signedUrlData.signedUrl,
      path: job.storage_path,
      expiresIn: SIGNED_URL_TTL_SECONDS,
      appendix,
    });
  }

  // Enqueue path. Role checks, org resolution, and facility scoping (including the
  // facility_manager auto-scope) are all enforced inside the SECURITY DEFINER RPC --
  // the single source of truth shared with every caller.
  const requestedFacilities = Array.isArray(body.facility_ids) && body.facility_ids.length > 0
    ? body.facility_ids
    : body.facility_id
      ? [body.facility_id]
      : null;
  const { data: jobRow, error: requestError } = await callerClient.rpc("request_binder_export", {
    p_organization_id: body.organization_id ?? null,
    p_facility_ids: requestedFacilities,
  });
  if (requestError) {
    const status = requestError.code === "42501" ? 403 : requestError.code === "22023" ? 400 : 500;
    return json(req, { error: requestError.message }, status);
  }
  return json(req, { success: true, jobId: jobRow?.id ?? null, status: jobRow?.status ?? "pending" }, 202);
});

async function runWorkerBatch(req: Request, adminClient: any): Promise<Response> {
  let batchSize = 2;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.batchSize)) {
      batchSize = Math.min(5, Math.max(1, Math.floor(body.batchSize)));
    }
  } catch {
    // default batch size
  }

  const { data: claimRows, error: claimError } = await adminClient.rpc("claim_system_job_execution", {
    p_job_key: BINDER_JOB_KEY,
    p_correlation_id: crypto.randomUUID(),
    p_trigger_type: "scheduled",
    p_provider_request_id: null,
  });
  if (claimError) return json(req, { error: claimError.message }, 500);
  const run = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!run?.should_execute) {
    return json(req, { success: true, skipped: true, status: run?.existing_status ?? "skipped" });
  }

  const runId = run.run_id;
  const workerId = crypto.randomUUID();
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let batchError: string | null = null;

  try {
    for (let i = 0; i < batchSize; i++) {
      const { data: cancelled } = await adminClient.rpc("is_system_job_cancellation_requested", {
        p_run_id: runId,
      });
      if (cancelled === true) break;

      const { data: jobs, error: jobsError } = await adminClient.rpc("claim_binder_export_jobs", {
        p_worker_id: workerId,
        p_limit: 1,
      });
      if (jobsError) {
        batchError = jobsError.message;
        break;
      }
      const job = jobs?.[0];
      if (!job) break;

      attempted += 1;
      try {
        const scope = Array.isArray(job.facility_ids) && job.facility_ids.length > 0
          ? job.facility_ids
          : null;
        const { data: requester } = await adminClient
          .from("profiles")
          .select("first_name, last_name, role")
          .eq("id", job.requested_by)
          .maybeSingle();
        const requestedByLabel = requester
          ? `${requester.first_name} ${requester.last_name} (${requester.role})`
          : "CareMetric CareBase";
        const { pdfBytes, appendixSections } = await buildBinderPdf(adminClient, job.organization_id, scope, requestedByLabel);
        // The recorded checksum is what lets a finished export become an immutable
        // evidence-room artifact (report_snapshot_artifacts requires content_sha256).
        const contentSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", pdfBytes)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        // Job-id path with upsert:true keeps retries idempotent on the same object.
        const path = `${job.organization_id}/${job.job_id}.pdf`;
        const { error: uploadError } = await adminClient.storage
          .from(BINDER_BUCKET)
          .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw new Error(uploadError.message);

        const appendixPrefix = `${job.organization_id}/${job.job_id}-appendix`;
        const appendixManifest = {
          jobId: job.job_id,
          generatedAt: new Date().toISOString(),
          pdfPath: path,
          sections: appendixSections.map((s) => ({
            key: s.key,
            title: s.title,
            included: s.included,
            total: s.total,
            csvPath: `${appendixPrefix}/${s.key}.csv`,
          })),
        };
        const { error: manifestError } = await adminClient.storage
          .from(BINDER_BUCKET)
          .upload(
            `${appendixPrefix}/manifest.json`,
            new TextEncoder().encode(JSON.stringify(appendixManifest, null, 2)),
            { contentType: "application/json", upsert: true },
          );
        if (manifestError) throw new Error(manifestError.message);
        for (const section of appendixSections) {
          const csv = rowsToCsv(section.headers, section.rows);
          const { error: csvError } = await adminClient.storage
            .from(BINDER_BUCKET)
            .upload(
              `${appendixPrefix}/${section.key}.csv`,
              new TextEncoder().encode(csv),
              { contentType: "text/csv;charset=utf-8", upsert: true },
            );
          if (csvError) throw new Error(csvError.message);
        }

        const { data: finished, error: finishError } = await adminClient.rpc("finish_binder_export_job", {
          p_job_id: job.job_id,
          p_run_id: job.run_id,
          p_bucket: BINDER_BUCKET,
          p_path: path,
          p_error_code: null,
          p_error_message: null,
          p_content_sha256: contentSha256,
          p_byte_size: pdfBytes.byteLength,
        });
        if (finishError) throw finishError;
        if (!finished) throw new Error("Binder export job lease expired before completion");

        await adminClient.from("audit_logs").insert({
          organization_id: job.organization_id,
          actor_profile_id: job.requested_by,
          entity_type: "compliance_binder",
          action: "generated",
          new_values: {
            storage_path: path,
            binder_export_job_id: job.job_id,
            appendix_prefix: appendixPrefix,
            appendix_sections: appendixManifest.sections.length,
          },
        });
        succeeded += 1;
      } catch (jobError) {
        failed += 1;
        await adminClient.rpc("finish_binder_export_job", {
          p_job_id: job.job_id,
          p_run_id: job.run_id,
          p_bucket: null,
          p_path: null,
          p_error_code: "render_failed",
          p_error_message: String((jobError as Error)?.message ?? "Binder generation failed").slice(0, 2000),
        });
      }

      await adminClient.rpc("heartbeat_system_job", {
        p_run_id: runId,
        p_attempted_count: attempted,
        p_succeeded_count: succeeded,
        p_failed_count: failed,
        p_cursor: {},
      });
    }
  } finally {
    await adminClient.rpc("finish_system_job", {
      p_run_id: runId,
      p_status: batchError ? "failed" : failed > 0 ? "partial" : "succeeded",
      p_attempted_count: attempted,
      p_succeeded_count: succeeded,
      p_failed_count: failed,
      p_result: {},
      p_error_code: batchError ? "batch_error" : null,
      p_error_message: batchError,
    });
  }

  return json(req, { success: !batchError, attempted, succeeded, failed });
}

// PostgREST caps unpaged selects (1000 rows by default), so every binder list query
// pages via .range() until a short page -- otherwise a large org's binder would
// silently compute its census, tallies, and readiness % from an arbitrary first page
// while presenting them as complete. Callers pass a builder so each page issues a
// fresh query; the builder must include a stable ORDER BY for deterministic paging.
const FETCH_PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < FETCH_PAGE_SIZE) return rows;
  }
}

// Renewal cycles insert fresh training rows and leave prior ones 'expired' forever;
// binder tallies and gap lists must grade only the current record per (employee,
// training type) -- the same rule as the app's selectCurrentTrainingRecords.
function selectCurrentTrainingRecords(records: any[]): any[] {
  const currency = (r: any) => [r.due_date ?? "", r.completion_date ?? "", r.created_at ?? ""];
  const byKey = new Map<string, any>();
  for (const record of records) {
    const key = `${record.employee_id}\u0000${record.training_type_id}`;
    const current = byKey.get(key);
    if (!current) { byKey.set(key, record); continue; }
    const a = currency(record);
    const b = currency(current);
    for (let i = 0; i < 3; i++) {
      if (a[i] === b[i]) continue;
      if (a[i] > b[i]) byKey.set(key, record);
      break;
    }
  }
  return [...byKey.values()];
}

// Practicums are one row per (employee, year); prior years stay 'expired' forever,
// so only each employee's latest-year practicum reflects the live obligation.
// Within a year, a row with completion evidence supersedes the rulepack engine's
// auto-instantiated 'missing' placeholder (save_practicum can insert a completed
// row alongside it) -- matching get_org_dashboard_summary's current_practicums.
function selectCurrentPracticums(practicums: any[]): any[] {
  const currency = (p: any) => [p.completion_date ?? "", p.due_date ?? "", p.status === "missing" ? 0 : 1];
  const byEmployee = new Map<string, any>();
  for (const practicum of practicums) {
    const current = byEmployee.get(practicum.employee_id);
    if (!current || practicum.practicum_year > current.practicum_year) {
      byEmployee.set(practicum.employee_id, practicum);
      continue;
    }
    if (practicum.practicum_year < current.practicum_year) continue;
    const a = currency(practicum);
    const b = currency(current);
    for (let i = 0; i < 3; i++) {
      if (a[i] === b[i]) continue;
      if (a[i] > b[i]) byEmployee.set(practicum.employee_id, practicum);
      break;
    }
  }
  return [...byEmployee.values()];
}

// Renders the full binder PDF for one organization (optionally scoped to specific
// facilities -- the scope is resolved and validated at enqueue time). Runs on the
// service-role client; throws on any data error so the worker records a retryable
// failure on the job.
interface BinderAppendixSection {
  key: string;
  title: string;
  included: number;
  total: number;
  headers: string[];
  rows: string[][];
}

interface BinderBuildResult {
  pdfBytes: Uint8Array;
  appendixSections: BinderAppendixSection[];
}

function csvEscape(value: string): string {
  const s = String(value ?? "");
  // Excel/Sheets execute cells starting with = + - @ (or tab/CR) as formulas, so
  // tenant-entered text (employee names, alert titles) could exfiltrate data when an
  // appendix CSV is opened. Prefix a quote to force text, leaving plain numbers
  // (e.g. "-5") alone so numeric columns still parse -- the same guard as the app's
  // canonical csvEscape (src/lib/csv.ts), which Deno functions cannot import.
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s);
  return `"${(needsFormulaGuard ? `'${s}` : s).replaceAll('"', '""')}"`;
}

function rowsToCsv(headers: string[], rows: string[][]): string {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\n");
}

async function buildBinderPdf(
  adminClient: any,
  orgId: string,
  facilityScope: string[] | null,
  requestedByLabel: string,
): Promise<BinderBuildResult> {
  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .single();
  if (orgError || !org) throw new Error("organization not found");

  const scoped = (query: any) => (facilityScope ? query.in("facility_id", facilityScope) : query);

  // The facilities list is the binder's sandbox boundary: is_sandbox lives only on
  // facilities, and an org-wide job carries no facility scope for scoped() to apply,
  // so it is fetched first and every child dataset below is cut down to it after
  // fetch. Otherwise the Training Sandbox's synthetic staff/residents (and their
  // auto-instantiated 'missing' items) would enter the tallies, gap lists, and the
  // readiness % while the sandbox facility itself stays hidden from the Facilities
  // table -- the same exclusion rule generate_paged_compliance_reports enforces.
  const facilities = await fetchAllRows(() => {
    const query = adminClient.from("facilities").select("id, name, facility_type, license_number").eq("organization_id", orgId).eq("is_sandbox", false).order("name").order("id");
    return facilityScope ? query.in("id", facilityScope) : query;
  });
  const realFacilityIds = new Set(facilities.map((f: any) => f.id));
  // Post-fetch filtering keeps each query free of an .in() list that grows with the
  // org's facility count. Alerts can be org-level (facility_id null); those stay in.
  const fetchRealFacilityRows = async (buildQuery: () => any): Promise<any[]> =>
    (await fetchAllRows(buildQuery)).filter((row: any) => row.facility_id == null || realFacilityIds.has(row.facility_id));

  // A head-count cannot be filtered after the fact, so this one query narrows to the
  // sandbox-filtered facility list DB-side (bounded by facility count, not rows).
  const certCountQuery = adminClient.from("certificates").select("id", { count: "exact", head: true })
    .eq("organization_id", orgId).in("facility_id", [...realFacilityIds]);

  const [
    employees, allRecords, allPracticums, certCountRes, alerts, attestations,
    credentials, incidents, inspectionItems, correctiveActionsRaw, citationTopics,
    residents, residentCompliance,
  ] = await Promise.all([
    fetchRealFacilityRows(() => scoped(adminClient.from("employees").select("id, first_name, last_name, facility_id, status").eq("organization_id", orgId).order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient
      .from("employee_training_records")
      .select("id, status, due_date, completion_date, created_at, employee_id, training_type_id, facility_id, training_types(name, citation_topic_id)")
      .eq("organization_id", orgId).order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient.from("practicums").select("id, status, due_date, completion_date, practicum_year, employee_id, facility_id").eq("organization_id", orgId).order("id"))),
    certCountQuery,
    fetchRealFacilityRows(() => scoped(adminClient.from("alerts").select("id, severity, title, created_at, facility_id").eq("organization_id", orgId).eq("status", "open").order("severity").order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient
      .from("policy_attestations")
      .select(
        "id, status, due_date, attested_at, auth_method, ip_address, employee_id, facility_id, " +
          "policy_attestation_campaigns(name, policy_documents(title))",
      )
      .eq("organization_id", orgId).order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient
      .from("employee_credentials")
      .select("id, status, expiration_date, employee_id, facility_id, credential_type, citation_topic_id")
      .eq("organization_id", orgId).order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient
      .from("incidents")
      .select("id, incident_type, severity, status, occurred_at, final_report_submitted_at, facility_id")
      .eq("organization_id", orgId)
      .order("occurred_at", { ascending: false }).order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient
      .from("inspection_items")
      .select("id, status, next_due_date, label, item_type, facility_id, citation_topic_id")
      .eq("organization_id", orgId)
      .eq("is_active", true).order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient
      .from("corrective_actions")
      .select("id, description, due_date, status, facility_id")
      .eq("organization_id", orgId)
      .neq("status", "completed").order("id"))),
    fetchAllRows(() => adminClient.from("dhs_citation_topics").select("id, chapter, citation_ref, category, title, frequency_weight").order("sort_order").order("id")),
    fetchRealFacilityRows(() => scoped(adminClient.from("residents").select("id, first_name, last_name, facility_id, status, sdcu, hospice").eq("organization_id", orgId).order("id"))),
    fetchRealFacilityRows(() => scoped(adminClient
      .from("resident_compliance_items")
      .select("id, status, item_type, due_date, resident_id, facility_id, citation_topic_id")
      .eq("organization_id", orgId).order("id"))),
  ]);

  if (certCountRes.error) throw new Error(certCountRes.error.message);
  const certCount = certCountRes.count ?? 0;
  const records = selectCurrentTrainingRecords(allRecords);
  const practicums = selectCurrentPracticums(allPracticums);
  // Cancelled corrective actions are closed work, not open gaps.
  const correctiveActions = correctiveActionsRaw.filter((action: any) => action.status !== "cancelled");

  const facilityMap = new Map(facilities.map((f) => [f.id, f]));
  const employeeMap = new Map(employees.map((e) => [e.id, e]));

  const activeCountByFacility = new Map<string, number>();
  for (const e of employees) {
    if (e.status === "active") {
      activeCountByFacility.set(e.facility_id, (activeCountByFacility.get(e.facility_id) ?? 0) + 1);
    }
  }

  // Resident census -- the census is the first thing a DHS entrance conference asks for
  // (ROADMAP.md Tier 3.5), so it belongs at the top of the binder alongside facility/staff counts.
  const activeResidents = residents.filter((r) => r.status === "active");
  const residentCountByFacility = new Map<string, { total: number; sdcu: number; hospice: number }>();
  for (const r of activeResidents) {
    const bucket = residentCountByFacility.get(r.facility_id) ?? { total: 0, sdcu: 0, hospice: 0 };
    bucket.total += 1;
    if (r.sdcu) bucket.sdcu += 1;
    if (r.hospice) bucket.hospice += 1;
    residentCountByFacility.set(r.facility_id, bucket);
  }

  const residentComplianceStatusCounts = new Map<string, number>();
  for (const rci of residentCompliance) residentComplianceStatusCounts.set(rci.status, (residentComplianceStatusCounts.get(rci.status) ?? 0) + 1);
  const nonCompliantResidentItems = residentCompliance
    .filter((rci) => rci.status === "expired" || rci.status === "due_soon" || rci.status === "missing")
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const residentById = new Map(residents.map((r) => [r.id, r]));

  const recordStatusCounts = new Map<string, number>();
  for (const r of records) recordStatusCounts.set(r.status, (recordStatusCounts.get(r.status) ?? 0) + 1);
  const nonCompliantRecords = records
    .filter((r) => r.status === "expired" || r.status === "due_soon")
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  const practicumStatusCounts = new Map<string, number>();
  for (const p of practicums) practicumStatusCounts.set(p.status, (practicumStatusCounts.get(p.status) ?? 0) + 1);
  const nonCompliantPracticums = practicums
    .filter((p) => p.status === "expired" || p.status === "due_soon")
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  const alertSeverityCounts = new Map<string, number>();
  for (const a of alerts) alertSeverityCounts.set(a.severity, (alertSeverityCounts.get(a.severity) ?? 0) + 1);

  const today = paToday();
  const attestedCount = attestations.filter((a) => a.status === "attested").length;
  const overdueAttestations = attestations.filter((a) => a.status === "pending" && a.due_date && a.due_date < today);
  const pendingAttestations = attestations.filter((a) => a.status === "pending" && (!a.due_date || a.due_date >= today));
  const signedAttestations = attestations
    .filter((a) => a.status === "attested")
    .sort((a, b) => (b.attested_at ?? "").localeCompare(a.attested_at ?? ""));

  function policyTitle(a: (typeof attestations)[number]): string {
    const campaign = a.policy_attestation_campaigns as unknown as { name: string; policy_documents: { title: string } | null } | null;
    return campaign?.policy_documents?.title ?? campaign?.name ?? "—";
  }

  // Credentials & clearances -- omitted from the binder before this Tier 3.1 rebuild.
  const credentialStatusCounts = new Map<string, number>();
  for (const c of credentials) credentialStatusCounts.set(c.status, (credentialStatusCounts.get(c.status) ?? 0) + 1);
  const nonCompliantCredentials = credentials
    .filter((c) => c.status === "expired" || c.status === "due_soon" || c.status === "missing")
    .sort((a, b) => (a.expiration_date ?? "").localeCompare(b.expiration_date ?? ""));

  // Reportable incidents -- omitted from the binder before this Tier 3.1 rebuild. "Open" means
  // no final report has been submitted yet, mirroring the 24-hour reportable-incident workflow's
  // own definition of done (final_report_submitted_at).
  const openIncidents = incidents.filter((i) => !i.final_report_submitted_at);

  // Inspection items & equipment -- omitted from the binder before this Tier 3.1 rebuild.
  const inspectionStatusCounts = new Map<string, number>();
  for (const i of inspectionItems) inspectionStatusCounts.set(i.status, (inspectionStatusCounts.get(i.status) ?? 0) + 1);
  const nonCompliantInspectionItems = inspectionItems
    .filter((i) => i.status === "expired" || i.status === "due_soon" || i.status === "missing")
    .sort((a, b) => (a.next_due_date ?? "").localeCompare(b.next_due_date ?? ""));
  const openCorrectiveActions = correctiveActions.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  // Citation-weighted readiness summary, ordered by regulation topic (see ROADMAP.md Tier 3.1)
  // rather than by product domain -- this is the reg-by-reg view a DHS surveyor actually works
  // from, layered on top of the domain-by-domain sections below that operators are used to.
  // frequency_weight is a configurable default planning weight, not a live BHSL citation-
  // frequency feed (see dhs_citation_topics.notes) -- shown here as-is, not oversold as a score.
  const readinessByTopic = new Map<string, { compliant: number; total: number }>();
  const bump = (topicId: string | null, isCompliant: boolean, isApplicable: boolean) => {
    if (!topicId || !isApplicable) return;
    const bucket = readinessByTopic.get(topicId) ?? { compliant: 0, total: 0 };
    bucket.total += 1;
    if (isCompliant) bucket.compliant += 1;
    readinessByTopic.set(topicId, bucket);
  };
  for (const r of records) {
    const topicId = (r.training_types as unknown as { citation_topic_id: string | null } | null)?.citation_topic_id ?? null;
    bump(topicId, r.status === "compliant", r.status !== "not_applicable");
  }
  for (const c of credentials) bump(c.citation_topic_id, c.status === "compliant", c.status !== "not_applicable");
  for (const i of inspectionItems) bump(i.citation_topic_id, i.status === "compliant", i.status !== "not_applicable");
  for (const rci of residentCompliance) bump(rci.citation_topic_id, rci.status === "compliant", rci.status !== "not_applicable");

  const readinessRows = citationTopics
    .map((t) => ({ ...t, ...(readinessByTopic.get(t.id) ?? { compliant: 0, total: 0 }) }))
    .filter((t) => t.total > 0);
  let weightedCompliant = 0;
  let weightedTotal = 0;
  for (const row of readinessRows) {
    weightedCompliant += row.frequency_weight * row.compliant;
    weightedTotal += row.frequency_weight * row.total;
  }
  const overallReadinessPct = weightedTotal > 0 ? Math.round((weightedCompliant / weightedTotal) * 100) : null;

  const pdf = await PdfWriter.create();
  const generatedAt = new Date().toISOString();

  // Cover title block + table of contents render onto the reserved first page (see PdfWriter).
  pdf.setCover(org.name, "Compliance Binder", [`Generated: ${generatedAt}`, `Requested by: ${requestedByLabel}`]);

  pdf.heading("Citation-Weighted Readiness Summary (Entrance Conference View)");
  pdf.text(
    "Ordered by DHS citation topic rather than by product area -- the reg-by-reg view a surveyor works from. " +
      "Weights are configurable defaults, not a live BHSL citation-frequency feed -- verify against current regulations.",
    { size: 8, color: [0.5, 0.5, 0.5], gap: 10 },
  );
  if (overallReadinessPct !== null) {
    pdf.text(`Overall weighted readiness: ${overallReadinessPct}%`, { size: 12, bold: true, gap: 10 });
  }
  pdf.table(
    ["Chapter / Citation", "Topic", "Weight", "Compliant", "%"],
    readinessRows.map((r) => [
      `${r.chapter === "both" ? "2600/2800" : r.chapter}${r.citation_ref ? ` (${r.citation_ref})` : ""}`,
      r.title,
      `${r.frequency_weight}x`,
      `${r.compliant} / ${r.total}`,
      `${Math.round((r.compliant / r.total) * 100)}%`,
    ]),
    [110, 220, 60, 90, 60],
  );

  pdf.heading("Facilities & Resident Census");
  pdf.text(
    "Census demographics are typically the first document requested at a DHS entrance conference.",
    { size: 8, color: [0.5, 0.5, 0.5], gap: 10 },
  );
  pdf.table(
    ["Facility", "Type", "License #", "Active Staff", "Residents", "SDCU", "Hospice"],
    facilities.map((f) => {
      const census = residentCountByFacility.get(f.id) ?? { total: 0, sdcu: 0, hospice: 0 };
      return [
        f.name, facilityTypeLabel(f.facility_type), f.license_number ?? "—", String(activeCountByFacility.get(f.id) ?? 0),
        String(census.total), String(census.sdcu), String(census.hospice),
      ];
    }),
    [150, 70, 90, 70, 60, 50, 60],
  );

  pdf.heading("Staff Training Compliance Summary");
  pdf.table(
    ["Status", "Count"],
    Object.keys(STATUS_LABELS).map((k) => [STATUS_LABELS[k], String(recordStatusCounts.get(k) ?? 0)]),
    [200, 100],
  );

  if (nonCompliantRecords.length > 0) {
    pdf.heading(`Overdue / Due Soon Training Records (${nonCompliantRecords.length})`);
    const shown = nonCompliantRecords.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Employee", "Facility", "Training Type", "Due Date", "Status"],
      shown.map((r) => {
        const e = employeeMap.get(r.employee_id);
        const f = facilityMap.get(r.facility_id);
        const trainingType = (r.training_types as unknown as { name: string } | null)?.name;
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          f?.name ?? "—",
          trainingType ?? "—",
          r.due_date ?? "—",
          STATUS_LABELS[r.status] ?? r.status,
        ];
      }),
      [150, 110, 150, 80, 80],
    );
    if (nonCompliantRecords.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${nonCompliantRecords.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  pdf.heading("Practicum Compliance Summary");
  pdf.table(
    ["Status", "Count"],
    ["compliant", "due_soon", "expired", "missing"].map((k) => [STATUS_LABELS[k] ?? k, String(practicumStatusCounts.get(k) ?? 0)]),
    [200, 100],
  );

  if (nonCompliantPracticums.length > 0) {
    pdf.heading(`Overdue / Due Soon Practicums (${nonCompliantPracticums.length})`);
    const shown = nonCompliantPracticums.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Employee", "Facility", "Due Date", "Status"],
      shown.map((p) => {
        const e = employeeMap.get(p.employee_id);
        const f = facilityMap.get(p.facility_id);
        return [e ? `${e.first_name} ${e.last_name}` : "—", f?.name ?? "—", p.due_date ?? "—", STATUS_LABELS[p.status] ?? p.status];
      }),
      [180, 150, 100, 100],
    );
    if (nonCompliantPracticums.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${nonCompliantPracticums.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  pdf.heading("Certificates Issued");
  pdf.text(`Total certificates issued: ${certCount}`);

  pdf.heading("Open Alerts");
  pdf.table(
    ["Severity", "Count"],
    ["critical", "warning", "info"].map((k) => [k, String(alertSeverityCounts.get(k) ?? 0)]),
    [150, 100],
  );
  if (alerts.length > 0) {
    const shown = alerts.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Severity", "Title", "Created"],
      shown.map((a) => [a.severity, a.title, new Date(a.created_at).toLocaleDateString("en-US", { timeZone: PA_TIME_ZONE })]),
      [80, 300, 100],
    );
  }

  pdf.heading("Policy Attestation Compliance Summary");
  pdf.table(
    ["Status", "Count"],
    [
      ["Attested", String(attestedCount)],
      ["Pending", String(pendingAttestations.length)],
      ["Overdue", String(overdueAttestations.length)],
    ],
    [200, 100],
  );

  const outstandingAttestations = [...overdueAttestations, ...pendingAttestations];
  if (outstandingAttestations.length > 0) {
    pdf.heading(`Outstanding Policy Attestations (${outstandingAttestations.length})`);
    const shown = outstandingAttestations.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Employee", "Facility", "Policy", "Due Date", "Status"],
      shown.map((a) => {
        const e = employeeMap.get(a.employee_id);
        const f = facilityMap.get(a.facility_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          f?.name ?? "—",
          policyTitle(a),
          a.due_date ?? "—",
          a.due_date && a.due_date < today ? "Overdue" : "Pending",
        ];
      }),
      [150, 110, 150, 80, 80],
    );
    if (outstandingAttestations.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${outstandingAttestations.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  // ESIGN/UETA audit trail: who signed what, when, and from where -- the exact evidence a DHS
  // inspector or plaintiff's attorney would ask for to establish non-repudiation.
  if (signedAttestations.length > 0) {
    pdf.heading(`Signed Attestations Log (${signedAttestations.length})`);
    const shown = signedAttestations.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Employee", "Policy", "Attested At", "Auth Method", "IP Address"],
      shown.map((a) => {
        const e = employeeMap.get(a.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          policyTitle(a),
          a.attested_at ? new Date(a.attested_at).toLocaleString("en-US", { timeZone: PA_TIME_ZONE }) : "—",
          a.auth_method ?? "—",
          a.ip_address ?? "—",
        ];
      }),
      [130, 150, 130, 100, 90],
    );
    if (signedAttestations.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${signedAttestations.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  pdf.heading("Credentials & Clearances Compliance Summary");
  pdf.table(
    ["Status", "Count"],
    Object.keys(STATUS_LABELS).map((k) => [STATUS_LABELS[k], String(credentialStatusCounts.get(k) ?? 0)]),
    [200, 100],
  );
  if (nonCompliantCredentials.length > 0) {
    pdf.heading(`Outstanding Credentials & Clearances (${nonCompliantCredentials.length})`);
    const shown = nonCompliantCredentials.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Employee", "Facility", "Credential", "Expiration", "Status"],
      shown.map((c) => {
        const e = employeeMap.get(c.employee_id);
        const f = facilityMap.get(c.facility_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          f?.name ?? "—",
          c.credential_type.replace(/_/g, " "),
          c.expiration_date ?? "—",
          STATUS_LABELS[c.status] ?? c.status,
        ];
      }),
      [150, 110, 150, 80, 80],
    );
    if (nonCompliantCredentials.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${nonCompliantCredentials.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  pdf.heading("Reportable Incidents Log");
  pdf.text(`Total incidents on record: ${incidents.length} -- ${openIncidents.length} without a final report submitted.`);
  if (incidents.length > 0) {
    const shown = incidents.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Facility", "Type", "Severity", "Occurred", "Status", "Final Report"],
      shown.map((i) => [
        facilityMap.get(i.facility_id)?.name ?? "—",
        i.incident_type.replace(/_/g, " "),
        i.severity,
        new Date(i.occurred_at).toLocaleDateString("en-US", { timeZone: PA_TIME_ZONE }),
        i.status.replace(/_/g, " "),
        i.final_report_submitted_at ? "Submitted" : "Outstanding",
      ]),
      [110, 130, 80, 90, 100, 90],
    );
    if (incidents.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${incidents.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  pdf.heading("Inspection Items & Equipment Compliance Summary");
  pdf.table(
    ["Status", "Count"],
    Object.keys(STATUS_LABELS).map((k) => [STATUS_LABELS[k], String(inspectionStatusCounts.get(k) ?? 0)]),
    [200, 100],
  );
  if (nonCompliantInspectionItems.length > 0) {
    pdf.heading(`Outstanding Inspection Items (${nonCompliantInspectionItems.length})`);
    const shown = nonCompliantInspectionItems.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Facility", "Item", "Type", "Next Due", "Status"],
      shown.map((i) => [
        facilityMap.get(i.facility_id)?.name ?? "—",
        i.label,
        i.item_type.replace(/_/g, " "),
        i.next_due_date ?? "—",
        STATUS_LABELS[i.status] ?? i.status,
      ]),
      [110, 160, 130, 90, 90],
    );
    if (nonCompliantInspectionItems.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${nonCompliantInspectionItems.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  if (openCorrectiveActions.length > 0) {
    pdf.heading(`Open Corrective Actions (${openCorrectiveActions.length})`);
    const shown = openCorrectiveActions.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Facility", "Description", "Due Date", "Status"],
      shown.map((a) => [facilityMap.get(a.facility_id)?.name ?? "—", a.description, a.due_date ?? "—", a.status.replace(/_/g, " ")]),
      [110, 300, 90, 90],
    );
    if (openCorrectiveActions.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${openCorrectiveActions.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  // Resident RASP compliance -- new in Tier 3.5. Deliberately excludes any charting/eMAR/care-plan
  // data (there is none to exclude -- residents is a compliance-date registry only).
  pdf.heading("Resident RASP Compliance Summary");
  pdf.table(
    ["Status", "Count"],
    Object.keys(STATUS_LABELS).map((k) => [STATUS_LABELS[k], String(residentComplianceStatusCounts.get(k) ?? 0)]),
    [200, 100],
  );
  if (nonCompliantResidentItems.length > 0) {
    pdf.heading(`Outstanding Resident Compliance Items (${nonCompliantResidentItems.length})`);
    const shown = nonCompliantResidentItems.slice(0, MAX_LISTED_ROWS);
    pdf.table(
      ["Resident", "Facility", "Item", "Due Date", "Status"],
      shown.map((rci) => {
        const r = residentById.get(rci.resident_id);
        const f = facilityMap.get(rci.facility_id);
        return [
          r ? `${r.first_name} ${r.last_name}` : "—",
          f?.name ?? "—",
          rci.item_type.replace(/_/g, " "),
          rci.due_date ?? "—",
          STATUS_LABELS[rci.status] ?? rci.status,
        ];
      }),
      [130, 110, 160, 80, 80],
    );
    if (nonCompliantResidentItems.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${nonCompliantResidentItems.length - MAX_LISTED_ROWS} more (truncated for report length; full counts remain accurate above).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
  }

  const appendixSections: BinderAppendixSection[] = [
    {
      key: "training_gaps",
      title: "Overdue / Due Soon Training Records",
      included: nonCompliantRecords.length,
      total: nonCompliantRecords.length,
      headers: ["Employee", "Facility", "Training Type", "Due Date", "Status"],
      rows: nonCompliantRecords.map((r) => {
        const e = employeeMap.get(r.employee_id);
        const f = facilityMap.get(r.facility_id);
        const trainingType = (r.training_types as unknown as { name: string } | null)?.name;
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          f?.name ?? "—",
          trainingType ?? "—",
          r.due_date ?? "—",
          STATUS_LABELS[r.status] ?? r.status,
        ];
      }),
    },
    {
      key: "practicum_gaps",
      title: "Overdue / Due Soon Practicums",
      included: nonCompliantPracticums.length,
      total: nonCompliantPracticums.length,
      headers: ["Employee", "Facility", "Year", "Due Date", "Status"],
      rows: nonCompliantPracticums.map((p) => {
        const e = employeeMap.get(p.employee_id);
        const f = facilityMap.get(p.facility_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          f?.name ?? "—",
          String(p.practicum_year ?? "—"),
          p.due_date ?? "—",
          STATUS_LABELS[p.status] ?? p.status,
        ];
      }),
    },
    {
      key: "open_alerts",
      title: "Open Alerts",
      included: alerts.length,
      total: alerts.length,
      headers: ["Severity", "Title", "Created At"],
      rows: alerts.map((a) => [a.severity, a.title, a.created_at ?? "—"]),
    },
    {
      key: "outstanding_attestations",
      title: "Outstanding Policy Attestations",
      included: overdueAttestations.length + pendingAttestations.length,
      total: overdueAttestations.length + pendingAttestations.length,
      headers: ["Employee", "Policy", "Due Date", "Status"],
      rows: [...overdueAttestations, ...pendingAttestations].map((a) => {
        const e = employeeMap.get(a.employee_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          policyTitle(a),
          a.due_date ?? "—",
          a.status,
        ];
      }),
    },
    {
      key: "credential_gaps",
      title: "Credential Gaps",
      included: nonCompliantCredentials.length,
      total: nonCompliantCredentials.length,
      headers: ["Employee", "Facility", "Credential", "Expiration", "Status"],
      rows: nonCompliantCredentials.map((c) => {
        const e = employeeMap.get(c.employee_id);
        const f = facilityMap.get(c.facility_id);
        return [
          e ? `${e.first_name} ${e.last_name}` : "—",
          f?.name ?? "—",
          c.credential_type ?? "—",
          c.expiration_date ?? "—",
          STATUS_LABELS[c.status] ?? c.status,
        ];
      }),
    },
    {
      key: "incidents",
      title: "Incidents",
      included: incidents.length,
      total: incidents.length,
      headers: ["Type", "Severity", "Status", "Occurred At", "Facility"],
      rows: incidents.map((i) => {
        const f = facilityMap.get(i.facility_id);
        return [
          i.incident_type ?? "—",
          i.severity ?? "—",
          i.status ?? "—",
          i.occurred_at ?? "—",
          f?.name ?? "—",
        ];
      }),
    },
    {
      key: "inspection_gaps",
      title: "Inspection Gaps",
      included: nonCompliantInspectionItems.length,
      total: nonCompliantInspectionItems.length,
      headers: ["Label", "Type", "Facility", "Next Due", "Status"],
      rows: nonCompliantInspectionItems.map((i) => {
        const f = facilityMap.get(i.facility_id);
        return [
          i.label ?? "—",
          i.item_type ?? "—",
          f?.name ?? "—",
          i.next_due_date ?? "—",
          STATUS_LABELS[i.status] ?? i.status,
        ];
      }),
    },
    {
      key: "corrective_actions",
      title: "Open Corrective Actions",
      included: openCorrectiveActions.length,
      total: openCorrectiveActions.length,
      headers: ["Description", "Facility", "Due Date", "Status"],
      rows: openCorrectiveActions.map((a) => {
        const f = facilityMap.get(a.facility_id);
        return [
          a.description ?? "—",
          f?.name ?? "—",
          a.due_date ?? "—",
          a.status ?? "—",
        ];
      }),
    },
    {
      key: "resident_compliance_gaps",
      title: "Outstanding Resident Compliance Items",
      included: nonCompliantResidentItems.length,
      total: nonCompliantResidentItems.length,
      headers: ["Resident", "Facility", "Item", "Due Date", "Status"],
      rows: nonCompliantResidentItems.map((rci) => {
        const r = residentById.get(rci.resident_id);
        const f = facilityMap.get(rci.facility_id);
        return [
          r ? `${r.first_name} ${r.last_name}` : "—",
          f?.name ?? "—",
          String(rci.item_type ?? "").replace(/_/g, " "),
          rci.due_date ?? "—",
          STATUS_LABELS[rci.status] ?? rci.status,
        ];
      }),
    },
  ];

  // Cover note: PDF lists are capped; CSV appendix is complete for each section.
  pdf.heading("Machine-readable appendix");
  pdf.text(
    "Full section lists (not truncated) are stored as CSV files next to this PDF under the same export job id. " +
      "Use Download CSV appendix in CareBase for complete inclusion counts and rows.",
    { size: 9, gap: 8 },
  );
  pdf.table(
    ["Section", "Rows in appendix"],
    appendixSections.map((s) => [s.title, String(s.total)]),
    [360, 100],
  );

  const pdfBytes = await pdf.save();
  return { pdfBytes, appendixSections };
}
