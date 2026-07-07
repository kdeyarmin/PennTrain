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

  let body: { organization_id?: string; facility_id?: string; facility_ids?: string[] } = {};
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

  // org_admin/auditor may optionally narrow the binder to one or more of their own org's
  // facilities via facility_id/facility_ids -- platform_admin's scope stays governed entirely by
  // organization_id above (no facility narrowing here), and this block only ever runs for
  // org_admin/auditor, so it can never widen or otherwise change facility_manager's own
  // auto-derived scope just above. Requested ids are checked against `orgId`, which is already
  // locked to the caller's own organization for every non-platform_admin role (see the orgId
  // computation above) -- the same "never trust the client, verify server-side" rule that block
  // already follows for facility_manager.
  if (callerProfile.role === "org_admin" || callerProfile.role === "auditor") {
    const requested = Array.isArray(body.facility_ids) && body.facility_ids.length > 0
      ? body.facility_ids
      : body.facility_id
        ? [body.facility_id]
        : null;
    if (requested) {
      const { data: matchedFacilities, error: facilityScopeError } = await adminClient
        .from("facilities")
        .select("id")
        .eq("organization_id", orgId)
        .in("id", requested);
      if (facilityScopeError) return json({ error: facilityScopeError.message }, 500);
      const validIds = new Set((matchedFacilities ?? []).map((f) => f.id));
      if (requested.some((id) => !validIds.has(id))) {
        return json({ error: "one or more requested facilities are not part of your organization" }, 403);
      }
      facilityScope = requested;
    }
  }

  let facilitiesQuery = adminClient.from("facilities").select("id, name, facility_type, license_number").eq("organization_id", orgId).order("name");
  let employeesQuery = adminClient.from("employees").select("id, first_name, last_name, facility_id, status").eq("organization_id", orgId);
  let recordsQuery = adminClient
    .from("employee_training_records")
    .select("status, due_date, employee_id, facility_id, training_types(name, citation_topic_id)")
    .eq("organization_id", orgId);
  let practicumsQuery = adminClient.from("practicums").select("status, due_date, employee_id, facility_id").eq("organization_id", orgId);
  let certCountQuery = adminClient.from("certificates").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
  let alertsQuery = adminClient.from("alerts").select("severity, title, created_at").eq("organization_id", orgId).eq("status", "open").order("severity");
  let attestationsQuery = adminClient
    .from("policy_attestations")
    .select(
      "status, due_date, attested_at, auth_method, ip_address, employee_id, facility_id, " +
        "policy_attestation_campaigns(name, policy_documents(title))",
    )
    .eq("organization_id", orgId);
  let credentialsQuery = adminClient
    .from("employee_credentials")
    .select("status, expiration_date, employee_id, facility_id, credential_type, citation_topic_id")
    .eq("organization_id", orgId);
  let incidentsQuery = adminClient
    .from("incidents")
    .select("id, incident_type, severity, status, occurred_at, final_report_submitted_at, facility_id")
    .eq("organization_id", orgId)
    .order("occurred_at", { ascending: false });
  let inspectionItemsQuery = adminClient
    .from("inspection_items")
    .select("status, next_due_date, label, item_type, facility_id, citation_topic_id")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  let correctiveActionsQuery = adminClient
    .from("corrective_actions")
    .select("description, due_date, status, facility_id")
    .eq("organization_id", orgId)
    .neq("status", "completed");
  let residentsQuery = adminClient.from("residents").select("id, first_name, last_name, facility_id, status, sdcu, hospice").eq("organization_id", orgId);
  let residentComplianceQuery = adminClient
    .from("resident_compliance_items")
    .select("status, item_type, due_date, resident_id, facility_id, citation_topic_id")
    .eq("organization_id", orgId);
  const citationTopicsQuery = adminClient.from("dhs_citation_topics").select("id, chapter, citation_ref, category, title, frequency_weight").order("sort_order");

  if (facilityScope) {
    facilitiesQuery = facilitiesQuery.in("id", facilityScope);
    employeesQuery = employeesQuery.in("facility_id", facilityScope);
    recordsQuery = recordsQuery.in("facility_id", facilityScope);
    practicumsQuery = practicumsQuery.in("facility_id", facilityScope);
    certCountQuery = certCountQuery.in("facility_id", facilityScope);
    alertsQuery = alertsQuery.in("facility_id", facilityScope);
    attestationsQuery = attestationsQuery.in("facility_id", facilityScope);
    credentialsQuery = credentialsQuery.in("facility_id", facilityScope);
    incidentsQuery = incidentsQuery.in("facility_id", facilityScope);
    inspectionItemsQuery = inspectionItemsQuery.in("facility_id", facilityScope);
    correctiveActionsQuery = correctiveActionsQuery.in("facility_id", facilityScope);
    residentsQuery = residentsQuery.in("facility_id", facilityScope);
    residentComplianceQuery = residentComplianceQuery.in("facility_id", facilityScope);
  }

  const [
    facilitiesRes, employeesRes, recordsRes, practicumsRes, certCountRes, alertsRes, attestationsRes,
    credentialsRes, incidentsRes, inspectionItemsRes, correctiveActionsRes, citationTopicsRes,
    residentsRes, residentComplianceRes,
  ] = await Promise.all([
    facilitiesQuery,
    employeesQuery,
    recordsQuery,
    practicumsQuery,
    certCountQuery,
    alertsQuery,
    attestationsQuery,
    credentialsQuery,
    incidentsQuery,
    inspectionItemsQuery,
    correctiveActionsQuery,
    citationTopicsQuery,
    residentsQuery,
    residentComplianceQuery,
  ]);

  if (facilitiesRes.error) return json({ error: facilitiesRes.error.message }, 500);
  if (employeesRes.error) return json({ error: employeesRes.error.message }, 500);
  if (recordsRes.error) return json({ error: recordsRes.error.message }, 500);
  if (practicumsRes.error) return json({ error: practicumsRes.error.message }, 500);
  if (alertsRes.error) return json({ error: alertsRes.error.message }, 500);
  if (attestationsRes.error) return json({ error: attestationsRes.error.message }, 500);
  if (credentialsRes.error) return json({ error: credentialsRes.error.message }, 500);
  if (incidentsRes.error) return json({ error: incidentsRes.error.message }, 500);
  if (inspectionItemsRes.error) return json({ error: inspectionItemsRes.error.message }, 500);
  if (correctiveActionsRes.error) return json({ error: correctiveActionsRes.error.message }, 500);
  if (citationTopicsRes.error) return json({ error: citationTopicsRes.error.message }, 500);
  if (residentsRes.error) return json({ error: residentsRes.error.message }, 500);
  if (residentComplianceRes.error) return json({ error: residentComplianceRes.error.message }, 500);

  const facilities = facilitiesRes.data ?? [];
  const employees = employeesRes.data ?? [];
  const records = recordsRes.data ?? [];
  const practicums = practicumsRes.data ?? [];
  const certCount = certCountRes.count ?? 0;
  const credentials = credentialsRes.data ?? [];
  const incidents = incidentsRes.data ?? [];
  const inspectionItems = inspectionItemsRes.data ?? [];
  const correctiveActions = correctiveActionsRes.data ?? [];
  const citationTopics = citationTopicsRes.data ?? [];
  const alerts = alertsRes.data ?? [];
  const attestations = attestationsRes.data ?? [];
  const residents = residentsRes.data ?? [];
  const residentCompliance = residentComplianceRes.data ?? [];

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

  const today = new Date().toISOString().slice(0, 10);
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

  pdf.text(org.name, { size: 20, bold: true, gap: 4 });
  pdf.text("Compliance Binder", { size: 14, gap: 16 });
  pdf.text(`Generated: ${generatedAt}`, { size: 9, color: [0.4, 0.4, 0.4] });
  pdf.text(`Generated by: ${callerProfile.first_name} ${callerProfile.last_name} (${callerProfile.role})`, {
    size: 9,
    color: [0.4, 0.4, 0.4],
    gap: 20,
  });

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
        f.name, f.facility_type, f.license_number ?? "—", String(activeCountByFacility.get(f.id) ?? 0),
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
      pdf.text(`...and ${outstandingAttestations.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
          a.attested_at ? new Date(a.attested_at).toLocaleString() : "—",
          a.auth_method ?? "—",
          a.ip_address ?? "—",
        ];
      }),
      [130, 150, 130, 100, 90],
    );
    if (signedAttestations.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${signedAttestations.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
      pdf.text(`...and ${nonCompliantCredentials.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
        new Date(i.occurred_at).toLocaleDateString(),
        i.status.replace(/_/g, " "),
        i.final_report_submitted_at ? "Submitted" : "Outstanding",
      ]),
      [110, 130, 80, 90, 100, 90],
    );
    if (incidents.length > MAX_LISTED_ROWS) {
      pdf.text(`...and ${incidents.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
      pdf.text(`...and ${nonCompliantInspectionItems.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
      pdf.text(`...and ${openCorrectiveActions.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
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
      pdf.text(`...and ${nonCompliantResidentItems.length - MAX_LISTED_ROWS} more (truncated for report length).`, {
        size: 8,
        color: [0.5, 0.5, 0.5],
      });
    }
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
