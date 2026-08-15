// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { strToU8 } from "npm:fflate@0.8.2";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { StreamingZipWriter } from "../_shared/organizationExportArchive.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build an immutable zip package for a Survey Day evidence selection:
 * manifest.json + binder PDF (when present) + note text files.
 * Records the export via record_survey_evidence_packet_export.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json(req, { error: "Invalid or expired session" }, 401);
  const { data: profile } = await caller.from("profiles").select("role, organization_id, is_active").eq("id", user.id).single();
  if (!profile?.is_active || !["platform_admin", "org_admin", "facility_manager"].includes(profile.role as string)) {
    return json(req, { error: "Not authorized to package survey evidence" }, 403);
  }

  let body: {
    survey_day_session_id?: string;
    binder_export_job_id?: string;
    facility_id?: string;
  };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body" }, 400); }

  const sessionId = body.survey_day_session_id ?? null;
  const binderJobId = body.binder_export_job_id ?? null;
  if (!sessionId && !binderJobId) {
    return json(req, { error: "survey_day_session_id or binder_export_job_id is required" }, 400);
  }

  const { data: items, error: listError } = await caller.rpc("list_survey_evidence_packet_items", {
    p_survey_day_session_id: sessionId,
    p_binder_export_job_id: binderJobId,
  });
  if (listError) return json(req, { error: listError.message }, 400);
  const packetItems = (items ?? []) as Array<{
    id: string;
    source_type: string;
    source_id: string | null;
    label: string;
    notes: string | null;
    sort_order: number;
    organization_id: string;
    facility_id: string | null;
  }>;
  if (packetItems.length === 0) {
    return json(req, { error: "No packet items selected — add binder or notes first" }, 400);
  }

  const orgId = profile.role === "platform_admin"
    ? packetItems[0].organization_id
    : profile.organization_id;
  if (!orgId) return json(req, { error: "Organization required" }, 400);
  const facilityId = body.facility_id ?? packetItems[0].facility_id ?? null;

  // Service-role binder downloads below bypass storage RLS -- refuse packaging for an FM who is
  // not assigned to the target facility (mirrors record_survey_evidence_packet_export).
  if (profile.role === "facility_manager") {
    if (!facilityId) {
      return json(req, { error: "facility_id is required for facility managers" }, 400);
    }
    const { data: assigned, error: assignError } = await caller.rpc("is_assigned_to_facility", {
      target_facility_id: facilityId,
    });
    if (assignError) return json(req, { error: assignError.message }, 500);
    if (!assigned) return json(req, { error: "Not authorized for this facility" }, 403);
  }

  const zip = new StreamingZipWriter();
  const chunks: Uint8Array[] = [];
  const reader = zip.readable.getReader();
  const collect = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  })();

  const included: Array<Record<string, unknown>> = [];
  let binderIncluded = false;

  // Include binder PDF when a binder_export item or binder_export_job_id is present
  const binderItem = packetItems.find((i) => i.source_type === "binder_export" && i.source_id);
  const effectiveBinderId = binderItem?.source_id ?? binderJobId;
  if (effectiveBinderId) {
    // `binder_export_job_id` arrives straight from the request body, and the storage download
    // below uses the service-role client, which bypasses RLS. Visibility is therefore proved
    // through the caller's own client first: binder_export_jobs_select scopes org_admins to
    // their org and facility_managers to binders whose facility_ids sit inside their
    // assignments (an org-wide binder is deliberately NOT theirs to take -- see
    // 20260714214435's remediation notes). Reading with `admin` scoped only to organization_id
    // let an FM package an org-wide or foreign-facility binder that binder RLS and the
    // binder-exports storage policy both refuse to hand them directly. platform_admin keeps
    // the service-role read (their reach is all orgs); the org predicate stays as belt and
    // braces for them.
    const binderReader = profile.role === "platform_admin" ? admin : caller;
    const { data: job, error: jobError } = await binderReader.from("binder_export_jobs")
      .select("id, status, storage_bucket, storage_path, content_sha256, organization_id")
      .eq("id", effectiveBinderId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (jobError) {
      console.error("survey packet: binder job read failed", jobError.message);
      return json(req, { error: "Unable to verify the binder export" }, 500);
    }
    // The binder was explicitly part of this packet. Packaging without it would record an
    // immutable, hash-stamped export whose central document is silently absent -- an
    // incomplete packet that reads as authoritative survey evidence. Refuse instead.
    if (!job) {
      return json(req, { error: "Binder export not found or not accessible for this packet" }, 409);
    }
    if (job.status !== "succeeded" || !job.storage_path) {
      return json(req, { error: "Binder export is not finished yet — retry once it has succeeded" }, 409);
    }
    {
      const { data: fileBlob, error: dlErr } = await admin.storage
        .from(job.storage_bucket || "binder-exports")
        .download(job.storage_path);
      if (dlErr || !fileBlob) {
        console.error("survey packet: binder download failed", dlErr?.message ?? "no data");
        return json(req, { error: "Unable to download the binder export — retry shortly" }, 502);
      }
      {
        const bytes = new Uint8Array(await fileBlob.arrayBuffer());
        await zip.addFile("binder/compliance-binder.pdf", bytes, { compress: false });
        binderIncluded = true;
        included.push({
          kind: "binder_export",
          id: job.id,
          path: "binder/compliance-binder.pdf",
          contentSha256: job.content_sha256,
          bytes: bytes.byteLength,
        });
        // Optional appendix CSVs
        const appendixPrefix = `${job.organization_id}/${job.id}-appendix`;
        const { data: manifestBlob } = await admin.storage.from(job.storage_bucket || "binder-exports")
          .download(`${appendixPrefix}/manifest.json`);
        if (manifestBlob) {
          const mBytes = new Uint8Array(await manifestBlob.arrayBuffer());
          await zip.addFile("binder/appendix/manifest.json", mBytes, { compress: true });
          try {
            const manifest = JSON.parse(new TextDecoder().decode(mBytes));
            for (const section of manifest.sections ?? []) {
              const csvPath = section.csvPath as string | undefined;
              if (!csvPath) continue;
              const { data: csvBlob } = await admin.storage.from(job.storage_bucket || "binder-exports").download(csvPath);
              if (csvBlob) {
                const key = String(section.key ?? "section");
                const csvBytes = new Uint8Array(await csvBlob.arrayBuffer());
                await zip.addFile(`binder/appendix/${key}.csv`, csvBytes, { compress: true });
              }
            }
          } catch {
            // appendix optional
          }
        }
      }
    }
  }

  // Notes as text files
  let noteIndex = 0;
  for (const item of packetItems) {
    if (item.source_type === "note") {
      noteIndex += 1;
      const text = `${item.label}\n\n${item.notes ?? ""}\n`;
      const path = `notes/note-${String(noteIndex).padStart(2, "0")}.txt`;
      await zip.addFile(path, strToU8(text), { compress: true });
      included.push({ kind: "note", id: item.id, label: item.label, path });
    } else if (item.source_type !== "binder_export") {
      // Selection metadata only for non-file sources (incident, work_item, etc.)
      included.push({
        kind: item.source_type,
        id: item.id,
        sourceId: item.source_id,
        label: item.label,
        notes: item.notes,
      });
    }
  }

  const packageManifest = {
    assembledAt: new Date().toISOString(),
    organizationId: orgId,
    facilityId,
    surveyDaySessionId: sessionId,
    binderExportJobId: effectiveBinderId,
    binderIncluded,
    itemCount: packetItems.length,
    items: packetItems.map((i) => ({
      id: i.id,
      sourceType: i.source_type,
      sourceId: i.source_id,
      label: i.label,
      notes: i.notes,
      sortOrder: i.sort_order,
    })),
    included,
    accessControlNote: "Guest download requires an explicit survey packet guest grant token.",
    immutable: true,
  };
  await zip.addFile("manifest.json", strToU8(JSON.stringify(packageManifest, null, 2)), { compress: true });
  zip.end();
  await collect;

  // Concatenate chunks
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const zipBytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    zipBytes.set(c, offset);
    offset += c.byteLength;
  }
  const contentSha256 = await sha256Hex(zipBytes);
  const storagePath = `${orgId}/${sessionId ?? binderJobId ?? "packet"}/${contentSha256.slice(0, 16)}.zip`;

  const { error: uploadError } = await admin.storage
    .from("survey-evidence-packets")
    .upload(storagePath, zipBytes, { contentType: "application/zip", upsert: true });
  if (uploadError) return json(req, { error: `Package upload failed: ${uploadError.message}` }, 500);

  const { data: exportId, error: recordError } = await caller.rpc("record_survey_evidence_packet_export", {
    p_facility_id: facilityId,
    p_survey_day_session_id: sessionId,
    p_binder_export_job_id: effectiveBinderId,
    p_storage_path: storagePath,
    p_content_sha256: contentSha256,
    p_byte_size: zipBytes.byteLength,
    p_item_count: packetItems.length,
    p_manifest: packageManifest,
  });
  if (recordError) {
    // Best-effort cleanup so a failed ledger write does not leave an orphan ZIP.
    const { error: cleanupError } = await admin.storage.from("survey-evidence-packets").remove([storagePath]);
    if (cleanupError) {
      return json(req, {
        error: `${recordError.message} (also failed to remove uploaded package: ${cleanupError.message})`,
      }, 500);
    }
    return json(req, { error: recordError.message }, 500);
  }

  // Signed download for the authenticated operator -- fail hard rather than success with null URL.
  const { data: signed, error: signedError } = await admin.storage
    .from("survey-evidence-packets")
    .createSignedUrl(storagePath, 3600);
  if (signedError || !signed?.signedUrl) {
    return json(req, { error: signedError?.message ?? "failed to create signed url" }, 500);
  }

  return json(req, {
    success: true,
    exportId,
    storagePath,
    contentSha256,
    byteSize: zipBytes.byteLength,
    itemCount: packetItems.length,
    downloadUrl: signed.signedUrl,
    manifest: packageManifest,
  });
});
