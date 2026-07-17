import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.48.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import { validateOrganizationExportDocument } from "../_shared/organizationExport.ts";

const HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
});
const EXPORT_BUCKET = "organization-exports";

type JsonRow = Record<string, unknown>;
type ExportClaim = {
  job_id: string;
  organization_id: string;
  requested_by: string;
  lock_token: string;
  attempt_count: number;
};

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
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

async function documentManifest(
  admin: SupabaseClient,
  organizationId: string,
): Promise<JsonRow[]> {
  type DocRef = { sourceTable: string; row: JsonRow; bucket: string | null; path: string | null };
  const docRefs: DocRef[] = [];
  for (const source of DOCUMENT_TABLES) {
    const rows = await fetchAllByOrganization(admin, source.table, organizationId);
    for (const row of rows) {
      const rawBucket = row[source.bucketColumn];
      const rawPath = row[source.pathColumn];
      docRefs.push({
        sourceTable: source.table,
        row,
        bucket: typeof rawBucket === "string" ? rawBucket : null,
        path: typeof rawPath === "string" ? rawPath : null,
      });
    }
  }

  const CONCURRENCY = 10;
  const manifest: JsonRow[] = [];
  for (let i = 0; i < docRefs.length; i += CONCURRENCY) {
    const batch = docRefs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async ({ sourceTable, row, bucket, path }) => {
      let signedUrl: string | null = null;
      let signedUrlError: string | null = null;
      if (bucket && path) {
        const reference = validateOrganizationExportDocument({
          sourceTable,
          organizationId,
          bucket,
          path,
        });
        if (!reference.valid) {
          signedUrlError = `Document reference rejected: ${reference.reason}`;
        } else {
          const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60);
          signedUrl = data?.signedUrl ?? null;
          signedUrlError = error?.message ?? null;
        }
      }
      return {
        sourceTable,
        recordId: row.id ?? null,
        bucket,
        path,
        signedUrl,
        signedUrlExpiresInSeconds: signedUrl ? 3600 : null,
        signedUrlError,
      };
    }));
    manifest.push(...results);
  }
  return manifest;
}

async function buildExport(admin: SupabaseClient, claim: ExportClaim) {
  const files: Record<string, Uint8Array> = {};
  let tableCount = 0;
  let rowCount = 0;

  const { data: organization, error: organizationError } = await admin.from("organizations")
    .select("*").eq("id", claim.organization_id).single();
  if (organizationError || !organization) throw new Error(organizationError?.message ?? "Organization not found");
  files["tables/organizations.csv"] = strToU8(rowsToCsv([organization as JsonRow]));
  tableCount += 1;
  rowCount += 1;

  const { data: catalog, error: catalogError } = await admin.rpc("get_organization_export_catalog");
  if (catalogError) throw new Error(`export catalog: ${catalogError.message}`);
  const organizationTables = ((catalog ?? []) as Array<{ table_name?: unknown }>)
    .map((entry) => entry.table_name)
    .filter((table: unknown): table is string => typeof table === "string");
  for (const table of organizationTables) {
    const rows = await exportTableRows(admin, table, claim.organization_id);
    files[`tables/${table}.csv`] = strToU8(rowsToCsv(rows));
    tableCount += 1;
    rowCount += rows.length;
  }

  const documents = await documentManifest(admin, claim.organization_id);
  files["documents-manifest.json"] = strToU8(JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Signed document URLs expire one hour after this archive was generated.",
    documents,
  }, null, 2));
  files["README.txt"] = strToU8(
    "CareMetric CareBase organization export\r\n\r\n" +
      "Each tables/*.csv file contains the rows owned by this organization. " +
      "documents-manifest.json identifies document objects and includes short-lived signed URLs.\r\n",
  );

  const archive = zipSync(files, { level: 6 });
  const checksum = await sha256Hex(archive);
  const path = `${claim.organization_id}/${claim.job_id}.zip`;
  const { error: uploadError } = await admin.storage.from(EXPORT_BUCKET)
    .upload(path, archive, { contentType: "application/zip", upsert: true });
  if (uploadError) throw uploadError;

  return { archive, checksum, path, tableCount, rowCount };
}

Deno.serve(async (request: Request) => {
  const authError = requireCronRequest(request, HEADERS);
  if (authError) return authError;
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return response({ error: "Service credentials are missing" }, 503);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await admin.rpc("claim_organization_export_jobs", { p_batch_size: 2 });
  if (error) return response({ error: error.message }, 500);
  const claims = (data ?? []) as ExportClaim[];
  const results: JsonRow[] = [];

  for (const claim of claims) {
    try {
      const built = await buildExport(admin, claim);
      const { data: finished, error: finishError } = await admin.rpc("finish_organization_export_job", {
        p_job_id: claim.job_id,
        p_lock_token: claim.lock_token,
        p_succeeded: true,
        p_storage_bucket: EXPORT_BUCKET,
        p_storage_path: built.path,
        p_content_sha256: built.checksum,
        p_byte_size: built.archive.byteLength,
        p_table_count: built.tableCount,
        p_row_count: built.rowCount,
        p_error_code: null,
        p_error_message: null,
      });
      if (finishError || finished !== true) throw new Error(finishError?.message ?? "Export lease was lost");
      results.push({ jobId: claim.job_id, status: "succeeded", rowCount: built.rowCount });
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
