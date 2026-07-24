import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.48.1";
import { strToU8 } from "npm:fflate@0.8.2";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import { validateOrganizationExportDocument } from "../_shared/organizationExport.ts";
import {
  computeExportExclusions,
  decideDocumentEmbedding,
  EMBED_TOTAL_BUDGET_BYTES,
  hashWhileForwarding,
  MAX_EMBED_OBJECT_BYTES,
  StreamingZipWriter,
} from "../_shared/organizationExportArchive.ts";

const HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
});
const EXPORT_BUCKET = "organization-exports";

// The job framework (claim_organization_export_jobs / finish_organization_export_job)
// has no partial-progress checkpoint: a job is either finished or re-claimed whole
// after its 20-minute lease lapses. Resume-across-runs is therefore not implemented;
// instead each run caps its work (per-object size, total embed budget, soft deadline)
// and records anything it could not embed honestly in documents-manifest.json
// (summary.partial = true), mirroring sync-billing-quantities' "partial" status.
const RUN_DEADLINE_MS = 330_000;
const DOWNLOAD_LOOKAHEAD = 3;
const DOWNLOAD_TIMEOUT_MS = 180_000;

type JsonRow = Record<string, unknown>;
type ExportClaim = {
  job_id: string;
  organization_id: string;
  requested_by: string;
  lock_token: string;
  attempt_count: number;
};
type DocumentDownloader = (bucket: string, path: string) => Promise<Response>;

const DOCUMENT_TABLES = [
  { table: "training_documents", bucketColumn: "storage_bucket", pathColumn: "storage_path" },
  { table: "incident_documents", bucketColumn: "storage_bucket", pathColumn: "storage_path" },
  { table: "resident_documents", bucketColumn: "storage_bucket", pathColumn: "storage_path" },
] as const;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^\s*[=+\-@]/.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replaceAll('"', '""')}"`;
}

function rowsToCsv(rows: JsonRow[]): string {
  if (rows.length === 0) return "";
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).sort();
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n") + "\r\n";
}

