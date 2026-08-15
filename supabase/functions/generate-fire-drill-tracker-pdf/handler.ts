// @ts-nocheck -- retained: npm pdf-lib/canvas modules cause widespread type errors
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { toWinAnsi } from "../_shared/pdfText.ts";

// Rolls up every logged fire drill for one facility + one calendar month into a single,
// DHS-submittable tracker PDF -- the monthly companion to InspectionItemDetail.tsx's per-item
// "Print Fire Drill Record" button, which only ever covers one inspection_item at a time. See
// supabase/migrations/20260705054756_fire_drill_record_fields.sql for the nine DHS-prescribed
// fields this covers (55 Pa. Code 2600.132/2800.132).

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const TRACKER_BUCKET = "fire-drill-tracker-exports";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
// Landscape Letter -- the 11-column drill grid below (mirroring InspectionItemDetail.tsx's
// single-drill print table, plus a Result column) needs more horizontal room than the portrait,
// single-column layouts the other generate-*-pdf functions use.
const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 36;
// Defensive cap on rendered rows -- this dataset is naturally bounded (one facility, one month,
// normally a handful of drills), but a bad import or data-entry loop shouldn't be able to produce
// an unbounded PDF. "Total Drills Logged" in the summary always reflects the true count.
const MAX_ROWS = 200;

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/** Postgres `time` values come back as "HH:MM:SS" -- trim seconds for a tighter grid cell. */
function formatTime(value: string | null): string {
  if (!value) return "—";
  const match = /^(\d{2}:\d{2})(:\d{2})?/.exec(value);
  return match ? match[1] : value;
}

// Mirrors artifacts/caremetric-carebase/src/lib/facilityTypes.ts's facilityTypeLabel -- this org's
// convention (see /CLAUDE.md) is "Assisted Living Facility (ALF)" in every user-facing string,
// never "ALR" or "Assisted Living Residence", even though the stored facility_type value itself
// stays "ALR". Kept in step with that file by comment cross-reference rather than a shared import
// -- this edge function's Deno runtime and the Vite app are separate deploy targets, the same
// split generate-resident-assessment-pdf documents against residentAssessmentFormSchema.ts.
function facilityTypeLabel(facilityType: string | null | undefined): string {
  if (facilityType === "ALR") return "Assisted Living Facility (ALF)";
  if (facilityType === "PCH") return "Personal Care Home (PCH)";
  return facilityType ?? "—";
}

// The fire-drill citation is chapter-specific -- 2600 for a PCH, 2800 for an ALF -- so the tracker
// cites only the section that actually governs the facility it was generated for.
function fireDrillCitation(facilityType: string | null | undefined): string {
  if (facilityType === "PCH") return "55 Pa. Code § 2600.132";
  if (facilityType === "ALR") return "55 Pa. Code § 2800.132";
  return "55 Pa. Code § 2600.132 / § 2800.132";
}

/** `month` is "YYYY-MM". Returns the half-open [start, nextStart) date-string bounds. */
function monthBounds(month: string): { start: string; nextStart: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextStart = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, nextStart };
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface FireDrillRow {
  performed_date: string;
  drill_time: string | null;
  shift: string | null;
  is_sleeping_hours_drill: boolean;
  evacuation_duration_seconds: number | null;
  exit_route_used: string | null;
  residents_present_count: number | null;
  residents_evacuated_count: number | null;
  staff_participating_count: number | null;
  alarm_or_detector_operative: boolean | null;
  result: string;
  problems_encountered: string | null;
}

// Column widths sum to PAGE_WIDTH - 2*MARGIN (792 - 72 = 720pt). Exit Route and Problems
// Encountered are marked `wrap: true` because they are the two open-ended free-text DHS fields on
// this form -- everything else is a short, bounded value (date/time/counts, or a fixed enum like
// shift/result). Non-wrapped cells (header and data) go through PdfWriter.truncate(), so a wider
// than expected value there ellipsizes instead of overflowing into the next column; that's fine
// for those columns since their legitimate values always fit. A `wrap: true` column instead grows
// PdfWriter.tableRow()'s row height to fit the full recorded text -- silently dropping part of a
// DHS-required narrative field would make this document not actually contain what it claims to.
const COLUMNS: { header: string; width: number; wrap?: boolean }[] = [
  { header: "Date", width: 56 },
  { header: "Time", width: 34 },
  { header: "Shift", width: 76 },
  { header: "Duration", width: 50 },
  { header: "Exit Route", width: 100, wrap: true },
  { header: "Res. Present", width: 46 },
  { header: "Res. Evacuated", width: 50 },
  { header: "Staff", width: 36 },
  { header: "Alarm OK", width: 46 },
  { header: "Result", width: 70 },
  { header: "Problems Encountered", width: 156, wrap: true },
];

