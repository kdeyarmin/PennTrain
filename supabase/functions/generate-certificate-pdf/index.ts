// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import QRCode from "npm:qrcode@1.5.4";
import {
  CRON_SECRET_HEADER,
  requireCronRequest,
} from "../_shared/cronAuth.ts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { toWinAnsi } from "../_shared/pdfText.ts";

/**
 * This function serves BOTH the browser and the cron worker, so its CORS headers have to be
 * origin-aware -- built per request, not a module constant.
 *
 * It previously wrapped a literal `"Access-Control-Allow-Origin": "*"` in withCronCorsHeader,
 * whose entire job is to STRIP that header ("cron/webhook endpoints are not browser-invoked and
 * must not advertise wildcard (or any) CORS origin", _shared/cronAuth.ts). The result was a
 * response with no Access-Control-Allow-Origin at all -- including on the preflight -- so the
 * browser blocked the "Prepare PDF" call that useCertificates.ts:76 makes and config.toml
 * documents this function as serving. Every other withCronCorsHeader caller really is cron-only;
 * generate-compliance-binder, which config.toml names as having this same dual-purpose split,
 * already uses the origin-aware helper. This now matches it, keeping the cron secret in
 * Allow-Headers for the worker.
 */
function certificateCorsHeaders(req: Request) {
  // Not withCronCorsHeader: that helper's whole job is to REMOVE the origin, which is right for a
  // cron-only endpoint and wrong here. The cron secret is named in Allow-Headers directly instead,
  // so the worker's header is still permitted without erasing the browser's origin.
  return corsHeadersForRequest(req, {
    headers:
      `authorization, x-client-info, apikey, content-type, x-correlation-id, x-request-id, ${CRON_SECRET_HEADER}`,
  });
}

const CERTIFICATES_BUCKET = "certificates";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// Landscape Letter -- the traditional certificate orientation.
const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 60;

// Every facility this app serves is in Pennsylvania (America/New_York) -- dates must render in
// that zone explicitly rather than the Deno runtime's default (UTC on Supabase), or an evening
// course completion prints an Issued date one day after the training record's pa_today()-stamped
// completion_date.
const PA_TIME_ZONE = "America/New_York";

function truncate(str: string, maxWidth: number, font: PDFFont, size: number) {
  // Every rendered string passes through here, so this is the one WinAnsi boundary:
  // Helvetica throws inside widthOfTextAtSize on any non-CP1252 character (real employee
  // names hit this), which failed the render job before any drawText ran.
  const encodable = toWinAnsi(str);
  let s = encodable;
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s === encodable ? s : s.slice(0, -1) + "…";
}

/**
 * One "Label: value" line, or nothing at all when the course does not record that fact. A
 * certificate for a course with no examination and no named provider therefore prints exactly as
 * it did before these fields existed, rather than a column of dashes.
 */
type DetailLine = { label: string; value: string };

/**
 * QR image for the public verification URL, or null.
 *
 * Deliberately best-effort: a certificate that renders without a QR is still a valid certificate
 * with the verification URL printed on it, and PDF generation for every course in the product runs
 * through this function. A QR encoder problem must not be able to stop a learner getting their
 * certificate.
 */
