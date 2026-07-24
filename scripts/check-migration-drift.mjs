import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Migration deployment drift check.
//
// CI reapplies the full migration chain against a throwaway local stack
// (`supabase db reset`), which proves the chain is internally consistent -- but it
// never checks the *remote* project, so migrations can be committed to the repo and
// silently never deployed. This script closes that blind spot: it compares the local
// migration files under supabase/migrations/ against the versions actually recorded in
// the remote project's supabase_migrations.schema_migrations table.
//
// It reports three kinds of drift and exits non-zero if any is present:
//   1. PENDING  -- a local migration file whose version is not applied on the remote
//                  (committed but never deployed).
//   2. ORPHAN   -- a version applied on the remote that has no local migration file
//                  (applied out-of-band, or a file was deleted/renamed).
//   3. CONTENT  -- a version present on both sides whose deployed SQL (the
//                  `statements` recorded at apply time) no longer hashes to the same
//                  md5 as the local file (PT-015 residual: presence alone let a local
//                  file be silently rewritten after deployment). Known, reviewed
//                  divergences from the 2026-07-24 PT-051 reconciliation (recovered
//                  files carrying provenance headers, replay-adapted files, and
//                  reconstructed course files) are recorded with a written reason in
//                  scripts/migration-content-allowlist.json; every other version must
//                  content-match exactly.
//
// Remote versions and content hashes are read through the Supabase Management API query
// endpoint -- the same endpoint the Supabase MCP `execute_sql`/`apply_migration` tools
// wrap -- so no direct Postgres connection string or database password is required.
// Authenticate with a Supabase personal access token:
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/check-migration-drift.mjs
//
// The project ref is read from supabase/config.toml (override with SUPABASE_PROJECT_ID).
// `--self-test` runs only the fixture suite for the content-comparison logic (no token,
// no network) -- the fixtures also run at the start of every full invocation, mirroring
// scripts/check-migration-policies.mjs.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const CONFIG_PATH = join(REPO_ROOT, "supabase", "config.toml");
const ALLOWLIST_PATH = join(SCRIPT_DIR, "migration-content-allowlist.json");
const API_BASE = process.env.SUPABASE_API_URL || "https://api.supabase.com";

/** Read the 14-digit timestamp version prefix from a migration filename. */
function versionOf(filename) {
  const match = filename.match(/^(\d{14})_/);
  return match ? match[1] : null;
}

function md5(text) {
  return createHash("md5").update(text).digest("hex");
}

/**
 * Hash candidates for one local migration file, matched against the remote
 * md5(array_to_string(statements, E'\n')). The joined statement text is the file
 * content as recorded at apply time, which may lack the file's trailing newline
 * (editors/POSIX add one; statement joins don't). Accept either the exact file hash
 * or the hash with trailing whitespace stripped, so a final-newline difference is
 * not reported as content drift while any real edit still is.
 */
export function localContentHashes(sql) {
  const exact = md5(sql);
  const trimmed = md5(sql.replace(/\s+$/, ""));
  return exact === trimmed ? [exact] : [exact, trimmed];
}

/**
 * Pure content comparison (unit-tested via --self-test fixtures below).
 *
 * @param {Map<string, {file: string, hashes: string[]}>} localHashes  version -> local file + md5 candidates
 * @param {Map<string, string|null>} remoteHashes  version -> remote md5 (null when the remote
 *   row has no recorded statements to hash)
 * @param {Record<string, {reason?: string}>} allowlist  version -> reviewed divergence
 * @returns {{
 *   compared: number,
 *   matched: number,
 *   mismatches: {version: string, file: string, local: string, remote: string}[],
 *   allowlisted: {version: string, file: string, reason: string}[],
 *   staleAllowlist: {version: string, file: string}[],
 *   unknownAllowlist: string[],
 *   uncomparable: {version: string, file: string}[],
 * }}
 */
