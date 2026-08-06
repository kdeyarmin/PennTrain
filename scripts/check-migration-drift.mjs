import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModule as loadPgQuery, parseSync } from "libpg-query";

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
 * Reproduce how Supabase records `schema_migrations.statements` for a migration
 * file, then joins them with a single newline (the form hashed remotely).
 *
 * `supabase db push` parses the file into statements and stores each without its
 * terminating semicolon and without the blank lines that separated them in the
 * file. Comparing the raw file bytes therefore false-positives CONTENT drift on
 * every freshly pushed multi-statement migration (blocking edge-function deploy
 * after a successful push). Rebuilding the joined-statements form closes that gap.
 *
 * libpg-query's stmt_location/stmt_len spans occasionally leave a single orphan
 * character in the gap after `$$;` or overrun a lone `;` into the next statement's
 * leading comment. The orphan/carry handling below matches what the CLI stores.
 */
export function supabaseStatementsJoined(sql) {
  const ast = parseSync(sql);
  const stmts = ast.stmts || [];
  if (stmts.length === 0) return sql.replace(/\s+$/, "");

  const parts = [];
  let carry = "";
  for (let i = 0; i < stmts.length; i++) {
    const start = stmts[i].stmt_location ?? 0;
    const len = stmts[i].stmt_len;
    const end = len == null ? sql.length : start + len;
    let raw = sql.slice(start, end);

    if (i > 0) {
      const prev = stmts[i - 1];
      const prevEnd = (prev.stmt_location ?? 0) + (prev.stmt_len ?? 0);
      const gap = sql.slice(prevEnd, start);
      const orphan = gap.replace(/^[\s;]*/, "").replace(/[\s;]*$/, "");
      if (orphan) raw = orphan + raw;
    }
    if (carry) {
      raw = carry + raw;
      carry = "";
    }

    raw = raw.replace(/;\s*$/, "");

    // libpg-query sometimes reports a statement one character LATE: its span starts one character
    // into the statement and ends one character into the NEXT one. The gap-orphan handling above
    // recovers the stolen leading character, but the trailing one is still attached here -- so a
    // plain `revoke ...;` / `grant ...` pair reassembles as `... anon; g` + `rant execute ...` and
    // fabricates CONTENT drift for a file whose SQL never changed (observed on
    // 20260804110000_resident_appointment_lifecycle.sql). Carry that fragment to the next
    // statement, where its own orphan handling puts it back together.
    //
    // Deliberately narrow: only a short alphabetic fragment, with nothing else after the
    // terminator. A real statement never follows its own `;` inside one span, and this shape
    // cannot be one -- which keeps the rule away from dollar-quoted bodies whose last `;` is
    // genuinely internal.
    const splitToken = raw.match(/;(\s*[A-Za-z]{1,3})$/);
    if (splitToken) {
      carry = splitToken[1].trim() + carry;
      raw = raw.slice(0, raw.length - splitToken[0].length);
    }

    const overrun = raw.search(/\n;\s*\n/);
    if (overrun !== -1) {
      carry = raw.slice(overrun).replace(/^\n;\s*/, "");
      raw = raw.slice(0, overrun);
    }
    parts.push(raw.replace(/^\s+/, "").replace(/\s+$/, ""));
  }
  if (carry.trim()) {
    parts[parts.length - 1] = `${parts[parts.length - 1]}\n${carry.replace(/^\s+/, "").replace(/\s+$/, "")}`.replace(
      /\s+$/,
      "",
    );
  }
  return parts.join("\n");
}

/**
 * Hash candidates for one local migration file, matched against the remote
 * md5(array_to_string(statements, E'\n')). Accept:
 *   1. the exact file hash
 *   2. the hash with trailing whitespace stripped (final-newline-only drift)
 *   3. the hash of the supabase statement-join form (semicolon/blank-line drift
 *      introduced when the CLI records statements at apply time)
 */
export function localContentHashes(sql) {
  const exact = md5(sql);
  const trimmed = md5(sql.replace(/\s+$/, ""));
  const hashes = exact === trimmed ? [exact] : [exact, trimmed];
  try {
    const joined = md5(supabaseStatementsJoined(sql));
    if (!hashes.includes(joined)) hashes.push(joined);
  } catch {
    // Unparseable SQL still compares on exact/trimmed hashes; real apply would
    // have failed the same way, so there is no silent false match here.
  }
  return hashes;
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

async function runSelfTest() {
  let failures = 0;
  await loadPgQuery();

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

  // Statement-join form: trailing statement semicolon and blank lines between
  // statements must not count as content drift against the remote hash. Leading
  // comments stay attached to the first statement (matching schema_migrations).
  const multi = "-- header\n\nselect 1;\n\nselect 2;\n";
  const multiJoined = supabaseStatementsJoined(multi);
  if (multiJoined !== "-- header\n\nselect 1\nselect 2") {
    failures += 1;
    console.error(`✗ supabaseStatementsJoined should strip semis/blank lines, got ${JSON.stringify(multiJoined)}`);
  }
  const multiHashes = localContentHashes(multi);
  if (!multiHashes.includes(md5(multiJoined))) {
    failures += 1;
    console.error(`✗ localContentHashes should include the statement-join hash, got ${JSON.stringify(multiHashes)}`);
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
  console.log(
    `Migration content-drift self-test passed (${CONTENT_SELF_TEST_FIXTURES.length} fixtures + statement-join).`,
  );
}

async function run() {
  // Always validate the comparison logic against fixtures first, so a comparator that
  // silently stops catching drift fails loudly instead of passing every version.
  await loadPgQuery();
  await runSelfTest();
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  run().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}