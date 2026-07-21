import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Preventive migration policy lint (PT-048).
//
// Scans NEW migrations -- those whose version prefix is strictly greater than the
// grandfather baseline -- for three classes of mistake this codebase has historically
// shipped and then patched (see the `close_anon_execute_leak_*`, `remediate_*`, and
// `harden_*` migration tail):
//
//   1. Grants to the `anon` or `public` roles (broad, unauthenticated exposure).
//   2. A `create table` in the `public` schema with no matching `enable row level
//      security` in the same migration.
//   3. A `security definer` function with no `set search_path` in its definition.
//
// The baseline grandfathers every migration that already existed when this lint was
// adopted, so current HEAD passes without rewriting history. Genuine, reviewed
// exceptions above the baseline are recorded in migration-policy-allowlist.json.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// Newest migration version present when this lint was adopted. Only migrations with a
// strictly greater version are linted. Do not lower this; raising it would silently
// grandfather un-reviewed migrations.
const BASELINE_VERSION = 20260720205629;

// Schemas where enabling RLS is not the access-control pattern (locked down by revoking
// from anon/authenticated and reached only through SECURITY DEFINER routines, or managed
// by the platform). `create table` in these schemas is exempt from the RLS rule.
const RLS_EXEMPT_SCHEMAS = new Set([
  "app_private",
  "app_hidden",
  "auth",
  "storage",
  "extensions",
  "cron",
  "net",
  "vault",
  "graphql",
  "graphql_public",
  "realtime",
  "supabase_functions",
  "supabase_migrations",
  "pgbouncer",
  "pgsodium",
  "pgsodium_masks",
]);

const RULES = {
  ANON_PUBLIC_GRANT: "anon-public-grant",
  TABLE_WITHOUT_RLS: "table-without-rls",
  DEFINER_WITHOUT_SEARCH_PATH: "definer-without-search-path",
};

/** Strip SQL line and block comments so keywords inside them do not trip the rules. */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function normalizeIdentifier(raw) {
  // Drop quotes and a trailing schema/paren boundary; return { schema, name }.
  const cleaned = raw.replace(/"/g, "").trim();
  const parts = cleaned.split(".");
  if (parts.length >= 2) {
    return { schema: parts[0].toLowerCase(), name: parts[1].toLowerCase() };
  }
  return { schema: "public", name: parts[0].toLowerCase() };
}

/** Split into per-function chunks so each function's header+body stays together. */
function splitFunctionDefinitions(sql) {
  const boundary = /create\s+(?:or\s+replace\s+)?function\b/gi;
  const starts = [];
  let match;
  while ((match = boundary.exec(sql)) !== null) {
    starts.push(match.index);
  }
  const chunks = [];
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : sql.length;
    chunks.push(sql.slice(starts[i], end));
  }
  return chunks;
}

/**
 * Analyze one migration's SQL text and return an array of findings.
 * Exported shape: { rule, detail }.
 */
