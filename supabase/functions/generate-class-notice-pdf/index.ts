// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import QRCode from "npm:qrcode@1.5.4";

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

const NOTICES_BUCKET = "class-notices";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const SIGNIN_ROWS = 18;
// Falls back to this default when the caller doesn't pass its own origin -- matches the domain
// generate-certificate-pdf already prints on issued certificates ("Verify at
// caremetrictrain.com/verify/...") for consistency across every PDF this app generates.
const DEFAULT_APP_ORIGIN = "https://caremetrictrain.com";
// Known app origins (see DEPLOYMENT.md's Supabase Auth redirect URL config) -- the caller-supplied
// baseUrl is only honored if it matches one of these, so this endpoint can't be used to embed an
// arbitrary attacker domain in the check-in QR code printed on the class notice.
const ALLOWED_APP_ORIGINS = new Set([
  "https://caremetrictrain.com",
  "https://carebase-production.up.railway.app",
]);

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

  heading(text: string, size = 13) {
    this.ensureSpace(size + 14);
    this.y -= size;
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font: this.bold, color: rgb(0.16, 0.22, 0.44) });
    this.y -= 6;
  }

  text(str: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const [r, g, b] = opts.color ?? [0, 0, 0];
    this.ensureSpace(size + 4);
    this.page.drawText(str, { x: MARGIN, y: this.y, size, font, color: rgb(r, g, b) });
    this.y -= size + (opts.gap ?? 6);
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

  const callerClient = createClient<any>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  let body: { classId?: string; baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { classId, baseUrl } = body;
  if (!classId) return json({ error: "classId is required" }, 400);

  // RLS-scoped read: training_classes_select already gates who can see this class. If the caller
  // isn't allowed to see it, this returns no row -- no separate authorization check needed here.
  const { data: cls, error: clsError } = await callerClient
    .from("training_classes")
    .select(
      "id, organization_id, class_name, class_date, duration_hours, location, notes, " +
        "training_types(name), facilities(name), profiles(first_name, last_name)",
    )
    .eq("id", classId)
    .maybeSingle();
  if (clsError) return json({ error: clsError.message }, 500);
  if (!cls) return json({ error: "Training class not found" }, 404);

  // generate_class_checkin_token() enforces its own authorization (trainer-owns-class or
  // org_admin/facility_manager) -- if the caller isn't allowed to run check-in for this class,
  // this call itself fails, so there's nothing further to check before using its result.
  const { data: token, error: tokenError } = await callerClient.rpc("generate_class_checkin_token", {
    p_class_id: classId,
    p_long_lived: true,
  });
  if (tokenError) return json({ error: tokenError.message }, 500);

  const requestedOrigin = baseUrl?.replace(/\/$/, "");
  const origin = requestedOrigin && ALLOWED_APP_ORIGINS.has(requestedOrigin) ? requestedOrigin : DEFAULT_APP_ORIGIN;
  const checkinUrl = `${origin}/checkin/${token}`;
  const qrPng = await QRCode.toBuffer(checkinUrl, { width: 220, margin: 1 });

  const trainingTypeName = (cls.training_types as unknown as { name: string } | null)?.name ?? "Training";
  const facilityName = (cls.facilities as unknown as { name: string } | null)?.name ?? null;
  const trainerProfile = cls.profiles as unknown as { first_name: string; last_name: string } | null;
  const trainerName = trainerProfile ? `${trainerProfile.first_name} ${trainerProfile.last_name}` : "—";
  const classDateFormatted = new Date(`${cls.class_date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const pdf = new PdfWriter();
  await pdf.init();
  const qrImage = await pdf.doc.embedPng(qrPng);

  pdf.heading("Notice of Staff Meeting / In-Service Training", 16);
  pdf.text(cls.class_name, { size: 13, bold: true, gap: 10 });

  pdf.text(`Topic: ${trainingTypeName}`, { gap: 4 });
  pdf.text(`Date: ${classDateFormatted}`, { gap: 4 });
  pdf.text(`Duration: ${cls.duration_hours} hour${Number(cls.duration_hours) === 1 ? "" : "s"}`, { gap: 4 });
  pdf.text(`Location: ${cls.location ?? facilityName ?? "—"}`, { gap: 4 });
  pdf.text(`Instructor: ${trainerName}`, { gap: 4 });
  if (cls.notes) pdf.text(`Notes: ${cls.notes}`, { gap: 4 });

  pdf.y -= 8;
  pdf.text("Scan the QR code below with your phone to check in when you arrive, and scan it again", { size: 9, color: [0.35, 0.35, 0.35], gap: 2 });
  pdf.text("when you leave to check out. This verifies your attendance and seat time electronically.", { size: 9, color: [0.35, 0.35, 0.35], gap: 10 });

  pdf.ensureSpace(160);
  const qrSize = 140;
  const qrX = (PAGE_WIDTH - qrSize) / 2;
  pdf.page.drawImage(qrImage, { x: qrX, y: pdf.y - qrSize, width: qrSize, height: qrSize });
  pdf.y -= qrSize + 20;

  pdf.heading("Sign-In Sheet (backup / paper record)");
  pdf.text("If you're unable to scan the QR code, print your name below and sign in/out by hand.", { size: 9, color: [0.35, 0.35, 0.35], gap: 10 });

  const colWidths = [160, 160, 100, 100];
  const headers = ["Name (print)", "Signature", "Time In", "Time Out"];
  const rowHeight = 26;
  pdf.ensureSpace(rowHeight * 2);
  let x = MARGIN;
  headers.forEach((h, i) => {
    pdf.page.drawText(h, { x, y: pdf.y, size: 9, font: pdf.bold, color: rgb(0.35, 0.35, 0.35) });
    x += colWidths[i];
  });
  pdf.y -= 6;
  pdf.page.drawLine({ start: { x: MARGIN, y: pdf.y }, end: { x: PAGE_WIDTH - MARGIN, y: pdf.y }, thickness: 0.75, color: rgb(0.6, 0.6, 0.6) });
  pdf.y -= rowHeight;

  for (let i = 0; i < SIGNIN_ROWS; i++) {
    pdf.ensureSpace(rowHeight);
    let cellX = MARGIN;
    for (const w of colWidths) {
      pdf.page.drawLine({
        start: { x: cellX, y: pdf.y }, end: { x: cellX + w - 10, y: pdf.y },
        thickness: 0.5, color: rgb(0.75, 0.75, 0.75),
      });
      cellX += w;
    }
    pdf.y -= rowHeight;
  }

  const pdfBytes = await pdf.save();
  const path = `${cls.organization_id}/${classId}.pdf`;

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const { error: uploadError } = await adminClient.storage.from(NOTICES_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(NOTICES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);

  return json({ success: true, url: signedUrlData.signedUrl, path, expiresIn: SIGNED_URL_TTL_SECONDS });
});
