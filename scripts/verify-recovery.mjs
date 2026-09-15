#!/usr/bin/env node
/**
 * Read-only evidence for a separately authorized, isolated recovery rehearsal.
 * Does NOT clone, restore, back up object bytes, create projects or change production.
 * Credentials stay in environment variables; reports contain aggregates and hashes only.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const PRODUCTION_REF = "xsqobvvreaovwibxwyvv";
export const TABLES = Object.freeze(["organizations", "profiles", "employees", "residents", "audit_logs"]);
const PAGE_SIZE = 500;
const MAX_OBJECTS = 100_000;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digestSql = (expression) => `encode(sha256(convert_to(${expression}, 'UTF8')), 'hex')`;
const aggregateDigestSql = (expression, order = expression) => digestSql(`coalesce(string_agg(${expression}, E'\\n' order by ${order}), '')`);
const rowDigest = digestSql("row_to_json(t)::text");

// One SELECT gives a consistent MVCC snapshot. All customer rows stay inside Postgres.
export const SNAPSHOT_SQL = `select jsonb_build_object(
 'tables', jsonb_build_object(${TABLES.map((table) => `'${table}', (select jsonb_build_object('count', count(*), 'sha256', ${aggregateDigestSql(rowDigest)}) from public.${table} t)`).join(",")}),
 'migrations', (select jsonb_build_object('count', count(*), 'sha256', ${aggregateDigestSql("version::text")}) from supabase_migrations.schema_migrations),
 'policies', (select jsonb_build_object('count', count(*), 'sha256', ${aggregateDigestSql("row_to_json(p)::text")}) from (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by schemaname, tablename, policyname) p),
 'rls', (select jsonb_build_object('count', count(*), 'sha256', ${aggregateDigestSql("row_to_json(r)::text")}) from (select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p') order by n.nspname, c.relname) r),
 'storage', (select jsonb_build_object('count', count(*), 'sha256', ${aggregateDigestSql("row_to_json(s)::text")}) from (select bucket_id, name, metadata->>'size' as size from storage.objects order by bucket_id, name) s),
 'storageRevision', (select jsonb_build_object('count', count(*), 'sha256', ${aggregateDigestSql("row_to_json(s)::text")}) from (select bucket_id, name, version, updated_at, metadata from storage.objects order by bucket_id, name) s)
) as snapshot;`;

class VerificationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new VerificationError(code); }
function validRef(ref) { return typeof ref === "string" && /^[a-z]{20}$/.test(ref); }
function validHash(hash) { return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash); }
function validCount(count) { return Number.isSafeInteger(count) && count >= 0; }
function validDigest(value) { return value && validCount(value.count) && validHash(value.sha256); }

async function request(url, options, fetcher, consume, maxMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs);
  let response;
  try {
    response = await fetcher(url, { ...options, redirect: "error", signal: controller.signal });
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? "access_denied"
      : response.status === 404 ? "object_or_project_missing" : "http_error");
    if (!response.body) fail("empty_response");
    return await consume(response);
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    fail(controller.signal.aborted ? "request_timeout" : "request_failed");
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

async function query(projectRef, token, sql, fetcher) {
  return request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  }, fetcher, async (response) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 4 * 1024 * 1024) fail("response_too_large");
      chunks.push(chunk);
    }
    let rows;
    try { rows = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { fail("invalid_database_response"); }
    if (!Array.isArray(rows)) fail("invalid_database_response");
    return rows;
  });
}

function projectSnapshot(payload) {
  if (!payload || !TABLES.every((table) => validDigest(payload.tables?.[table]))
      || !["migrations", "policies", "rls", "storage", "storageRevision"].every((key) => validDigest(payload[key]))) {
    fail("invalid_database_snapshot");
  }
  // Never propagate unknown database fields, even when a response shape changes.
  const pick = (item) => ({ count: item.count, sha256: item.sha256 });
  return { tables: Object.fromEntries(TABLES.map((table) => [table, pick(payload.tables[table])])),
    migrations: pick(payload.migrations), policies: pick(payload.policies), rls: pick(payload.rls), storage: pick(payload.storage),
    storageRevision: pick(payload.storageRevision) };
}

async function databaseSnapshot(projectRef, token, fetcher) {
  const rows = await query(projectRef, token, SNAPSHOT_SQL, fetcher);
  if (rows.length !== 1) fail("invalid_database_snapshot");
  return projectSnapshot(rows[0]?.snapshot);
}

async function hashObject(projectRef, storageKey, object, fetcher) {
  if (typeof object?.bucket_id !== "string" || !object.bucket_id
      || typeof object.name !== "string" || !object.name
      || object.bucket_id.includes("/")
      || [object.bucket_id, ...object.name.split("/")].some((part) => part === "." || part === ".." || part.includes("\0"))) {
    fail("invalid_object_identity");
  }
  const expectedBytes = Number(object.bytes);
  if (!validCount(expectedBytes) || object.bytes === null || object.bytes === "") fail("invalid_object_size");
  const path = [object.bucket_id, ...object.name.split("/")].map(encodeURIComponent).join("/");
  return request(`https://${projectRef}.supabase.co/storage/v1/object/authenticated/${path}`, {
    method: "GET", headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}` },
  }, fetcher, async (response) => {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > expectedBytes) fail("object_size_mismatch");
      hash.update(chunk);
    }
    if (bytes !== expectedBytes) fail("object_size_mismatch");
    return { identitySha256: sha256(JSON.stringify([object.bucket_id, object.name])), bytes, sha256: hash.digest("hex") };
  }, 300_000);
}

export async function captureRecoveryEvidence({ projectRef, token, storageKey, fetcher = fetch, now = () => new Date() }) {
  const started = now();
  try {
    if (!validRef(projectRef)) fail("invalid_project_ref");
    if (!token || !storageKey) fail("credentials_missing");
    const database = await databaseSnapshot(projectRef, token, fetcher);
    if (database.storage.count > MAX_OBJECTS) fail("object_limit_exceeded");
    const objects = [];
    for (let offset = 0; offset < database.storage.count; offset += PAGE_SIZE) {
      const rows = await query(projectRef, token,
        `select bucket_id, name, metadata->>'size' as bytes from storage.objects order by bucket_id, name limit ${PAGE_SIZE} offset ${offset};`, fetcher);
      if (rows.length !== Math.min(PAGE_SIZE, database.storage.count - offset)) fail("object_inventory_changed");
      for (const object of rows) objects.push(await hashObject(projectRef, storageKey, object, fetcher));
    }
    // A source that changed during the read is not an exact recovery baseline.
    if (JSON.stringify(database) !== JSON.stringify(await databaseSnapshot(projectRef, token, fetcher))) fail("database_changed_during_capture");
    if (new Set(objects.map((item) => item.identitySha256)).size !== objects.length) fail("duplicate_object_identity");
    objects.sort((a, b) => a.identitySha256.localeCompare(b.identitySha256));
    return { format: "penntrain-recovery-evidence-v1", status: "captured", projectRef,
      capturedAt: started.toISOString(), elapsedMs: now().getTime() - started.getTime(), database, objects,
      scope: "Five critical table fingerprints, migration versions, RLS policies/flags, all Storage object bytes. This is verification evidence, not a backup or proof of restore." };
  } catch (error) {
    return { format: "penntrain-recovery-evidence-v1", status: "incomplete", reason: error instanceof VerificationError ? error.code : "capture_failed" };
  }
}

function validEvidence(report) {
  if (report?.format !== "penntrain-recovery-evidence-v1" || report.status !== "captured" || !validRef(report.projectRef)
      || !Array.isArray(report.objects) || !Number.isFinite(Date.parse(report.capturedAt))) return false;
  try { projectSnapshot(report.database); } catch { return false; }
  return report.objects.length === report.database.storage.count
    && new Set(report.objects.map((object) => object?.identitySha256)).size === report.objects.length
    && report.objects.every((object) => validHash(object?.identitySha256) && validHash(object.sha256) && validCount(object.bytes));
}

export function compareRecoveryEvidence(source, restored) {
  if (!validEvidence(source) || !validEvidence(restored)) return { status: "incomplete", reason: "invalid_or_incomplete_evidence", recoveryVerified: false };
  if (source.projectRef !== PRODUCTION_REF || restored.projectRef === source.projectRef) {
    return { status: "incomplete", reason: "requires_production_baseline_and_distinct_target", recoveryVerified: false };
  }
  const sourceDb = projectSnapshot(source.database);
  const restoredDb = projectSnapshot(restored.database);
  // Object upload timestamps/versions change during a legitimate Storage restore.
  // Those are compared before/after each capture to detect concurrent same-size
  // replacements; cross-project equivalence uses the actual object content hashes.
  delete sourceDb.storageRevision;
  delete restoredDb.storageRevision;
  const databaseMatches = JSON.stringify(sourceDb) === JSON.stringify(restoredDb);
  const lookup = new Map(restored.objects.map((object) => [object.identitySha256, object]));
  let missing = 0;
  let mismatched = 0;
  for (const object of source.objects) {
    const other = lookup.get(object.identitySha256);
    if (!other) missing++;
    else if (object.sha256 !== other.sha256 || object.bytes !== other.bytes) mismatched++;
    lookup.delete(object.identitySha256);
  }
  const storageMatches = missing === 0 && mismatched === 0 && lookup.size === 0;
  return { status: databaseMatches && storageMatches ? "matched" : "mismatch", recoveryVerified: false,
    databaseMatches, storageMatches, sourceObjects: source.objects.length, restoredObjects: restored.objects.length,
    missingObjects: missing, mismatchedObjects: mismatched, extraObjects: lookup.size,
    sourceCapturedAt: source.capturedAt, targetCapturedAt: restored.capturedAt,
    remainingEvidence: "Retain actual backup/restore provenance, restore start/end time, retention/PITR configuration and authenticated application smoke results. Fingerprint equality alone cannot establish a restore occurred." };
}

export async function runRecoveryCli(args, env = process.env) {
  if (args[0] === "capture" && args.length === 3) {
    const report = await captureRecoveryEvidence({ projectRef: args[1], token: env.SUPABASE_ACCESS_TOKEN, storageKey: env.RECOVERY_STORAGE_SERVICE_KEY });
    // Exclusive create prevents accidental replacement of previous recovery evidence.
    await writeFile(args[2], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return { status: report.status, ...(report.reason ? { reason: report.reason } : {}), exitCode: report.status === "captured" ? 0 : 1 };
  }
  if (args[0] === "compare" && args.length === 3) {
    const result = compareRecoveryEvidence(JSON.parse(await readFile(args[1], "utf8")), JSON.parse(await readFile(args[2], "utf8")));
    return { ...result, exitCode: result.status === "matched" ? 0 : 1 };
  }
  return { status: "incomplete", reason: "usage: capture PROJECT_REF NEW_REPORT_FILE | compare SOURCE_REPORT RESTORED_REPORT", exitCode: 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { exitCode, ...report } = await runRecoveryCli(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = exitCode;
  } catch {
    console.error(JSON.stringify({ status: "incomplete", reason: "evidence_file_operation_failed" }));
    process.exitCode = 1;
  }
}