export function analyzeMigrationSql(sql) {
  const findings = [];
  const text = stripSqlComments(sql);

  // Rule 1: grants to anon/public.
  const grantRe = /\bgrant\b[^;]*?\bto\b[^;]*?\b(anon|public)\b/gis;
  let grant;
  while ((grant = grantRe.exec(text)) !== null) {
    const statement = grant[0].replace(/\s+/g, " ").trim();
    findings.push({
      rule: RULES.ANON_PUBLIC_GRANT,
      detail: `grants to \`${grant[1].toLowerCase()}\`: ${statement.slice(0, 160)}`,
    });
  }

  // Rule 2: create table in public schema without enable RLS in the same file.
  const createTableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gis;
  let createTable;
  while ((createTable = createTableRe.exec(text)) !== null) {
    const { schema, name } = normalizeIdentifier(createTable[1]);
    if (RLS_EXEMPT_SCHEMAS.has(schema)) continue;
    // Look for `alter table [if exists] <schema>.name ... enable row level security`, where the
    // schema must match the created table's. A public table may be referenced bare (`alter table
    // name`, which resolves to public via search_path) or as `public.name`; a non-public table must
    // be schema-qualified, since a bare reference would resolve to public, not this table.
    const schemaPrefix = schema === "public" ? `(?:"?public"?\\.)?` : `"?${schema}"?\\.`;
    const enableRe = new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?${schemaPrefix}"?${name}"?\\b[^;]*enable\\s+row\\s+level\\s+security`,
      "is",
    );
    if (!enableRe.test(text)) {
      findings.push({
        rule: RULES.TABLE_WITHOUT_RLS,
        detail: `table \`${schema}.${name}\` is created without \`enable row level security\` in the same migration`,
      });
    }
  }

  // Rule 3: security definer functions without set search_path.
  for (const chunk of splitFunctionDefinitions(text)) {
    if (!/\bsecurity\s+definer\b/is.test(chunk)) continue;
    if (/\bset\s+"?search_path"?\b/is.test(chunk)) continue;
    const nameMatch = chunk.match(/function\s+([a-z0-9_."]+)/is);
    const label = nameMatch ? normalizeIdentifier(nameMatch[1]).name : "(unnamed)";
    findings.push({
      rule: RULES.DEFINER_WITHOUT_SEARCH_PATH,
      detail: `security definer function \`${label}\` has no \`set search_path\``,
    });
  }

  return findings;
}

function versionOf(filename) {
  const match = filename.match(/^(\d{14})_/);
  return match ? Number(match[1]) : null;
}

async function loadAllowlist() {
  try {
    const raw = await readFile(join(SCRIPT_DIR, "migration-policy-allowlist.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("allowlist must be a JSON array");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Unable to read migration-policy-allowlist.json: ${error.message}`);
  }
}

function isAllowlisted(allowlist, file, rule, detail) {
  return allowlist.some((entry) => {
    if (entry.file !== file || entry.rule !== rule) return false;
    if (!entry.rationale || typeof entry.rationale !== "string" || entry.rationale.trim() === "") {
      return false; // an exception without a written rationale does not count
    }
    if (entry.match && !detail.includes(entry.match)) return false;
    return true;
  });
}

const SELF_TEST_FIXTURES = [
  {
    name: "clean tenant table",
    sql: `create table public.widgets (id uuid primary key, organization_id uuid not null);
          alter table public.widgets enable row level security;
          create policy widgets_select on public.widgets for select using (true);`,
    expect: [],
  },
  {
    name: "grant to anon",
    sql: `grant execute on function public.do_thing() to anon;`,
    expect: [RULES.ANON_PUBLIC_GRANT],
  },
  {
    name: "grant to public role",
    sql: `grant select on public.widgets to public;`,
    expect: [RULES.ANON_PUBLIC_GRANT],
  },
  {
    name: "table without rls",
    sql: `create table public.secrets (id uuid primary key, body text);`,
    expect: [RULES.TABLE_WITHOUT_RLS],
  },
  {
    name: "app_private table is exempt from rls rule",
    sql: `create table app_private.job_state (id uuid primary key);`,
    expect: [],
  },
  {
    name: "rls enabled on a different schema does not satisfy a public table",
    sql: `create table public.gadgets (id uuid primary key);
          alter table other_schema.gadgets enable row level security;`,
    expect: [RULES.TABLE_WITHOUT_RLS],
  },
  {
    name: "definer without search_path",
    sql: `create or replace function public.escalate() returns void language plpgsql security definer as $$ begin end; $$;`,
    expect: [RULES.DEFINER_WITHOUT_SEARCH_PATH],
  },
  {
    name: "definer with search_path is clean",
    sql: `create or replace function public.escalate() returns void language plpgsql security definer set search_path = '' as $$ begin end; $$;`,
    expect: [],
  },
  {
    name: "revoke from public is not a grant",
    sql: `revoke all on public.widgets from public;
          create table public.widgets (id uuid primary key);
          alter table public.widgets enable row level security;`,
    expect: [],
  },
  {
    name: "keyword inside a comment is ignored",
    sql: `-- grant execute on function x to anon in a future migration
          create table public.notes (id uuid primary key);
          alter table public.notes enable row level security;`,
    expect: [],
  },
];

function runSelfTest() {
  let failures = 0;
  for (const fixture of SELF_TEST_FIXTURES) {
    const got = analyzeMigrationSql(fixture.sql).map((f) => f.rule).sort();
    const want = [...fixture.expect].sort();
    const ok = got.length === want.length && got.every((rule, i) => rule === want[i]);
    if (!ok) {
      failures += 1;
      console.error(`✗ ${fixture.name}\n    expected: [${want.join(", ")}]\n    actual:   [${got.join(", ")}]`);
    }
  }
  if (failures > 0) {
    console.error(`\nMigration policy lint self-test FAILED (${failures}/${SELF_TEST_FIXTURES.length} cases).`);
    process.exit(1);
  }
  console.log(`Migration policy lint self-test passed (${SELF_TEST_FIXTURES.length} cases).`);
}

async function run() {
  // Always validate the rules against fixtures first, so a rule that silently stops
  // catching its class fails CI rather than passing every migration.
  runSelfTest();
  if (process.argv.includes("--self-test")) {
    return;
  }

  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("No supabase/migrations directory found; nothing to lint.");
      return;
    }
    throw error;
  }

  const allowlist = await loadAllowlist();
  const migrations = entries
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => {
      const version = versionOf(name);
      return version !== null && version > BASELINE_VERSION;
    })
    .sort();

  const problems = [];
  let allowlistedCount = 0;
  for (const file of migrations) {
    const sql = await readFile(join(migrationsDir, file), "utf8");
    for (const finding of analyzeMigrationSql(sql)) {
      if (isAllowlisted(allowlist, file, finding.rule, finding.detail)) {
        allowlistedCount += 1;
        continue;
      }
      problems.push({ file, ...finding });
    }
  }

  console.log(
    `Migration policy lint: scanned ${migrations.length} migration(s) newer than baseline ${BASELINE_VERSION}` +
      (allowlistedCount > 0 ? ` (${allowlistedCount} allowlisted finding(s) skipped).` : "."),
  );

  if (problems.length > 0) {
    console.error(`\nMigration policy lint found ${problems.length} issue(s):\n`);
    for (const problem of problems) {
      console.error(`  [${problem.rule}] ${problem.file}\n    ${problem.detail}`);
    }
    console.error(
      "\nEnable RLS + policies for public tables, avoid granting to anon/public, and set search_path on " +
        "security definer functions. If an exception is genuinely required, add a reviewed entry with a " +
        "rationale to scripts/migration-policy-allowlist.json.",
    );
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
