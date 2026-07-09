// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

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

const CERTIFICATES_BUCKET = "certificates";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// Landscape Letter -- the traditional certificate orientation.
const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 60;

function truncate(str: string, maxWidth: number, font: PDFFont, size: number) {
  let s = str;
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s === str ? s : s.slice(0, -1) + "…";
}

async function buildCertificatePdf(input: {
  employeeName: string;
  courseTitle: string;
  organizationName: string;
  issuedAt: string;
  expiresAt: string | null;
  slug: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const maxTextWidth = PAGE_WIDTH - (MARGIN + 20) * 2;

  const center = (
    str: string,
    y: number,
    size: number,
    f: PDFFont,
    color: [number, number, number] = [0.1, 0.1, 0.1],
  ) => {
    const shown = truncate(str, maxTextWidth, f, size);
    const width = f.widthOfTextAtSize(shown, size);
    page.drawText(shown, { x: (PAGE_WIDTH - width) / 2, y, size, font: f, color: rgb(color[0], color[1], color[2]) });
  };

  // Decorative border -- keeps this looking like a certificate rather than a text dump.
  page.drawRectangle({
    x: MARGIN - 24,
    y: MARGIN - 24,
    width: PAGE_WIDTH - (MARGIN - 24) * 2,
    height: PAGE_HEIGHT - (MARGIN - 24) * 2,
    borderColor: rgb(0.16, 0.22, 0.44),
    borderWidth: 2,
  });

  const dateFmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let y = PAGE_HEIGHT - MARGIN - 20;
  center("CERTIFICATE OF COMPLETION", y, 26, bold, [0.16, 0.22, 0.44]);
  y -= 46;
  center("This certifies that", y, 12, italic, [0.4, 0.4, 0.4]);
  y -= 32;
  center(input.employeeName, y, 22, bold);
  y -= 30;
  center("has successfully completed the course", y, 12, italic, [0.4, 0.4, 0.4]);
  y -= 28;
  center(input.courseTitle, y, 16, bold);
  y -= 44;

  const issuedLine = `Issued: ${dateFmt(input.issuedAt)}`;
  const expiresLine = input.expiresAt ? `   |   Expires: ${dateFmt(input.expiresAt)}` : "";
  center(issuedLine + expiresLine, y, 11, font, [0.25, 0.25, 0.25]);
  y -= 20;

  if (input.organizationName) {
    center(`Issued by ${input.organizationName}`, y, 11, font, [0.25, 0.25, 0.25]);
    y -= 20;
  }

  y -= 16;
  center(`Certificate ID: ${input.slug}`, y, 9, font, [0.5, 0.5, 0.5]);
  y -= 16;
  center(`Verify at caremetrictrain.com/verify/${input.slug}`, y, 9, font, [0.5, 0.5, 0.5]);

  return await doc.save();
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

  let body: { certificateId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { certificateId } = body;
  if (!certificateId) return json({ error: "certificateId is required" }, 400);

  // RLS-scoped read on the caller's own client: certificates_select only allows platform_admin,
  // the certificate's own employee (owns_employee), or org/facility staff assigned over it. If the
  // caller isn't allowed to see this certificate, this simply returns no row -- which we treat below
  // as a 404, with no separate authorization check needed.
  const { data: cert, error: certError } = await callerClient
    .from("certificates")
    .select(
      "id, organization_id, slug, issued_at, expires_at, pdf_storage_bucket, pdf_storage_path, " +
        "courses(title), employees(first_name, last_name), organizations(name)",
    )
    .eq("id", certificateId)
    .maybeSingle();
  if (certError) return json({ error: certError.message }, 500);
  if (!cert) return json({ error: "Certificate not found" }, 404);

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  // Cheap path: this certificate's PDF was already generated once before -- just mint a fresh
  // signed URL for the existing object instead of re-rendering and re-uploading on every click.
  if (cert.pdf_storage_bucket && cert.pdf_storage_path) {
    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
      .from(cert.pdf_storage_bucket)
      .createSignedUrl(cert.pdf_storage_path, SIGNED_URL_TTL_SECONDS);
    if (signedUrlError || !signedUrlData) {
      return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
    }
    return json({
      success: true,
      url: signedUrlData.signedUrl,
      path: cert.pdf_storage_path,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }

  const courseTitle = (cert.courses as unknown as { title: string } | null)?.title ?? "Untitled Course";
  const employee = cert.employees as unknown as { first_name: string; last_name: string } | null;
  const employeeName = employee ? `${employee.first_name} ${employee.last_name}` : "Unknown Employee";
  const organizationName = (cert.organizations as unknown as { name: string } | null)?.name ?? "";

  const pdfBytes = await buildCertificatePdf({
    employeeName,
    courseTitle,
    organizationName,
    issuedAt: cert.issued_at,
    expiresAt: cert.expires_at,
    slug: cert.slug,
  });

  const path = `${cert.organization_id}/${cert.id}.pdf`;

  // upsert:true (unlike generate-compliance-binder's random-UUID export paths) is intentional here:
  // this path is deterministic per certificate, so a rare double-submit race re-writing the same
  // bytes to the same path is a safe no-op rather than an "already exists" upload error.
  const { error: uploadError } = await adminClient.storage.from(CERTIFICATES_BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  // certificates carries a protect_certificate_write() trigger that rejects direct writes from a
  // plain service-role UPDATE (see 20260705060000_generate_certificate_pdf_rpc.sql) -- set_certificate_pdf()
  // is the sanctioned, service-role-only RPC that flips the same txn-local escape hatch internally.
  const { error: rpcError } = await adminClient.rpc("set_certificate_pdf", {
    p_certificate_id: cert.id,
    p_bucket: CERTIFICATES_BUCKET,
    p_path: path,
  });
  if (rpcError) return json({ error: rpcError.message }, 500);

  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(CERTIFICATES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return json({ error: signedUrlError?.message ?? "failed to create signed url" }, 500);
  }

  return json({ success: true, url: signedUrlData.signedUrl, path, expiresIn: SIGNED_URL_TTL_SECONDS });
});
