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

const REPORTS_BUCKET = "incident-reports";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

interface StaffRow { involvement_type: string; employees: { first_name: string; last_name: string } | null }
interface NotificationRow {
  notification_type: string; due_at: string; completed_at: string | null; status: string;
  notification_method: string | null; recipient: string | null; reference_number: string | null;
}
interface CorrectiveActionRow { description: string; due_date: string; completed_date: string | null; status: string; owner_name: string | null }

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

async function buildIncidentReportPdf(input: {
  organizationName: string;
  facilityName: string;
  incidentType: string;
  severity: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
  residentIdentifier: string | null;
  locationDetail: string | null;
  narrative: string;
  investigationFindings: string | null;
  rootCause: string | null;
  staff: StaffRow[];
  notifications: NotificationRow[];
  correctiveActions: CorrectiveActionRow[];
  finalReportSubmittedAt: string | null;
}): Promise<Uint8Array> {
  const w = new PdfWriter();
  await w.init();

  w.page.drawText("Reportable Incident Report", { x: MARGIN, y: w.y, size: 18, font: w.bold, color: rgb(0.16, 0.22, 0.44) });
  w.y -= 22;
  w.page.drawText(`${input.organizationName} — ${input.facilityName}`, { x: MARGIN, y: w.y, size: 11, font: w.font, color: rgb(0.35, 0.35, 0.35) });
  w.y -= 20;

  w.heading("Incident Summary");
  w.field("Incident Type", humanize(input.incidentType));
  w.field("Severity", humanize(input.severity));
  w.field("Status", humanize(input.status));
  w.field("Occurred At", fmtDateTime(input.occurredAt));
  w.field("Reported At", fmtDateTime(input.reportedAt));
  w.field("Resident Identifier", input.residentIdentifier ?? "—");
  w.field("Location", input.locationDetail ?? "—");

  w.heading("Narrative");
  w.paragraph(input.narrative);

  if (input.investigationFindings || input.rootCause) {
    w.heading("Investigation");
    if (input.investigationFindings) { w.field("Findings", ""); w.paragraph(input.investigationFindings); }
    if (input.rootCause) { w.field("Root Cause", ""); w.paragraph(input.rootCause); }
  }

  w.heading("Staff Involved");
  if (input.staff.length === 0) {
    w.row("None recorded.");
  } else {
    for (const s of input.staff) {
      const name = s.employees ? `${s.employees.first_name} ${s.employees.last_name}` : "Unknown";
      w.row(`${name} — ${humanize(s.involvement_type)}`);
    }
  }

  w.heading("Required Notifications");
  if (input.notifications.length === 0) {
    w.row("None required for this incident type.");
  } else {
    for (const n of input.notifications) {
      w.row(`${humanize(n.notification_type)} — ${humanize(n.status)} — due ${fmtDateTime(n.due_at)}`);
      if (n.completed_at) {
        w.row(`  Completed ${fmtDateTime(n.completed_at)}${n.notification_method ? ` via ${n.notification_method}` : ""}${n.recipient ? ` — notified: ${n.recipient}` : ""}${n.reference_number ? ` — ref# ${n.reference_number}` : ""}`);
      }
    }
  }

  w.heading("Corrective Actions");
  if (input.correctiveActions.length === 0) {
    w.row("None recorded.");
  } else {
    for (const ca of input.correctiveActions) {
      w.row(`${ca.description} — ${humanize(ca.status)} — due ${ca.due_date}${ca.completed_date ? `, completed ${ca.completed_date}` : ""}${ca.owner_name ? ` — owner: ${ca.owner_name}` : ""}`);
    }
  }

  w.heading("Final Report");
  w.field("Submitted", input.finalReportSubmittedAt ? fmtDateTime(input.finalReportSubmittedAt) : "Not yet submitted");

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

  let body: { incidentId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { incidentId } = body;
  if (!incidentId) return json({ error: "incidentId is required" }, 400);

  // RLS-scoped read on the caller's own client: incidents_select already gates who can see this
  // incident (platform_admin, org_admin/auditor org-wide, facility_manager assigned to its
  // facility) -- no separate authorization check needed here.
  const { data: incident, error: incidentError } = await callerClient
    .from("incidents")
    .select(
      "id, organization_id, incident_type, severity, status, occurred_at, reported_at, resident_identifier, " +
        "location_detail, narrative, investigation_findings, root_cause, final_report_submitted_at, " +
        "organizations(name), facilities(name)",
    )
    .eq("id", incidentId)
    .maybeSingle();
  if (incidentError) return json({ error: incidentError.message }, 500);
  if (!incident) return json({ error: "Incident not found" }, 404);

  const [{ data: staff }, { data: notifications }, { data: correctiveActions }] = await Promise.all([
    callerClient.from("incident_staff_involved").select("involvement_type, employees(first_name, last_name)").eq("incident_id", incidentId),
    callerClient.from("incident_notifications").select("notification_type, due_at, completed_at, status, notification_method, recipient, reference_number").eq("incident_id", incidentId),
    callerClient.from("corrective_actions").select("description, due_date, completed_date, status, owner_name").eq("incident_id", incidentId),
  ]);

  const organizationName = (incident.organizations as unknown as { name: string } | null)?.name ?? "";
  const facilityName = (incident.facilities as unknown as { name: string } | null)?.name ?? "";

  const pdfBytes = await buildIncidentReportPdf({
    organizationName,
    facilityName,
    incidentType: incident.incident_type,
    severity: incident.severity,
    status: incident.status,
    occurredAt: incident.occurred_at,
    reportedAt: incident.reported_at,
    residentIdentifier: incident.resident_identifier,
    locationDetail: incident.location_detail,
    narrative: incident.narrative,
    investigationFindings: incident.investigation_findings,
    rootCause: incident.root_cause,
    staff: (staff ?? []) as unknown as StaffRow[],
    notifications: (notifications ?? []) as unknown as NotificationRow[],
    correctiveActions: (correctiveActions ?? []) as unknown as CorrectiveActionRow[],
    finalReportSubmittedAt: incident.final_report_submitted_at,
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const path = `${incident.organization_id}/${incident.id}.pdf`;

  // Always regenerated (no cache-skip like the certificate PDF) -- an incident report is a living
  // document that changes as the investigation progresses, so upsert:true intentionally overwrites
  // whatever was there before.
  const { error: uploadError } = await adminClient.storage.from(REPORTS_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { error: updateError } = await adminClient
    .from("incidents")
    .update({ report_pdf_storage_bucket: REPORTS_BUCKET, report_pdf_storage_path: path })
    .eq("id", incident.id);
  if (updateError) return json({ error: updateError.message }, 500);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  return json({ success: true, url: signedUrlData.signedUrl, path, expiresIn: SIGNED_URL_TTL_SECONDS });
});