async function fetchAllByOrganization(
  admin: SupabaseClient,
  table: string,
  organizationId: string,
): Promise<JsonRow[]> {
  const pageSize = 1000;
  const rows: JsonRow[] = [];
  for (let from = 0;; from += pageSize) {
    const { data, error } = await admin.from(table).select("*")
      .eq("organization_id", organizationId).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as JsonRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function exportTableRows(
  admin: SupabaseClient,
  table: string,
  organizationId: string,
): Promise<JsonRow[]> {
  const pageSize = 1000;
  const rows: JsonRow[] = [];
  for (let offset = 0;; offset += pageSize) {
    const { data, error } = await admin.rpc("export_organization_table", {
      p_organization_id: organizationId,
      p_table_name: table,
      p_offset: offset,
      p_limit: pageSize,
    });
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as JsonRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

type ManifestEntry = {
  sourceTable: string;
  recordId: unknown;
  bucket: string | null;
  path: string | null;
  embedded: boolean;
  archivePath: string | null;
  sha256: string | null;
  byteSize: number | null;
  skipReason: string | null;
  signedUrl: string | null;
  signedUrlExpiresInSeconds: number | null;
  signedUrlError: string | null;
};

type DocRef = {
  sourceTable: string;
  recordId: unknown;
  bucket: string | null;
  path: string | null;
  valid: boolean;
  invalidReason: string | null;
};

async function collectDocumentReferences(
  admin: SupabaseClient,
  organizationId: string,
): Promise<DocRef[]> {
  const refs: DocRef[] = [];
  for (const source of DOCUMENT_TABLES) {
    const rows = await fetchAllByOrganization(admin, source.table, organizationId);
    for (const row of rows) {
      const rawBucket = row[source.bucketColumn];
      const rawPath = row[source.pathColumn];
      const bucket = typeof rawBucket === "string" ? rawBucket : null;
      const path = typeof rawPath === "string" ? rawPath : null;
      let valid = false;
      let invalidReason: string | null = null;
      if (!bucket || !path) {
        invalidReason = "missing_reference";
      } else {
        const reference = validateOrganizationExportDocument({
          sourceTable: source.table,
          organizationId,
          bucket,
          path,
        });
        if (reference.valid) valid = true;
        else invalidReason = reference.reason;
      }
      refs.push({ sourceTable: source.table, recordId: row.id ?? null, bucket, path, valid, invalidReason });
    }
  }
  return refs;
}

/** Read up to maxBytes+1 from a body whose length is unknown; flags overflow. */
async function readAtMost(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ exceeded: false; data: Uint8Array } | { exceeded: true }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) return { exceeded: true };
    chunks.push(chunk);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return { exceeded: false, data };
}

/**
 * Embed every referenced storage object into the archive under
 * files/<bucket>/<path>, subject to the per-object cap, the total embed budget,
 * and the run deadline. Downloads are prefetched with a bounded lookahead
 * (connection setup only -- bodies stay unread until their turn, so memory is
 * not multiplied). Returns the manifest rows plus honest summary counters.
 */
async function embedOrganizationDocuments(input: {
  admin: SupabaseClient;
  zip: StreamingZipWriter;
  organizationId: string;
  downloadObject: DocumentDownloader;
  deadlineAt: number;
  refs: DocRef[];
}): Promise<{ entries: ManifestEntry[]; embeddedCount: number; skippedCount: number; partial: boolean }> {
  const { admin, zip, downloadObject, deadlineAt, refs } = input;
  const entries: ManifestEntry[] = [];
  const embeddedByObject = new Map<string, { archivePath: string; sha256: string; byteSize: number }>();
  let budgetRemaining = EMBED_TOTAL_BUDGET_BYTES;
  let embeddedCount = 0;
  let partial = false;

  // Indexes that will actually need a download: first occurrence of each valid object.
  const firstOccurrence = new Map<string, number>();
  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i];
    if (ref.valid && !firstOccurrence.has(`${ref.bucket}/${ref.path}`)) {
      firstOccurrence.set(`${ref.bucket}/${ref.path}`, i);
    }
  }
  const downloadOrder = [...firstOccurrence.values()].sort((a, b) => a - b);
  const pendingDownloads = new Map<number, Promise<Response | Error>>();
  const startDownload = (index: number) => {
    const ref = refs[index];
    return downloadObject(ref.bucket as string, ref.path as string)
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  };

  const addSignedUrlFallback = async (entry: ManifestEntry) => {
    const { data, error } = await admin.storage.from(entry.bucket as string)
      .createSignedUrl(entry.path as string, 60 * 60);
    entry.signedUrl = data?.signedUrl ?? null;
    entry.signedUrlExpiresInSeconds = entry.signedUrl ? 3600 : null;
    entry.signedUrlError = error?.message ?? null;
  };

  try {
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      const entry: ManifestEntry = {
        sourceTable: ref.sourceTable,
        recordId: ref.recordId,
        bucket: ref.bucket,
        path: ref.path,
        embedded: false,
        archivePath: null,
        sha256: null,
        byteSize: null,
        skipReason: null,
        signedUrl: null,
        signedUrlExpiresInSeconds: null,
        signedUrlError: null,
      };
      entries.push(entry);

      if (!ref.valid) {
        entry.skipReason = `invalid_reference:${ref.invalidReason ?? "unknown"}`;
        continue;
      }
      const objectKey = `${ref.bucket}/${ref.path}`;

      // A row whose object was already embedded reuses the first copy.
      const already = embeddedByObject.get(objectKey);
      if (already) {
        entry.embedded = true;
        entry.archivePath = already.archivePath;
        entry.sha256 = already.sha256;
        entry.byteSize = already.byteSize;
        embeddedCount += 1;
        continue;
      }
      if (firstOccurrence.get(objectKey) !== i) {
        // First occurrence was skipped; repeat its outcome.
        const original = entries[firstOccurrence.get(objectKey) as number];
        entry.skipReason = original.skipReason ?? "duplicate_of_skipped_object";
        if (entry.skipReason === "deadline_exceeded" || entry.skipReason === "embed_budget_exhausted") partial = true;
        await addSignedUrlFallback(entry);
        continue;
      }

      const deadlineExceeded = Date.now() > deadlineAt;
      const preDecision = decideDocumentEmbedding({
        referenceValid: true,
        objectBytes: null,
        maxObjectBytes: MAX_EMBED_OBJECT_BYTES,
        remainingBudgetBytes: budgetRemaining,
        deadlineExceeded,
      });
      if (!preDecision.embed) {
        entry.skipReason = preDecision.skipReason;
        partial = true;
        const pending = pendingDownloads.get(i);
        pendingDownloads.delete(i);
        if (pending) {
          const settled = await pending;
          if (settled instanceof Response) await settled.body?.cancel().catch(() => {});
        }
        await addSignedUrlFallback(entry);
        continue;
      }

      // Warm the next few downloads (headers only; bodies remain unread).
      const position = downloadOrder.indexOf(i);
      for (let ahead = position; ahead < Math.min(downloadOrder.length, position + DOWNLOAD_LOOKAHEAD); ahead += 1) {
        const target = downloadOrder[ahead];
        if (!pendingDownloads.has(target)) pendingDownloads.set(target, startDownload(target));
      }
      const settled = await (pendingDownloads.get(i) as Promise<Response | Error>);
      pendingDownloads.delete(i);

      if (settled instanceof Error) {
        entry.skipReason = `download_failed:${settled.message}`;
        await addSignedUrlFallback(entry);
        continue;
      }
      if (!settled.ok || !settled.body) {
        await settled.body?.cancel().catch(() => {});
        entry.skipReason = `download_failed:http_${settled.status}`;
        await addSignedUrlFallback(entry);
        continue;
      }

      const declaredLength = Number.parseInt(settled.headers.get("content-length") ?? "", 10);
      const objectBytes = Number.isFinite(declaredLength) && declaredLength >= 0 ? declaredLength : null;
      const decision = decideDocumentEmbedding({
        referenceValid: true,
        objectBytes,
        maxObjectBytes: MAX_EMBED_OBJECT_BYTES,
        remainingBudgetBytes: budgetRemaining,
        deadlineExceeded: Date.now() > deadlineAt,
      });
      if (!decision.embed) {
        await settled.body.cancel().catch(() => {});
        entry.skipReason = decision.skipReason;
        if (decision.skipReason !== "size_cap_exceeded") partial = true;
        await addSignedUrlFallback(entry);
        continue;
      }

      const archivePath = `files/${ref.bucket}/${ref.path}`;
      let embeddedBytes: { sha256: string; byteSize: number };
      if (objectBytes !== null) {
        // Known size within limits: stream straight into the archive.
        const sink = zip.open(archivePath, { compress: false });
        embeddedBytes = await hashWhileForwarding(settled.body, (chunk) => sink.push(chunk));
        await sink.finish();
      } else {
        // Unknown size: buffer at most the per-object cap before committing,
        // because a partially written zip entry cannot be retracted.
        const buffered = await readAtMost(settled.body, MAX_EMBED_OBJECT_BYTES);
        if (buffered.exceeded) {
          entry.skipReason = "size_cap_exceeded";
          await addSignedUrlFallback(entry);
          continue;
        }
        if (buffered.data.length > budgetRemaining) {
          entry.skipReason = "embed_budget_exhausted";
          partial = true;
          await addSignedUrlFallback(entry);
          continue;
        }
        const sink = zip.open(archivePath, { compress: false });
        embeddedBytes = await hashWhileForwarding([buffered.data], (chunk) => sink.push(chunk));
        await sink.finish();
      }
      budgetRemaining -= embeddedBytes.byteSize;
      embeddedByObject.set(objectKey, { archivePath, ...embeddedBytes });
      entry.embedded = true;
      entry.archivePath = archivePath;
      entry.sha256 = embeddedBytes.sha256;
      entry.byteSize = embeddedBytes.byteSize;
      embeddedCount += 1;
    }
  } finally {
    // Drop any warmed-but-unconsumed downloads.
    for (const pending of pendingDownloads.values()) {
      pending.then((settled) => {
        if (settled instanceof Response) settled.body?.cancel().catch(() => {});
      }).catch(() => {});
    }
    pendingDownloads.clear();
  }

  return { entries, embeddedCount, skippedCount: entries.length - embeddedCount, partial };
}

