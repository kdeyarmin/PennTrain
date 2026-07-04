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

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const MAX_LISTED_ROWS = 200;

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
    this.ensureSpace(size + 4);
    this.page.drawText(str, { x: MARGIN, y: this.y, size, font, color: rgb(r, g, b) });
    this.y -= size + (opts.gap ?? 6);
  }

  heading(str: string) {
    this.ensureSpace(34);
    this.y -= 10;
    this.text(str, { size: 13, bold: true, gap: 10 });
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, organization_id, is_active, first_name, last_name")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }

  const ALLOWED_ROLES = ["platform_admin", "org_admin", "facility_manager", "auditor"];
  if (!ALLOWED_ROLES.includes(callerProfile.role as string)) {
    return json({ error: "not authorized to generate a compliance binder" }, 403);
  }

  let body: { organization_id?: string } = {};
  if (req.headers.get("content-length") !== "0") {
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
  }

  // Non-platform_admin callers always get their own org's binder -- organization_id in the
  // body is only honored for platform_admin, so there is no path for org_admin/facility_manager/
  // auditor to request a foreign org's data by passing a different id.
  const orgId = callerProfile.role === "platform_admin" ? body.organization_id : callerProfile.organization_id;
  if (!orgId) return json({ error: "organization_id is required" }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .single();
  if (orgError || !org) return json({ error: "organization not found" }, 404);

  // facility_manager is otherwise constrained org-wide to their assigned facilities (via
  // facility_assignments/is_assigned_to_facility()); the queries below run on the service-role
  // client and bypass RLS entirely, so that scoping has to be applied explicitly here too --
  // without it a facility_manager's binder would leak every other facility's staff/compliance
  // data in the same org.
  let facilityScope: string[] | null = null;
  if (callerProfile.role === "facility_manager") {
    const { data: assignments, error: assignmentsError } = await callerClient
      .from("facility_assignments")
      .select("facility_id")
      .eq("profile_id", callerUser.id);
    if (assignmentsError) return json({ error: assignmentsError.message }, 500);
    facilityScope = (assignments ?? []).map((a) => a.facility_id);
    if (facilityScope.length === 0) {
      return json({ error: "no facilities assigned to this account" }, 403);
    }
  }

  let facilitiesQuery = adminClient.from("facilities").select("id, name, facility_type, license_number").eq("organization_id", orgId).order("name");
  let employeesQuery = adminClient.from("employees").select("id, first_name, last_name, facility_id, status").eq("organization_id", orgId);
  let recordsQuery = adminClient
    .from("employee_training_records")
    .select("status, due_date, employee_id, facility_id, training_types(name)")
    .eq("organization_id", orgId);
  let practicumsQuery = adminClient.from("practicums").select("status, due_date, employee_id, facility_id").eq("organization_id", orgId);
  let certCountQuery = adminClient.from("certificates").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
  let alertsQuery = adminClient.from("alerts").select("severity, title, created_at").eq("organization_id", orgId).eq("status", "open").order("severity");

  if (facilityScope) {
    facilitiesQuery = facilitiesQuery.in("id", facilityScope);
    employeesQuery = employeesQuery.in("facility_id", facilityScope);
    recordsQuery = recordsQuery.in("facility_id", facilityScope);
    practicumsQuery = practicumsQuery.in("facility_id", facilityScope);
    certCountQuery = certCountQuery.in("facility_id", facilityScope);
    alertsQuery = alertsQuery.in("facility_id", facilityScope);
  }

  const [facilitiesRes, employeesRes, recordsRes, practicumsRes, certCountRes, alertsRes] = await Promise.all([
    facilitiesQuery,
    employeesQuery,
    recordsQuery,
    practicumsQuery,
    certCountQuery,
    alertsQuery,
  ]);

  if (facilitiesRes.error) return json({ error: facilitiesRes.error.message }, 500);
  if (employeesRes.error) return json({ error: employeesRes.error.message }, 500);
  if (recordsRes.error) return json({ error: recordsRes.error.message }, 500);
  if (practicumsRes.error) return json({ error: practicumsRes.error.message }, 500);
  if (alertsRes.error) return json({ error: alertsRes.error.message }, 500);

  const facilities = facilitiesRes.data ?? [];
  const employees = employeesRes.data ?? [];
  const records = recordsRes.data ?? [];
  const practicums = practicumsRes.data ?? [];
  const certCount = certCountRes.count ?? 0;
  const alerts = alertsRes.data ?? [];

  const facilityMap = new Map(facilities.map((f) => [f.id, f]));
  const employeeMap = new Map(employees.map((e) => [e.id, e]));

  const activeCountByFacility = new Map<string, number>();
  for (const e of employees) {
    if (e.status === "active") {
      activeCountByFacility.set(e.facility_id, (activeCountByFacility.get(e.facility_id) ?? 0) + 1);
    }
  }

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

  const pdf = await PdfWriter.create();
  const generatedAt = new Date().toISOString();

  pdf.text(org.name, { size: 20, bold: true, gap: 4 });
  pdf.text("Compliance Binder", { size: 14, gap: 16 });
  pdf.text(`Generated: ${generatedAt}`, { size: 9, color: [0.4, 0.4, 0.4] });
  pdf.text(`Generated by: ${callerProfile.first_name} ${callerProfile.last_name} (${callerProfile.role})`, {
    size: 9,
    color: [0.4, 0.4, 0.4],
    gap: 20,
  });

  pdf.heading("Facilities");
  pdf.table(
    ["Facility", "Type", "License #", "Active Staff"],
    facilities.map((f) => [f.name, f.facility_type, f.license_number ?? "—", String(activeCountByFacility.get(f.id) ?? 0)]),
    [220, 80, 120, 90],
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
      pdf.text(`...and ${nonCompliantRecords.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
      pdf.text(`...and ${nonCompliantPracticums.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
      shown.map((a) => [a.severity, a.title, new Date(a.created_at).toLocaleDateString()]),
      [80, 300, 100],
    );
  }

  const pdfBytes = await pdf.save();
  const path = `${orgId}/${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await adminClient.storage.from("binder-exports").upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from("binder-exports")
    .createSignedUrl(path, 60 * 10);
  if (signedUrlError || !signedUrlData) return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);

  await adminClient.from("audit_logs").insert({
    organization_id: orgId,
    actor_profile_id: callerUser.id,
    entity_type: "compliance_binder",
    action: "generated",
    new_values: { storage_path: path },
  });

  return json({ success: true, url: signedUrlData.signedUrl, path, expiresIn: 600 });
});