/**
 * Word-wraps `text` into lines that each fit within `maxWidth` at the given font/size. A single
 * "word" (no internal whitespace) that alone is wider than maxWidth is hard-broken
 * character-by-character rather than left to overflow. Between ordinary word-wrapping and that
 * fallback, every character of the input ends up on some returned line -- nothing is ever dropped
 * or ellipsized. Used both for table cells that can hold free-text DHS narrative (exit route,
 * problems encountered) and for the footer boilerplate paragraph.
 */
export function wrapTextToLines(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  // WinAnsi boundary: Helvetica throws inside widthOfTextAtSize on non-CP1252 characters
  // (facility names, DHS free-text narrative), which 500'd the whole tracker.
  const words = toWinAnsi(text || "—").split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["—"];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    let remaining = word;
    if (font.widthOfTextAtSize(remaining, size) > maxWidth) {
      // This single word alone is wider than the column -- flush whatever's pending, then hard-
      // break the word itself across as many lines as it needs.
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

export class PdfWriter {
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

  /** Returns true when it had to start a new page to make room. */
  ensureSpace(needed: number): boolean {
    if (this.y - needed < MARGIN) {
      this.newPage();
      return true;
    }
    return false;
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
    const maxWidth = PAGE_WIDTH - MARGIN * 2;
    const lines = wrapTextToLines(text, maxWidth, this.font, 9);
    for (const line of lines) {
      this.ensureSpace(13);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 9, font: this.font, color: rgb(0.3, 0.3, 0.3) });
      this.y -= 13;
    }
    this.y -= 6;
  }

  truncate(str: string, maxWidth: number, font: PDFFont, size: number): string {
    const encodable = toWinAnsi(str);
    let s = encodable;
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth - 6) {
      s = s.slice(0, -1);
    }
    return s === encodable ? s : (s.length > 1 ? `${s.slice(0, -1)}…` : s);
  }

  tableHeader() {
    this.ensureSpace(20);
    const rowTop = this.y;
    this.page.drawRectangle({
      x: MARGIN, y: rowTop - 16, width: PAGE_WIDTH - MARGIN * 2, height: 16,
      color: rgb(0.92, 0.93, 0.96),
    });
    let x = MARGIN;
    for (const col of COLUMNS) {
      this.page.drawText(this.truncate(col.header, col.width, this.bold, 7.5), {
        x: x + 3, y: rowTop - 11.5, size: 7.5, font: this.bold, color: rgb(0.16, 0.22, 0.44),
      });
      x += col.width;
    }
    this.y = rowTop - 16;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75, color: rgb(0.16, 0.22, 0.44),
    });
  }

  tableRow(cells: string[]) {
    // Compute how many lines each cell needs before drawing anything, so the row's height (and
    // therefore whether it triggers a page break below) accounts for wrapped free-text cells.
    // Non-`wrap` columns keep the original single-line truncate() behavior -- their legitimate
    // values are always short enough to fit, so there's nothing to wrap.
    const lineHeight = 10;
    const cellLines = COLUMNS.map((col, i) => {
      const raw = cells[i] ?? "—";
      return col.wrap
        ? wrapTextToLines(raw, col.width - 6, this.font, 8)
        : [this.truncate(raw, col.width, this.font, 8)];
    });
    const lineCount = Math.max(1, ...cellLines.map((lines) => lines.length));
    // 16 is the original fixed single-line row height (11pt to the first baseline + 5pt below
    // it); a lineCount of 1 reproduces that exactly, so ordinary rows are pixel-identical to
    // before this change. Extra lines each add one more `lineHeight`.
    const rowHeight = 16 + (lineCount - 1) * lineHeight;

    const brokePage = this.ensureSpace(rowHeight + 2);
    // A page break mid-table needs the header reprinted so a lone continuation page is still
    // readable on its own.
    if (brokePage) this.tableHeader();
    const rowTop = this.y;
    let x = MARGIN;
    for (let i = 0; i < COLUMNS.length; i++) {
      const col = COLUMNS[i];
      const lines = cellLines[i];
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        this.page.drawText(lines[lineIdx], {
          x: x + 3, y: rowTop - 11 - lineIdx * lineHeight, size: 8, font: this.font, color: rgb(0.12, 0.12, 0.12),
        });
      }
      x += col.width;
    }
    this.y = rowTop - rowHeight;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.4, color: rgb(0.82, 0.82, 0.82),
    });
  }
}

