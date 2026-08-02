// @ts-nocheck -- retained: npm pdf-lib/canvas modules cause widespread type errors
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

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

interface FireDrillRow {
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

// Column widths sum to PAGE_WIDTH - 2*MARGIN (792 - 72 = 720pt). Problems Encountered gets the
// largest share since it is the one open-ended free-text field; every other column is a short,
// bounded value. Every cell (header and data) still goes through PdfWriter.truncate(), so a wider
// than expected value ellipsizes instead of overflowing into the next column.
const COLUMNS: { header: string; width: number }[] = [
  { header: "Date", width: 56 },
  { header: "Time", width: 34 },
  { header: "Shift", width: 76 },
  { header: "Duration", width: 50 },
  { header: "Exit Route", width: 100 },
  { header: "Res. Present", width: 46 },
  { header: "Res. Evacuated", width: 50 },
  { header: "Staff", width: 36 },
  { header: "Alarm OK", width: 46 },
  { header: "Result", width: 70 },
  { header: "Problems Encountered", width: 156 },
];

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
      if (this.font.widthOfTextAtSize(candidate, 9) > maxWidth && line) {
        this.ensureSpace(13);
        this.page.drawText(line, { x: MARGIN, y: this.y, size: 9, font: this.font, color: rgb(0.3, 0.3, 0.3) });
        this.y -= 13;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      this.ensureSpace(13);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 9, font: this.font, color: rgb(0.3, 0.3, 0.3) });
      this.y -= 13;
    }
    this.y -= 6;
  }

  truncate(str: string, maxWidth: number, font: PDFFont, size: number): string {
    let s = str;
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth - 6) {
      s = s.slice(0, -1);
    }
    return s === str ? s : (s.length > 1 ? `${s.slice(0, -1)}…` : s);
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
    const brokePage = this.ensureSpace(18);
    // A page break mid-table needs the header reprinted so a lone continuation page is still
    // readable on its own.
    if (brokePage) this.tableHeader();
    const rowTop = this.y;
    let x = MARGIN;
    for (let i = 0; i < COLUMNS.length; i++) {
      const col = COLUMNS[i];
      this.page.drawText(this.truncate(cells[i] ?? "—", col.width, this.font, 8), {
        x: x + 3, y: rowTop - 11, size: 8, font: this.font, color: rgb(0.12, 0.12, 0.12),
      });
      x += col.width;
    }
    this.y = rowTop - 16;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.4, color: rgb(0.82, 0.82, 0.82),
    });
  }
}

async function buildFireDrillTrackerPdf(input: {
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
  w.page.drawText(`${input.organizationName} — ${input.facilityName}`, { x: MARGIN, y: w.y, size: 11, font: w.font, color: rgb(0.35, 0.35, 0.35) });
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

  // RLS-scoped read on the caller's own client: facilities_select is org-wide readable (low-
  // sensitivity directory data), but the drill data joined below is gated by
  // inspection_events_select/inspection_items_select (platform_admin; org_admin/auditor org-wide;
  // facility_manager/trainer scoped to their assigned facility) -- so a caller outside a
  // facility's scope gets its name but zero drill rows, never someone else's drill data. No
  // separate authorization check needed here, matching every other generate-*-pdf function.
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
});
