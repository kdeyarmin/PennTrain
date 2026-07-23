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
// It reports two kinds of drift and exits non-zero if either is present:
//   1. PENDING  -- a local migration file whose version is not applied on the remote
//                  (committed but never deployed).
//   2. ORPHAN   -- a version applied on the remote that has no local migration file
//                  (applied out-of-band, or a file was deleted/renamed).
//
// Remote versions are read through the Supabase Management API query endpoint -- the
// same endpoint the Supabase MCP `execute_sql`/`apply_migration` tools wrap -- so no
// direct Postgres connection string or database password is required. Authenticate
// with a Supabase personal access token:
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/check-migration-drift.mjs
//
// The project ref is read from supabase/config.toml (override with SUPABASE_PROJECT_ID).

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const CONFIG_PATH = join(REPO_ROOT, "supabase", "config.toml");
const API_BASE = process.env.SUPABASE_API_URL || "https://api.supabase.com";

/** Read the 14-digit timestamp version prefix from a migration filename. */
function versionOf(filename) {
  const match = filename.match(/^(\d{14})_/);
  return match ? match[1] : null;
}

async function localVersions() {
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
      throw new Error(`Duplicate migration version ${version}: ${byVersion.get(version)} and ${name}`);
    }
    byVersion.set(version, name);
  }
  return byVersion;
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

async function remoteVersions(projectRef, token) {
  const response = await fetch(`${API_BASE}/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "select version from supabase_migrations.schema_migrations order by version;",
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
  return new Set(rows.map((row) => String(row.version)));
}

async function run() {
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
  const local = await localVersions();
  const remote = await remoteVersions(projectRef, token);

  const pending = [...local.keys()].filter((version) => !remote.has(version)).sort();
  const orphan = [...remote].filter((version) => !local.has(version)).sort();

  console.log(
    `Migration drift check for project ${projectRef}: ` +
      `${local.size} local file(s), ${remote.size} applied on remote.`,
  );

  if (pending.length === 0 && orphan.length === 0) {
    console.log("In sync: every local migration is deployed and every deployed version has a local file.");
    return;
  }

  if (pending.length > 0) {
    console.error(`\nPENDING -- ${pending.length} committed migration(s) NOT deployed to the remote:`);
    for (const version of pending) console.error(`  ${local.get(version)}`);
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

  process.exit(1);
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