export async function buildFireDrillTrackerPdf(input: {
  organizationName: string;
  facilityName: string;
  facilityType: string | null;
  licenseNumber: string | null;
  month: string;
  drills: FireDrillRow[];
}): Promise<Uint8Array> {
  const w = new PdfWriter();
  await w.init();

  w.page.drawText("Monthly Fire Drill Tracker", { x: MARGIN, y: w.y, size: 18, font: w.bold, color: rgb(0.16, 0.22, 0.44) });
  w.y -= 22;
  w.page.drawText(toWinAnsi(`${input.organizationName} — ${input.facilityName}`), { x: MARGIN, y: w.y, size: 11, font: w.font, color: rgb(0.35, 0.35, 0.35) });
  w.y -= 15;
  w.page.drawText(
    `${facilityTypeLabel(input.facilityType)}${input.licenseNumber ? ` · License #${input.licenseNumber}` : ""}`,
    { x: MARGIN, y: w.y, size: 9, font: w.font, color: rgb(0.45, 0.45, 0.45) },
  );
  w.y -= 20;

  w.heading(`${monthLabel(input.month)} Summary`);
  const shiftsCovered = [...new Set(input.drills.map((d) => d.shift).filter((s): s is string => !!s))];
  const notPassing = input.drills.filter((d) => d.result !== "pass").length;
  w.field("Total Drills Logged", String(input.drills.length));
  w.field("Shifts Covered", shiftsCovered.length ? shiftsCovered.map(humanize).join(", ") : "—");
  w.field("Drills Not Passing", String(notPassing));
  w.field("Regulatory Citation", fireDrillCitation(input.facilityType));
  w.y -= 6;

  w.heading("Drill Log");
  w.tableHeader();
  if (input.drills.length === 0) {
    w.ensureSpace(16);
    w.page.drawText("No fire drills were logged for this facility in the selected month.", {
      x: MARGIN + 3, y: w.y - 12, size: 9, font: w.font, color: rgb(0.4, 0.4, 0.4),
    });
    w.y -= 20;
  } else {
    const shown = input.drills.slice(0, MAX_ROWS);
    for (const d of shown) {
      w.tableRow([
        d.performed_date,
        formatTime(d.drill_time),
        `${d.shift ? humanize(d.shift) : "—"}${d.is_sleeping_hours_drill ? " (sleep)" : ""}`,
        formatDuration(d.evacuation_duration_seconds),
        d.exit_route_used ?? "—",
        d.residents_present_count == null ? "—" : String(d.residents_present_count),
        d.residents_evacuated_count == null ? "—" : String(d.residents_evacuated_count),
        d.staff_participating_count == null ? "—" : String(d.staff_participating_count),
        d.alarm_or_detector_operative == null ? "—" : (d.alarm_or_detector_operative ? "Yes" : "No"),
        humanize(d.result),
        d.problems_encountered || "None noted",
      ]);
    }
    if (input.drills.length > MAX_ROWS) {
      w.ensureSpace(14);
      w.page.drawText(`...and ${input.drills.length - MAX_ROWS} more (truncated for report length; totals above remain accurate).`, {
        x: MARGIN, y: w.y, size: 8, font: w.font, color: rgb(0.4, 0.4, 0.4),
      });
      w.y -= 14;
    }
  }

  w.y -= 8;
  w.paragraph(
    "This tracker rolls up every fire drill logged for the facility and month above, covering the nine " +
      "DHS-prescribed record fields (55 Pa. Code 2600.132/2800.132): date, time, evacuation duration, exit " +
      "route used, residents present, residents evacuated, staff participating, whether the alarm/detector " +
      "was operative, and problems encountered. Complete drill-level records -- including full narrative " +
      "notes and any linked corrective actions -- are maintained in CareMetric CareBase under Inspections & Equipment.",
  );
  w.ensureSpace(12);
  w.page.drawText(
    `Generated ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })} by CareMetric CareBase.`,
    { x: MARGIN, y: w.y, size: 8, font: w.font, color: rgb(0.55, 0.55, 0.55) },
  );
  w.y -= 12;

  return await w.doc.save();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientFactory = (url: string, key: string, options?: Record<string, unknown>) => any;

export interface GenerateFireDrillTrackerPdfDependencies {
  createClient: ClientFactory;
  getEnv?: (name: string) => string | undefined;
}

export function createGenerateFireDrillTrackerPdfHandler({
  createClient,
  getEnv = (name) => Deno.env.get(name),
}: GenerateFireDrillTrackerPdfDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return corsPreflightResponse(req);
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

    const supabaseUrl = getEnv("SUPABASE_URL")!;
    const anonKey = getEnv("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY")!;

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

    let body: { facilityId?: string; month?: string };
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
    const { facilityId, month } = body;
    if (!facilityId) return json(req, { error: "facilityId is required" }, 400);
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return json(req, { error: "month is required in YYYY-MM format" }, 400);
    }

    // Explicit authorization gate -- BEFORE any facility lookup or service-role write.
    // facilities_select RLS is deliberately org-wide (low-sensitivity directory data, see the
    // facility lookup below), but the drill data this tracker rolls up is scoped by
    // inspection_events_select/inspection_items_select (20260705023053_inspection_items_rls.sql):
    // platform_admin always; org_admin/auditor org-wide; facility_manager/trainer only when
    // assigned to this exact facility. Relying on that read policy alone is not enough -- an
    // out-of-scope caller's inspection_events query would simply come back empty (RLS filters
    // rows silently; it never errors), and without this check the code below would treat "zero
    // rows" as "zero drills logged this month" and go ahead and use the service-role client to
    // upsert an empty tracker over whatever real one already exists at the canonical
    // {org}/{facility}/{month}.pdf path -- an out-of-scope caller overwriting a real compliance
    // document with an empty one. Checking role + facility assignment up front, before the
    // facility lookup even runs, closes that gap instead of leaning on RLS emptiness as an
    // (insufficient) implicit authorization boundary. Same pattern voice-tools/index.ts uses
    // before letting a facility_manager's tool call read facility-scoped compliance data.
    const orgWideRoles = new Set(["platform_admin", "org_admin", "auditor"]);
    if (!orgWideRoles.has(callerProfile.role)) {
      if (callerProfile.role !== "facility_manager" && callerProfile.role !== "trainer") {
        return json(req, { error: "Not authorized to generate this facility's fire drill tracker" }, 403);
      }
      const { data: assignedToFacility, error: assignmentError } = await callerClient
        .rpc("is_assigned_to_facility", { target_facility_id: facilityId });
      if (assignmentError || assignedToFacility !== true) {
        return json(req, { error: "Not authorized to generate this facility's fire drill tracker" }, 403);
      }
    }

    // RLS-scoped read on the caller's own client: facilities_select is org-wide readable (low-
    // sensitivity directory data), so on its own this would return a row for any active same-org
    // caller regardless of the role/facility-assignment check above -- the authorization decision
    // is made by that check, not by this query. Cross-org access still isn't possible either way:
    // RLS continues to scope this to organization_id = current_org_id() (or platform_admin).
    const { data: facility, error: facilityError } = await callerClient
      .from("facilities")
      .select("id, name, facility_type, license_number, organization_id, organizations(name)")
      .eq("id", facilityId)
      .maybeSingle();
    if (facilityError) return json(req, { error: facilityError.message }, 500);
    if (!facility) return json(req, { error: "Facility not found" }, 404);

    const { start, nextStart } = monthBounds(month);

    const { data: events, error: eventsError } = await callerClient
      .from("inspection_events")
      .select(
        "performed_date, drill_time, shift, is_sleeping_hours_drill, evacuation_duration_seconds, " +
          "exit_route_used, residents_present_count, residents_evacuated_count, staff_participating_count, " +
          "alarm_or_detector_operative, result, problems_encountered, inspection_items!inner(item_type)",
      )
      .eq("facility_id", facilityId)
      .eq("inspection_items.item_type", "fire_drill_program")
      .gte("performed_date", start)
      .lt("performed_date", nextStart)
      .order("performed_date", { ascending: true })
      .order("drill_time", { ascending: true });
    if (eventsError) return json(req, { error: eventsError.message }, 500);

    const drills = (events ?? []) as unknown as FireDrillRow[];

    const organizationName = (facility.organizations as unknown as { name: string } | null)?.name ?? "";

    const pdfBytes = await buildFireDrillTrackerPdf({
      organizationName,
      facilityName: facility.name,
      facilityType: facility.facility_type,
      licenseNumber: facility.license_number,
      month,
      drills,
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    // Path shape (org/facility/month) matches the fire-drill-tracker-exports bucket's RLS read
    // policy, which reads org id and facility id out of the first two folder segments -- see
    // supabase/migrations/20260802030000_fire_drill_tracker_exports_storage_bucket.sql.
    const path = `${facility.organization_id}/${facility.id}/${month}.pdf`;

    // Always regenerated (upsert:true) -- like every other generate-*-pdf function, this renders
    // whatever is currently in inspection_events for the month, not a snapshot frozen at first
    // request, so re-running after logging a late drill entry picks it up.
    const { error: uploadError } = await adminClient.storage.from(TRACKER_BUCKET).upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploadError) return json(req, { error: uploadError.message }, 500);

    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
      .from(TRACKER_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signedUrlError || !signedUrlData) {
      return json(req, { error: signedUrlError?.message ?? "failed to create signed url" }, 500);
    }

    return json(req, {
      success: true,
      url: signedUrlData.signedUrl,
      path,
      expiresIn: SIGNED_URL_TTL_SECONDS,
      drillCount: drills.length,
    });
  };
}