async function verificationQrPng(url: string): Promise<Uint8Array | null> {
  try {
    const dataUrl: string = await QRCode.toDataURL(url, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: "M",
    });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (error) {
    console.error("Certificate QR encoding failed; falling back to the printed URL", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function buildCertificatePdf(input: {
  employeeName: string;
  courseTitle: string;
  organizationName: string;
  facilityName: string | null;
  issuedAt: string;
  expiresAt: string | null;
  slug: string;
  credentialNumber: string;
  courseCode: string | null;
  courseVersion: string | null;
  regulatoryReference: string | null;
  trainingProvider: string | null;
  providerCredential: string | null;
  finalExamScore: number | null;
  statement: string | null;
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
    page.drawText(shown, {
      x: (PAGE_WIDTH - width) / 2,
      y,
      size,
      font: f,
      color: rgb(color[0], color[1], color[2]),
    });
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

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: PA_TIME_ZONE,
    });

  let y = PAGE_HEIGHT - MARGIN - 20;
  center("CERTIFICATE OF COMPLETION", y, 26, bold, [0.16, 0.22, 0.44]);
  y -= 46;
  center("This certifies that", y, 12, italic, [0.4, 0.4, 0.4]);
  y -= 32;
  center(input.employeeName, y, 22, bold);
  y -= 30;
  center("has successfully completed the course", y, 12, italic, [
    0.4,
    0.4,
    0.4,
  ]);
  y -= 28;
  center(input.courseTitle, y, 16, bold);
  y -= 30;

  // The regulatory statement, when the course supplies one. Deliberately never "DHS APPROVED":
  // this certificate states what the training was designed to address, not that a department
  // approved it.
  if (input.statement) {
    center(input.statement, y, 10, italic, [0.3, 0.3, 0.3]);
    y -= 22;
  }

  const issuedLine = `Issued: ${dateFmt(input.issuedAt)}`;
  const expiresLine = input.expiresAt
    ? `   |   Renewal due: ${dateFmt(input.expiresAt)}`
    : "";
  center(issuedLine + expiresLine, y, 11, font, [0.25, 0.25, 0.25]);
  y -= 20;

  if (input.organizationName) {
    const issuedBy = input.facilityName
      ? `${input.organizationName} -- ${input.facilityName}`
      : input.organizationName;
    center(`Issued by ${issuedBy}`, y, 11, font, [
      0.25,
      0.25,
      0.25,
    ]);
    y -= 20;
  }

  const details: DetailLine[] = [];
  if (input.courseCode) details.push({ label: "Course code", value: input.courseCode });
  if (input.courseVersion) details.push({ label: "Course version", value: input.courseVersion });
  if (input.regulatoryReference) {
    details.push({ label: "Regulatory reference", value: input.regulatoryReference });
  }
  if (input.finalExamScore !== null) {
    details.push({ label: "Final examination score", value: `${input.finalExamScore}%` });
  }
  if (input.trainingProvider) {
    details.push({
      label: "Training provider",
      value: input.providerCredential
        ? `${input.trainingProvider}, ${input.providerCredential}`
        : input.trainingProvider,
    });
  }

  if (details.length > 0) {
    y -= 6;
    // Two columns, so a long list does not push the credential number off the page.
    const columnWidth = (PAGE_WIDTH - MARGIN * 2) / 2;
    const rows = Math.ceil(details.length / 2);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        const detail = details[row * 2 + column];
        if (!detail) continue;
        const text = truncate(`${detail.label}: ${detail.value}`, columnWidth - 20, font, 9);
        page.drawText(text, {
          x: MARGIN + column * columnWidth + 10,
          y,
          size: 9,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
      y -= 14;
    }
  }

  y -= 10;
  center(`Credential number: ${input.credentialNumber}`, y, 9, font, [
    0.5,
    0.5,
    0.5,
  ]);
  y -= 16;
  const verifyBase = verificationBase();
  const verifyUrl = `${verifyBase}/verify/${input.slug}`;
  center(`Verify at ${verifyUrl.replace(/^https?:\/\//, "")}`, y, 9, font, [
    0.5,
    0.5,
    0.5,
  ]);

  // The URL stays printed whether or not the QR renders: a surveyor with a phone scans, a surveyor
  // with a keyboard types, and neither depends on the other.
  const qrPng = await verificationQrPng(verifyUrl);
  if (qrPng) {
    const qrImage = await doc.embedPng(qrPng);
    const qrSize = 72;
    page.drawImage(qrImage, {
      x: PAGE_WIDTH - MARGIN - qrSize,
      y: MARGIN - 8,
      width: qrSize,
      height: qrSize,
    });
    const caption = "Scan to verify";
    page.drawText(caption, {
      x: PAGE_WIDTH - MARGIN - qrSize
        + (qrSize - font.widthOfTextAtSize(caption, 7)) / 2,
      y: MARGIN - 18,
      size: 7,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  return await doc.save();
}

type CertificatePdfClaim = {
  job_id: string;
  certificate_id: string;
  correlation_id: string;
  run_id: string;
  attempt_count: number;
};

type SystemJobClaim = {
  run_id: string;
  should_execute: boolean;
  existing_status: string | null;
};

type CertificateRecord = {
  id: string;
  organization_id: string;
  slug: string;
  credential_number: string;
  issued_at: string;
  expires_at: string | null;
  pdf_storage_bucket: string | null;
  pdf_storage_path: string | null;
  course_assignment_id: string | null;
  // Snapshotted at issuance (20260830210000). Null only on certificates issued before that,
  // which fall back to the live profile below.
  training_provider: string | null;
  provider_credential: string | null;
  courses:
    | {
      title: string;
      catalog_code: string | null;
      course_provider_profiles:
        | { provider_full_name: string; credential: string | null }
        | Array<{ provider_full_name: string; credential: string | null }>
        | null;
    }
    | null;
  employees: { first_name: string; last_name: string } | null;
  organizations: { name: string } | null;
  facilities: { name: string } | null;
};

async function signPdf(
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
) {
  const { data, error } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create signed URL");
  }
  return data.signedUrl;
}

async function loadCertificate(
  adminClient: ReturnType<typeof createClient>,
  certificateId: string,
): Promise<CertificateRecord> {
  const { data, error } = await adminClient
    .from("certificates")
    .select(
      "id, organization_id, slug, credential_number, issued_at, expires_at, " +
        "pdf_storage_bucket, pdf_storage_path, course_assignment_id, " +
        "training_provider, provider_credential, " +
        "courses(title, catalog_code, course_provider_profiles(provider_full_name, credential)), " +
        "employees(first_name, last_name), organizations(name), facilities(name)",
    )
    .eq("id", certificateId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Certificate not found");
  }
  return data as unknown as CertificateRecord;
}

/**
 * Course code to the statement that belongs on that course's certificate.
 *
 * A certificate must never claim a department approved the course. The wording here says what the
 * training was designed to address, which is what the regulation supports. Extending this map is
 * how another regulated course gets its own line; a course that is not in it prints no statement.
 */
const DEFAULT_APP_ORIGIN = "https://cmcarebase.com";

/**
 * Origin for the printed and encoded verification link.
 *
 * A certificate outlives the request that made it, and a staging or preview deployment that
 * hard-codes production sends every scanner to a host where its own certificate slug does not
 * exist. generate-class-notice-pdf resolves generated links the same way.
 */
function verificationBase(): string {
  const configured = (Deno.env.get("PUBLIC_APP_URL") ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
  try {
    const parsed = new URL(configured.includes("://") ? configured : `https://${configured}`);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

const CERTIFICATE_STATEMENTS: Record<string, { statement: string; reference: string }> = {
  "PA-PCH-DIABETES-ANNUAL": {
    statement:
      "Successful completion of Annual Diabetes Patient Education designed to address the " +
      "training requirements of 55 Pa. Code Section 2600.190(b).",
    reference: "55 Pa. Code Section 2600.190(b)",
  },
};

async function loadCertificateDetail(
  adminClient: ReturnType<typeof createClient>,
  cert: CertificateRecord,
): Promise<{
  courseVersion: string | null;
  regulatoryReference: string | null;
  trainingProvider: string | null;
  providerCredential: string | null;
  finalExamScore: number | null;
  statement: string | null;
}> {
  // PostgREST returns an embedded one-to-one as an object and a one-to-many as an array
  // depending on how it resolves the relationship, so accept both rather than guessing.
  const rawProfile = cert.courses?.course_provider_profiles ?? null;
  const profile = Array.isArray(rawProfile) ? rawProfile[0] ?? null : rawProfile;
  const catalogCode = cert.courses?.catalog_code ?? null;
  const wording = catalogCode ? CERTIFICATE_STATEMENTS[catalogCode] ?? null : null;

  let courseVersion: string | null = null;
  let finalExamScore: number | null = null;

  if (cert.course_assignment_id) {
    // The version the learner actually took, not whatever the course points at today.
    const { data: assignment, error: versionError } = await adminClient
      .from("course_assignments")
      .select("course_versions(version_label, version_number)")
      .eq("id", cert.course_assignment_id)
      .maybeSingle();
    // A transient failure here is not "this certificate has no version". Swallowing it would
    // print a regulatory document missing its version and examination score, upload it, and mark
    // the job succeeded -- so the retry path that exists for exactly this never runs.
    if (versionError) throw versionError;
    const rawVersion = (assignment as { course_versions?: unknown } | null)?.course_versions ?? null;
    const version = (Array.isArray(rawVersion) ? rawVersion[0] : rawVersion) as
      | { version_label: string | null; version_number: number }
      | null;
    if (version) {
      courseVersion = version.version_label ?? `v${version.version_number}`;
    }

    const { data: attempts, error: attemptsError } = await adminClient
      .from("quiz_attempts")
      .select("score_percent, quizzes!inner(quiz_kind)")
      .eq("assignment_id", cert.course_assignment_id)
      .eq("passed", true)
      .eq("quizzes.quiz_kind", "final_exam");
    if (attemptsError) throw attemptsError;
    for (const row of (attempts ?? []) as Array<{ score_percent: number | null }>) {
      if (row.score_percent === null) continue;
      finalExamScore = finalExamScore === null
        ? row.score_percent
        : Math.max(finalExamScore, row.score_percent);
    }
  }

  return {
    courseVersion,
    regulatoryReference: wording?.reference ?? null,
    // The snapshot taken at issuance wins. The live profile is consulted only for certificates
    // issued before snapshotting existed -- otherwise editing the provider would restate what an
    // already-printed certificate says, and a reprint would disagree with the original.
    trainingProvider: cert.training_provider ?? profile?.provider_full_name ?? null,
    providerCredential: cert.provider_credential ?? profile?.credential ?? null,
    finalExamScore,
    statement: wording?.statement ?? null,
  };
}

async function finishFailedJob(
  adminClient: ReturnType<typeof createClient>,
  claim: CertificatePdfClaim,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  const { error: finishError } = await adminClient.rpc(
    "finish_certificate_pdf_job",
    {
      p_job_id: claim.job_id,
      p_run_id: claim.run_id,
      p_bucket: null,
      p_path: null,
      p_error_code: "render_failed",
      p_error_message: message.slice(0, 2000),
    },
  );
  if (finishError) {
    console.error("Unable to persist certificate PDF failure", {
      jobId: claim.job_id,
      runId: claim.run_id,
      error: finishError.message,
    });
  }
}

async function processClaimedJob(
  adminClient: ReturnType<typeof createClient>,
  claim: CertificatePdfClaim,
): Promise<{ certificateId: string; path: string }> {
  try {
    const cert = await loadCertificate(adminClient, claim.certificate_id);
    const employee = cert.employees;
    const detail = await loadCertificateDetail(adminClient, cert);
    const pdfBytes = await buildCertificatePdf({
      employeeName: employee
        ? `${employee.first_name} ${employee.last_name}`
        : "Unknown Employee",
      courseTitle: cert.courses?.title ?? "Untitled Course",
      organizationName: cert.organizations?.name ?? "",
      facilityName: cert.facilities?.name ?? null,
      issuedAt: cert.issued_at,
      expiresAt: cert.expires_at,
      slug: cert.slug,
      credentialNumber: cert.credential_number,
      courseCode: cert.courses?.catalog_code ?? null,
      courseVersion: detail.courseVersion,
      regulatoryReference: detail.regulatoryReference,
      trainingProvider: detail.trainingProvider,
      providerCredential: detail.providerCredential,
      finalExamScore: detail.finalExamScore,
      statement: detail.statement,
    });
    const path = `${cert.organization_id}/${cert.id}.pdf`;

    // A deterministic path and upsert make a reclaimed stale run safe. The run token below
    // prevents the stale worker from overwriting the newer job state after it wakes up.
    const { error: uploadError } = await adminClient.storage
      .from(CERTIFICATES_BUCKET)
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;

    const { data: finished, error: finishError } = await adminClient.rpc(
      "finish_certificate_pdf_job",
      {
        p_job_id: claim.job_id,
        p_run_id: claim.run_id,
        p_bucket: CERTIFICATES_BUCKET,
        p_path: path,
        p_error_code: null,
        p_error_message: null,
      },
    );
    if (finishError) throw finishError;
    if (!finished) {
      throw new Error("Certificate PDF job lease expired before completion");
    }

    return { certificateId: cert.id, path };
  } catch (error) {
    await finishFailedJob(adminClient, claim, error);
    throw error;
  }
}

async function finishSystemRun(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  status: "succeeded" | "partial" | "failed" | "cancelled",
  attempted: number,
  succeeded: number,
  failed: number,
  result: Record<string, unknown>,
  errorCode: string | null = null,
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await adminClient.rpc("finish_system_job", {
    p_run_id: runId,
    p_status: status,
    p_attempted_count: attempted,
    p_succeeded_count: succeeded,
    p_failed_count: failed,
    p_result: result,
    p_error_code: errorCode,
    p_error_message: errorMessage,
  });
  if (error) {
    throw new Error(
      `Could not finalize certificate PDF system job: ${error.message}`,
    );
  }
}

async function heartbeatSystemRun(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  attempted: number,
  succeeded: number,
  failed: number,
  certificateId: string,
): Promise<void> {
  const { error } = await adminClient.rpc("heartbeat_system_job", {
    p_run_id: runId,
    p_attempted_count: attempted,
    p_succeeded_count: succeeded,
    p_failed_count: failed,
    p_cursor: { certificateId },
  });
  if (error) {
    console.error("Could not heartbeat certificate PDF system job", {
      runId,
      certificateId,
    });
  }
}

async function cancellationRequested(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
): Promise<boolean> {
  const { data, error } = await adminClient.rpc(
    "is_system_job_cancellation_requested",
    {
      p_run_id: runId,
    },
  );
  if (error) {
    throw new Error(
      `Could not inspect certificate PDF cancellation state: ${error.message}`,
    );
  }
  return data === true;
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = certificateCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error(
      "Certificate PDF worker is missing required Supabase environment variables",
    );
    return json({ error: "Service is not configured" }, 500);
  }

  let body: { certificateId?: string; batchSize?: number } = {};
  const isCronRequest = req.headers.has(CRON_SECRET_HEADER);

  // Authenticate before buffering the body so unauthenticated callers cannot
  // force unbounded JSON parsing on this public (verify_jwt=false) endpoint.
  if (isCronRequest) {
    const cronError = requireCronRequest(req, CORS_HEADERS);
    if (cronError) return cronError;
  } else if (!req.headers.get("Authorization")) {
    return json({ error: "Missing Authorization header" }, 401);
  }

  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    return json({ error: "Invalid JSON body" }, 400);
  }

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  let requestedCertificate: CertificateRecord | null = null;

  if (!isCronRequest) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }
    if (!body.certificateId) {
      return json({ error: "certificateId is required" }, 400);
    }

    const callerClient = createClient<any>(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await callerClient.auth
      .getUser();
    if (authError || !user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const { data: profile, error: profileError } = await callerClient
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .single();
    if (profileError || !profile?.is_active) {
      return json({ error: "Caller profile not found or inactive" }, 403);
    }

    // This read is intentionally caller/RLS-scoped. The service-role client is used only after
    // the caller has proved they can select the requested certificate.
    const { data: visibleCert, error: certError } = await callerClient
      .from("certificates")
      .select("id, pdf_storage_bucket, pdf_storage_path")
      .eq("id", body.certificateId)
      .maybeSingle();
    if (certError) return json({ error: certError.message }, 500);
    if (!visibleCert) return json({ error: "Certificate not found" }, 404);

    requestedCertificate = await loadCertificate(
      adminClient,
      body.certificateId,
    );
  }

  const requestId = req.headers.get("x-request-id")?.slice(0, 200) ?? null;
  const cronBucket = `certificate-pdf-cron:${
    Math.floor(Date.now() / (5 * 60 * 1000))
  }`;
  const correlationId = (
    req.headers.get("x-correlation-id") ??
      requestId ??
      (isCronRequest
        ? cronBucket
        : `certificate-pdf-manual:${body.certificateId}:${crypto.randomUUID()}`)
  ).slice(0, 200);
  const { data: systemClaims, error: systemClaimError } = await adminClient.rpc(
    "claim_system_job_execution",
    {
      p_job_key: "certificate-pdf-generation",
      p_correlation_id: correlationId,
      p_trigger_type: isCronRequest ? "scheduled" : "manual",
      p_provider_request_id: requestId,
    },
  );
  if (systemClaimError) {
    return json(
      { error: "Certificate PDF job tracking failed", correlationId },
      500,
    );
  }

  const systemClaim = ((systemClaims ?? []) as SystemJobClaim[])[0];
  if (!systemClaim?.run_id) {
    return json({
      error: "Certificate PDF job tracking returned no run",
      correlationId,
    }, 500);
  }

  if (!systemClaim.should_execute) {
    if (
      !isCronRequest && requestedCertificate?.pdf_storage_bucket &&
      requestedCertificate.pdf_storage_path
    ) {
      try {
        const url = await signPdf(
          adminClient,
          requestedCertificate.pdf_storage_bucket,
          requestedCertificate.pdf_storage_path,
        );
        return json({
          success: true,
          replayed: true,
          runId: systemClaim.run_id,
          correlationId,
          url,
          path: requestedCertificate.pdf_storage_path,
          expiresIn: SIGNED_URL_TTL_SECONDS,
        });
      } catch (error) {
        // Storage/signing internals stay in the log; the caller (cron or an authenticated
        // user replaying a finished job) gets the correlation id to quote instead.
        console.error(
          "certificate replay: signing failed",
          error instanceof Error ? error.message : String(error),
        );
        return json({
          error: "Unable to issue the certificate download link",
          correlationId,
        }, 500);
      }
    }
    return json({
      success: systemClaim.existing_status === "succeeded",
      replayed: true,
      runId: systemClaim.run_id,
      correlationId,
      status: systemClaim.existing_status,
    }, systemClaim.existing_status === "running" ? 202 : 200);
  }

  const systemRunId = systemClaim.run_id;

  // Even the cheap signed-URL path is recorded as a manual run, so operators can distinguish
  // artifact generation from delivery of an already-generated artifact.
  if (
    !isCronRequest && requestedCertificate?.pdf_storage_bucket &&
    requestedCertificate.pdf_storage_path
  ) {
    try {
      const url = await signPdf(
        adminClient,
        requestedCertificate.pdf_storage_bucket,
        requestedCertificate.pdf_storage_path,
      );
      const result = {
        mode: "manual",
        alreadyReady: true,
        certificateId: requestedCertificate.id,
        correlationId,
      };
      await finishSystemRun(
        adminClient,
        systemRunId,
        "succeeded",
        0,
        0,
        0,
        result,
      );
      return json({
        success: true,
        runId: systemRunId,
        correlationId,
        url,
        path: requestedCertificate.pdf_storage_path,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await finishSystemRun(
          adminClient,
          systemRunId,
          "failed",
          1,
          0,
          1,
          {
            mode: "manual",
            certificateId: requestedCertificate.id,
            correlationId,
          },
          "signed_url_failed",
          message,
        );
      } catch (finishError) {
        console.error("Could not finalize failed certificate PDF delivery", {
          systemRunId,
          correlationId,
        });
      }
      return json({ error: message, runId: systemRunId, correlationId }, 500);
    }
  }

  const workerId = crypto.randomUUID();
  const requestedLimit = isCronRequest ? Number(body.batchSize ?? 10) : 1;
  const batchSize = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, Math.trunc(requestedLimit)))
    : 10;
  let attempted = 0;
  let failed = 0;
  let cancelled = false;
  let systemFinished = false;
  let deliveryError: string | null = null;
  const succeeded: Array<{ certificateId: string; path: string }> = [];
  const errors: Array<{ certificateId: string; message: string }> = [];

  try {
    // Claim one item at a time. If an operator cancels between items, no unstarted certificate
    // is left leased in "processing" until the stale-lock timeout.
    for (let index = 0; index < batchSize; index++) {
      if (await cancellationRequested(adminClient, systemRunId)) {
        cancelled = true;
        break;
      }

      const { data: claims, error: claimError } = await adminClient.rpc(
        "claim_certificate_pdf_jobs",
        {
          p_worker_id: workerId,
          p_certificate_id: isCronRequest ? null : body.certificateId,
          p_limit: 1,
        },
      );
      if (claimError) {
        throw new Error(
          `Could not claim certificate PDF job: ${claimError.message}`,
        );
      }

      const claim = ((claims ?? []) as CertificatePdfClaim[])[0];
      if (!claim) break;

      attempted++;
      try {
        succeeded.push(await processClaimedJob(adminClient, claim));
      } catch (error) {
        failed++;
        errors.push({
          certificateId: claim.certificate_id,
          message: (error instanceof Error ? error.message : String(error))
            .slice(0, 500),
        });
      }

      await heartbeatSystemRun(
        adminClient,
        systemRunId,
        attempted,
        succeeded.length,
        failed,
        claim.certificate_id,
      );

      if (!isCronRequest) break;
    }

    if (!isCronRequest && attempted === 0 && !cancelled) {
      // A certificate-specific worker may have won the lease just before this request. Recheck
      // for a completed artifact before recording the run as deferred.
      requestedCertificate = await loadCertificate(
        adminClient,
        body.certificateId!,
      );
      if (
        requestedCertificate.pdf_storage_bucket &&
        requestedCertificate.pdf_storage_path
      ) {
        const url = await signPdf(
          adminClient,
          requestedCertificate.pdf_storage_bucket,
          requestedCertificate.pdf_storage_path,
        );
        const result = {
          mode: "manual",
          alreadyReady: true,
          claimed: 0,
          succeeded: 0,
          failed: 0,
          certificateId: requestedCertificate.id,
          correlationId,
        };
        await finishSystemRun(
          adminClient,
          systemRunId,
          "succeeded",
          0,
          0,
          0,
          result,
        );
        systemFinished = true;
        return json({
          success: true,
          runId: systemRunId,
          correlationId,
          url,
          path: requestedCertificate.pdf_storage_path,
          expiresIn: SIGNED_URL_TTL_SECONDS,
        });
      }

      const result = {
        mode: "manual",
        deferred: true,
        claimed: 0,
        succeeded: 0,
        failed: 0,
        certificateId: body.certificateId,
        correlationId,
      };
      await finishSystemRun(
        adminClient,
        systemRunId,
        "partial",
        0,
        0,
        0,
        result,
        "pdf_job_busy",
        "Certificate PDF is already being prepared",
      );
      systemFinished = true;
      return json({
        error:
          "Certificate PDF is already being prepared. Please try again shortly.",
        runId: systemRunId,
        correlationId,
      }, 409);
    }

    let signedUrl: string | null = null;
    if (!isCronRequest && succeeded.length === 1) {
      try {
        signedUrl = await signPdf(
          adminClient,
          CERTIFICATES_BUCKET,
          succeeded[0].path,
        );
      } catch (error) {
        deliveryError = (error instanceof Error ? error.message : String(error))
          .slice(0, 500);
      }
    }

    const terminalStatus: "succeeded" | "partial" | "failed" | "cancelled" =
      cancelled
        ? "cancelled"
        : failed === 0 && deliveryError === null
        ? "succeeded"
        : succeeded.length > 0
        ? "partial"
        : "failed";
    const result = {
      mode: isCronRequest ? "scheduled" : "manual",
      claimed: attempted,
      succeeded: succeeded.length,
      failed,
      cancelled,
      certificateIds: succeeded.map((item) => item.certificateId),
      errors,
      deliveryError,
      correlationId,
    };
    await finishSystemRun(
      adminClient,
      systemRunId,
      terminalStatus,
      attempted,
      succeeded.length,
      failed,
      result,
      terminalStatus === "failed"
        ? "certificate_pdf_batch_failed"
        : deliveryError
        ? "signed_url_failed"
        : null,
      terminalStatus === "failed"
        ? errors[0]?.message ?? "Certificate PDF batch failed"
        : deliveryError,
    );
    systemFinished = true;

    if (isCronRequest || cancelled) {
      return json({
        success: terminalStatus === "succeeded",
        status: terminalStatus,
        runId: systemRunId,
        ...result,
      });
    }

    if (!signedUrl || succeeded.length !== 1) {
      return json({
        error: deliveryError ?? errors[0]?.message ??
          "Certificate PDF generation failed",
        status: terminalStatus,
        runId: systemRunId,
        correlationId,
      }, 500);
    }

    return json({
      success: true,
      status: terminalStatus,
      runId: systemRunId,
      correlationId,
      url: signedUrl,
      path: succeeded[0].path,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!systemFinished) {
      try {
        await finishSystemRun(
          adminClient,
          systemRunId,
          "failed",
          attempted,
          succeeded.length,
          Math.max(1, failed),
          {
            mode: isCronRequest ? "scheduled" : "manual",
            claimed: attempted,
            succeeded: succeeded.length,
            failed: Math.max(1, failed),
            correlationId,
            errors: [...errors, {
              certificateId: body.certificateId ?? "batch",
              message: message.slice(0, 500),
            }],
          },
          "certificate_pdf_worker_failed",
          message,
        );
      } catch (finishError) {
        console.error("Could not finalize certificate PDF system job", {
          systemRunId,
          correlationId,
        });
      }
    }
    return json({ error: message, runId: systemRunId, correlationId }, 500);
  }
});