export function compareMigrationContent(localHashes, remoteHashes, allowlist) {
  const allowed = new Map();
  for (const [version, entry] of Object.entries(allowlist ?? {})) {
    // An entry without a written reason does not count as an exception -- same rule as
    // scripts/migration-policy-allowlist.json.
    if (entry && typeof entry.reason === "string" && entry.reason.trim() !== "") {
      allowed.set(version, entry.reason.trim());
    }
  }

  const result = {
    compared: 0,
    matched: 0,
    mismatches: [],
    allowlisted: [],
    staleAllowlist: [],
    unknownAllowlist: [],
    uncomparable: [],
  };

  for (const [version, { file, hashes }] of localHashes) {
    if (!remoteHashes.has(version)) continue; // presence drift is reported separately
    const remote = remoteHashes.get(version);
    if (remote === null || remote === undefined) {
      result.uncomparable.push({ version, file });
      continue;
    }
    result.compared += 1;
    if (hashes.some((hash) => hash.toLowerCase() === String(remote).toLowerCase())) {
      result.matched += 1;
      if (allowed.has(version)) result.staleAllowlist.push({ version, file });
      continue;
    }
    if (allowed.has(version)) {
      result.allowlisted.push({ version, file, reason: allowed.get(version) });
    } else {
      result.mismatches.push({ version, file, local: hashes[0], remote: String(remote) });
    }
  }

  for (const version of allowed.keys()) {
    if (!localHashes.has(version) || !remoteHashes.has(version)) {
      result.unknownAllowlist.push(version);
    }
  }
  result.unknownAllowlist.sort();

  return result;
}

async function localMigrations() {
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`No migrations directory at ${MIGRATIONS_DIR}`);
    }
    throw error;
  }
  const byVersion = new Map();
  for (const name of entries) {
    if (!name.endsWith(".sql")) continue;
    const version = versionOf(name);
    if (!version) {
      throw new Error(`Migration file does not start with a 14-digit version: ${name}`);
    }
    if (byVersion.has(version)) {
      throw new Error(`Duplicate migration version ${version}: ${byVersion.get(version).file} and ${name}`);
    }
    const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
    byVersion.set(version, { file: name, hashes: localContentHashes(sql) });
  }
  return byVersion;
}

async function loadContentAllowlist() {
  let raw;
  try {
    raw = await readFile(ALLOWLIST_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Unable to read migration-content-allowlist.json: ${error.message}`);
  }
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("migration-content-allowlist.json must be a JSON object mapping version -> { reason }");
  }
  return parsed;
}

async function resolveProjectRef() {
  if (process.env.SUPABASE_PROJECT_ID) return process.env.SUPABASE_PROJECT_ID;
  const config = await readFile(CONFIG_PATH, "utf8");
  const match = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find project_id in ${CONFIG_PATH}; set SUPABASE_PROJECT_ID instead.`);
  }
  return match[1];
}

async function remoteMigrations(projectRef, token) {
  const response = await fetch(`${API_BASE}/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // One query serves both the presence and the content comparison. The md5 of the
      // newline-joined statements is what the PT-051 reconciliation compared local files
      // against when recovering production's history, so local files are hashed the same way.
      query:
        "select version, md5(array_to_string(statements, E'\\n')) as content_md5 " +
        "from supabase_migrations.schema_migrations order by version;",
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Management API query failed (${response.status} ${response.statusText}) for project ${projectRef}. ${body}`.trim(),
    );
  }
  const payload = await response.json();
  // The Management API query endpoint returns a bare array of result rows (verified against
  // this project). Also accept a `{ result: [...] }` / `{ rows: [...] }` wrapper so the check
  // is resilient to response-shape differences (e.g. a proxy or a future API revision).
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : Array.isArray(payload?.rows)
        ? payload.rows
        : null;
  if (rows === null) {
    throw new Error(`Unexpected Management API response shape: ${JSON.stringify(payload).slice(0, 200)}`);
  }
  return new Map(
    rows.map((row) => [String(row.version), row.content_md5 == null ? null : String(row.content_md5)]),
  );
}