async function buildExclusionsFile(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.rpc("get_organization_export_exclusions");
  if (error) throw new Error(`export exclusions: ${error.message}`);
  const nonOrganizationTables = ((data ?? []) as Array<{ table_name?: unknown }>)
    .map((entry) => entry.table_name)
    .filter((table): table is string => typeof table === "string");
  const exclusions = computeExportExclusions({ nonOrganizationTables });
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    method: "Run-time information_schema scan for public tables without an organization_id column " +
      "(get_organization_export_exclusions). Tenant-owned tables are enumerated by " +
      "get_organization_export_catalog and exported under tables/.",
    note: "The tables below cannot be scoped to a single organization and are therefore not in this " +
      "archive. sharedTables hold cross-tenant or child records reachable only through the exported " +
      "tenant tables; platformInternalTables hold platform-operated data (marketing intake, release " +
      "configuration, regulatory reference mirrors, lifecycle bookkeeping); exportedSeparately tables " +
      "are included in the archive through a dedicated path.",
    ...exclusions,
  }, null, 2);
}

async function buildExport(
  admin: SupabaseClient,
  claim: ExportClaim,
  downloadObject: DocumentDownloader,
  deadlineAt: number,
) {
  let tableCount = 0;
  let rowCount = 0;
  const path = `${claim.organization_id}/${claim.job_id}.zip`;

  // Stream the archive as it is produced: zip chunks flow through a hash/byte
  // counter into the storage upload body (duplex:"half", the streaming-upload
  // pattern established in _shared/heygenPolling.ts). Peak memory is bounded by
  // the zip writer's chunk queue plus at most one buffered document -- never by
  // the archive size, which zipSync previously held in memory whole.
  const zip = new StreamingZipWriter();
  const uploadPipe = new TransformStream<Uint8Array, Uint8Array>();
  const uploadPromise = admin.storage.from(EXPORT_BUCKET)
    .upload(path, uploadPipe.readable, { contentType: "application/zip", upsert: true, duplex: "half" });
  const uploadWriter = uploadPipe.writable.getWriter();
  const archiveDigestPromise = (async () => {
    const digest = await hashWhileForwarding(zip.readable, async (chunk) => {
      await uploadWriter.write(chunk);
    });
    await uploadWriter.close();
    return digest;
  })();
  archiveDigestPromise.catch(() => {
    // Rejections are re-observed via the awaits below; this guard only prevents
    // an unhandled-rejection crash when the build loop throws first.
  });

  try {
    const { data: organization, error: organizationError } = await admin.from("organizations")
      .select("*").eq("id", claim.organization_id).single();
    if (organizationError || !organization) throw new Error(organizationError?.message ?? "Organization not found");
    await zip.addFile("tables/organizations.csv", strToU8(rowsToCsv([organization as JsonRow])));
    tableCount += 1;
    rowCount += 1;

    const { data: catalog, error: catalogError } = await admin.rpc("get_organization_export_catalog");
    if (catalogError) throw new Error(`export catalog: ${catalogError.message}`);
    const organizationTables = ((catalog ?? []) as Array<{ table_name?: unknown }>)
      .map((entry) => entry.table_name)
      .filter((table: unknown): table is string => typeof table === "string");
    for (const table of organizationTables) {
      const rows = await exportTableRows(admin, table, claim.organization_id);
      await zip.addFile(`tables/${table}.csv`, strToU8(rowsToCsv(rows)));
      tableCount += 1;
      rowCount += rows.length;
    }

    const refs = await collectDocumentReferences(admin, claim.organization_id);
    const documents = await embedOrganizationDocuments({
      admin,
      zip,
      organizationId: claim.organization_id,
      downloadObject,
      deadlineAt,
      refs,
    });

    await zip.addFile("exclusions.json", strToU8(await buildExclusionsFile(admin)));
    await zip.addFile("documents-manifest.json", strToU8(JSON.stringify({
      generatedAt: new Date().toISOString(),
      note: "Embedded document copies live under files/<bucket>/<path> in this archive; each sha256 " +
        "covers the original object bytes. Documents that could not be embedded carry a skipReason " +
        "and, when retrievable, a signed URL that expires one hour after generation. " +
        "summary.partial=true means run limits (deadline or total embed budget) left documents out.",
      summary: {
        totalDocuments: documents.entries.length,
        embeddedDocuments: documents.embeddedCount,
        skippedDocuments: documents.skippedCount,
        partial: documents.partial,
      },
      documents: documents.entries,
    }, null, 2)));
    await zip.addFile("README.txt", strToU8(
      "CareMetric CareBase organization export\r\n\r\n" +
        "Each tables/*.csv file contains the rows owned by this organization. " +
        "Binary documents are embedded under files/<bucket>/<path> and indexed by " +
        "documents-manifest.json (per-file sha256, embedded flag, and skip reason " +
        "for anything left out). exclusions.json declares the shared/global tables " +
        "this archive intentionally does not contain.\r\n",
    ));

    zip.end();
    const { sha256, byteSize } = await archiveDigestPromise;
    const { error: uploadError } = await uploadPromise;
    if (uploadError) throw uploadError;

    return {
      checksum: sha256,
      byteSize,
      path,
      tableCount,
      rowCount,
      embeddedDocuments: documents.embeddedCount,
      skippedDocuments: documents.skippedCount,
      partialDocumentEmbedding: documents.partial,
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    zip.abort(failure);
    await Promise.allSettled([
      archiveDigestPromise,
      uploadPromise,
      uploadWriter.abort(failure),
    ]);
    throw failure;
  }
}

Deno.serve(async (request: Request) => {
  const authError = requireCronRequest(request, HEADERS);
  if (authError) return authError;
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return response({ error: "Service credentials are missing" }, 503);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // storage-js download() buffers whole objects into a Blob, so embedded
  // documents are fetched directly from the Storage API to keep them streamable.
  const downloadObject: DocumentDownloader = (bucket, path) => {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  };
  const deadlineAt = Date.now() + RUN_DEADLINE_MS;

  const { data, error } = await admin.rpc("claim_organization_export_jobs", { p_batch_size: 2 });
  if (error) return response({ error: error.message }, 500);
  const claims = (data ?? []) as ExportClaim[];
  const results: JsonRow[] = [];

  for (const claim of claims) {
    try {
      const built = await buildExport(admin, claim, downloadObject, deadlineAt);
      const { data: finished, error: finishError } = await admin.rpc("finish_organization_export_job", {
        p_job_id: claim.job_id,
        p_lock_token: claim.lock_token,
        p_succeeded: true,
        p_storage_bucket: EXPORT_BUCKET,
        p_storage_path: built.path,
        p_content_sha256: built.checksum,
        p_byte_size: built.byteSize,
        p_table_count: built.tableCount,
        p_row_count: built.rowCount,
        p_error_code: null,
        p_error_message: null,
      });
      if (finishError || finished !== true) throw new Error(finishError?.message ?? "Export lease was lost");
      results.push({
        jobId: claim.job_id,
        status: "succeeded",
        rowCount: built.rowCount,
        embeddedDocuments: built.embeddedDocuments,
        skippedDocuments: built.skippedDocuments,
        partialDocumentEmbedding: built.partialDocumentEmbedding,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.rpc("finish_organization_export_job", {
        p_job_id: claim.job_id,
        p_lock_token: claim.lock_token,
        p_succeeded: false,
        p_storage_bucket: null,
        p_storage_path: null,
        p_content_sha256: null,
        p_byte_size: null,
        p_table_count: null,
        p_row_count: null,
        p_error_code: "archive_failed",
        p_error_message: message,
      });
      results.push({ jobId: claim.job_id, status: "failed", error: message });
    }
  }

  return response({ claimed: claims.length, results }, results.some((item) => item.status === "failed") ? 207 : 200);
});
