// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { PDFDocument, PDFFont, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import {
  CRON_SECRET_HEADER,
  requireCronRequest,
  withCronCorsHeader,
} from "../_shared/cronAuth.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id, x-request-id",
});

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
  credentialNumber: string;
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
  y -= 44;

  const issuedLine = `Issued: ${dateFmt(input.issuedAt)}`;
  const expiresLine = input.expiresAt
    ? `   |   Expires: ${dateFmt(input.expiresAt)}`
    : "";
  center(issuedLine + expiresLine, y, 11, font, [0.25, 0.25, 0.25]);
  y -= 20;

  if (input.organizationName) {
    center(`Issued by ${input.organizationName}`, y, 11, font, [
      0.25,
      0.25,
      0.25,
    ]);
    y -= 20;
  }

  y -= 16;
  center(`Credential number: ${input.credentialNumber}`, y, 9, font, [
    0.5,
    0.5,
    0.5,
  ]);
  y -= 16;
  center(`Verify at cmcarebase.com/verify/${input.slug}`, y, 9, font, [
    0.5,
    0.5,
    0.5,
  ]);

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
  courses: { title: string } | null;
  employees: { first_name: string; last_name: string } | null;
  organizations: { name: string } | null;
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
        "pdf_storage_bucket, pdf_storage_path, courses(title), " +
        "employees(first_name, last_name), organizations(name)",
    )
    .eq("id", certificateId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Certificate not found");
  }
  return data as unknown as CertificateRecord;
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
    const pdfBytes = await buildCertificatePdf({
      employeeName: employee
        ? `${employee.first_name} ${employee.last_name}`
        : "Unknown Employee",
      courseTitle: cert.courses?.title ?? "Untitled Course",
      organizationName: cert.organizations?.name ?? "",
      issuedAt: cert.issued_at,
      expiresAt: cert.expires_at,
      slug: cert.slug,
      credentialNumber: cert.credential_number,
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
        return json({
          error: error instanceof Error ? error.message : String(error),
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