const CONTENT_SELF_TEST_FIXTURES = [
  {
    name: "exact hash match counts as matched",
    local: [["20260101000000", { file: "a.sql", hashes: [md5("select 1;\n")] }]],
    remote: [["20260101000000", md5("select 1;\n")]],
    allowlist: {},
    expect: { compared: 1, matched: 1, mismatches: [], allowlisted: [], staleAllowlist: [], unknownAllowlist: [] },
  },
  {
    name: "trailing-newline-only difference counts as matched",
    local: [["20260101000000", { file: "a.sql", hashes: localContentHashes("select 1;\n") }]],
    remote: [["20260101000000", md5("select 1;")]],
    allowlist: {},
    expect: { compared: 1, matched: 1, mismatches: [], allowlisted: [], staleAllowlist: [], unknownAllowlist: [] },
  },
  {
    name: "unallowlisted content difference is a mismatch",
    local: [["20260101000000", { file: "a.sql", hashes: localContentHashes("select 2;\n") }]],
    remote: [["20260101000000", md5("select 1;")]],
    allowlist: {},
    expect: { compared: 1, matched: 0, mismatches: ["20260101000000"], allowlisted: [], staleAllowlist: [], unknownAllowlist: [] },
  },
  {
    name: "allowlisted difference with a reason is accepted",
    local: [["20260101000000", { file: "a.sql", hashes: localContentHashes("-- header\nselect 1;\n") }]],
    remote: [["20260101000000", md5("select 1;")]],
    allowlist: { "20260101000000": { reason: "PT-051 provenance header" } },
    expect: { compared: 1, matched: 0, mismatches: [], allowlisted: ["20260101000000"], staleAllowlist: [], unknownAllowlist: [] },
  },
  {
    name: "allowlist entry without a reason does not count",
    local: [["20260101000000", { file: "a.sql", hashes: localContentHashes("-- header\nselect 1;\n") }]],
    remote: [["20260101000000", md5("select 1;")]],
    allowlist: { "20260101000000": { reason: "  " } },
    expect: { compared: 1, matched: 0, mismatches: ["20260101000000"], allowlisted: [], staleAllowlist: [], unknownAllowlist: [] },
  },
  {
    name: "allowlist entry whose version now matches is stale",
    local: [["20260101000000", { file: "a.sql", hashes: localContentHashes("select 1;\n") }]],
    remote: [["20260101000000", md5("select 1;\n")]],
    allowlist: { "20260101000000": { reason: "no longer needed" } },
    expect: { compared: 1, matched: 1, mismatches: [], allowlisted: [], staleAllowlist: ["20260101000000"], unknownAllowlist: [] },
  },
  {
    name: "version present on only one side is not content-compared",
    local: [
      ["20260101000000", { file: "a.sql", hashes: localContentHashes("select 1;\n") }],
      ["20260101000001", { file: "b.sql", hashes: localContentHashes("select 2;\n") }],
    ],
    remote: [["20260101000000", md5("select 1;")]],
    allowlist: {},
    expect: { compared: 1, matched: 1, mismatches: [], allowlisted: [], staleAllowlist: [], unknownAllowlist: [] },
  },
  {
    name: "allowlist entry for an unknown version is reported",
    local: [["20260101000000", { file: "a.sql", hashes: localContentHashes("select 1;\n") }]],
    remote: [["20260101000000", md5("select 1;")]],
    allowlist: { "20990101000000": { reason: "typo'd version" } },
    expect: { compared: 1, matched: 1, mismatches: [], allowlisted: [], staleAllowlist: [], unknownAllowlist: ["20990101000000"] },
  },
  {
    name: "remote row without recorded statements is uncomparable, not a mismatch",
    local: [["20260101000000", { file: "a.sql", hashes: localContentHashes("select 1;\n") }]],
    remote: [["20260101000000", null]],
    allowlist: {},
    expect: { compared: 0, matched: 0, mismatches: [], allowlisted: [], staleAllowlist: [], unknownAllowlist: [] },
  },
];

function runSelfTest() {
  let failures = 0;

  // localContentHashes: known md5 and trailing-newline behavior.
  const helloHashes = localContentHashes("hello");
  if (helloHashes.length !== 1 || helloHashes[0] !== "5d41402abc4b2a76b9719d911017c592") {
    failures += 1;
    console.error(`✗ localContentHashes("hello") should be exactly the known md5, got ${JSON.stringify(helloHashes)}`);
  }
  const newlineHashes = localContentHashes("hello\n");
  if (newlineHashes.length !== 2 || !newlineHashes.includes("5d41402abc4b2a76b9719d911017c592")) {
    failures += 1;
    console.error(`✗ localContentHashes("hello\\n") should include the trimmed hash, got ${JSON.stringify(newlineHashes)}`);
  }

  for (const fixture of CONTENT_SELF_TEST_FIXTURES) {
    const got = compareMigrationContent(new Map(fixture.local), new Map(fixture.remote), fixture.allowlist);
    const summarize = (result) => ({
      compared: result.compared,
      matched: result.matched,
      mismatches: result.mismatches.map((m) => m.version),
      allowlisted: result.allowlisted.map((m) => m.version),
      staleAllowlist: result.staleAllowlist.map((m) => m.version),
      unknownAllowlist: result.unknownAllowlist,
    });
    const actual = summarize(got);
    const ok = JSON.stringify(actual) === JSON.stringify(fixture.expect);
    if (!ok) {
      failures += 1;
      console.error(
        `✗ ${fixture.name}\n    expected: ${JSON.stringify(fixture.expect)}\n    actual:   ${JSON.stringify(actual)}`,
      );
    }
  }
  if (failures > 0) {
    console.error(`\nMigration content-drift self-test FAILED (${failures} case(s)).`);
    process.exit(1);
  }
  console.log(`Migration content-drift self-test passed (${CONTENT_SELF_TEST_FIXTURES.length} fixtures).`);
}

async function run() {
  // Always validate the comparison logic against fixtures first, so a comparator that
  // silently stops catching drift fails loudly instead of passing every version.
  runSelfTest();
  if (process.argv.includes("--self-test")) {
    return;
  }

  // Always validate local migration filenames next so duplicate versions and
  // malformed names fail without requiring network credentials.
  const local = await localMigrations();

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error(
      "SUPABASE_ACCESS_TOKEN is not set. Create a personal access token at\n" +
        "https://supabase.com/dashboard/account/tokens and re-run:\n" +
        "  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/check-migration-drift.mjs",
    );
    process.exit(2);
  }

  const projectRef = await resolveProjectRef();
  const remote = await remoteMigrations(projectRef, token);
  const allowlist = await loadContentAllowlist();

  const pending = [...local.keys()].filter((version) => !remote.has(version)).sort();
  const orphan = [...remote.keys()].filter((version) => !local.has(version)).sort();
  const content = compareMigrationContent(local, remote, allowlist);

  console.log(
    `Migration drift check for project ${projectRef}: ` +
      `${local.size} local file(s), ${remote.size} applied on remote.`,
  );
  console.log(
    `Content check: ${content.compared} version(s) compared, ${content.matched} matched, ` +
      `${content.allowlisted.length} allowlisted divergence(s), ${content.mismatches.length} mismatch(es).`,
  );

  for (const { version, file, reason } of content.allowlisted) {
    console.log(`  allowlisted ${version} (${file}): ${reason}`);
  }
  for (const { version, file } of content.uncomparable) {
    console.warn(
      `  note: remote row ${version} (${file}) has no recorded statements to hash; content not compared.`,
    );
  }
  for (const { version, file } of content.staleAllowlist) {
    console.warn(
      `  warning: allowlist entry ${version} (${file}) now content-matches; remove it from ` +
        "scripts/migration-content-allowlist.json.",
    );
  }
  for (const version of content.unknownAllowlist) {
    console.warn(
      `  warning: allowlist entry ${version} does not correspond to a version present both ` +
        "locally and remotely; fix or remove it.",
    );
  }

  const failed = pending.length > 0 || orphan.length > 0 || content.mismatches.length > 0;
  if (!failed) {
    console.log(
      "In sync: every local migration is deployed, every deployed version has a local file, " +
        "and all deployed content matches (or is an allowlisted PT-051 reconciliation divergence).",
    );
    return;
  }

  if (pending.length > 0) {
    console.error(`\nPENDING -- ${pending.length} committed migration(s) NOT deployed to the remote:`);
    for (const version of pending) console.error(`  ${local.get(version).file}`);
    console.error(
      "\nDeploy them with `supabase db push --include-all` (linked to the project), or the" +
        " Management API query endpoint. See MIGRATION_DEPLOYMENT_AUDIT.md.",
    );
  }

  if (orphan.length > 0) {
    console.error(`\nORPHAN -- ${orphan.length} applied version(s) with NO local migration file:`);
    for (const version of orphan) console.error(`  ${version}`);
    console.error(
      "\nEach applied version should have a matching supabase/migrations/<version>_*.sql file." +
        " Investigate before deploying further.",
    );
  }

  if (content.mismatches.length > 0) {
    console.error(
      `\nCONTENT -- ${content.mismatches.length} version(s) whose local file no longer matches the deployed SQL:`,
    );
    for (const { version, file, local: localHash, remote: remoteHash } of content.mismatches) {
      console.error(`  ${file}\n    local md5:  ${localHash}\n    remote md5: ${remoteHash} (version ${version})`);
    }
    console.error(
      "\nA deployed migration file must never be edited after the fact -- write a new migration" +
        " instead. If this divergence is a reviewed reconciliation artifact (see PT-051), record" +
        " it with a written reason in scripts/migration-content-allowlist.json.",
    );
  }

  process.exit(1);
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
