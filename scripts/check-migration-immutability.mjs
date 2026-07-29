import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

// Migration immutability check (PR-time complement to check-migration-drift.mjs).
//
// A deployed migration file is a record of what ran, not source that can be revised. The
// drift check catches post-deploy edits after the fact -- against the whole tree, long
// after the editor has moved on. That is how 93 content mismatches accumulated (a rebrand
// find/replace swept historical migrations along with live code) and how one real
// divergence hid in the noise. This script moves the same rule to PR time, against the
// diff, so the failure lands on the person making the edit:
//
//   A pull request may not modify, delete, or rename a migration file under
//   supabase/migrations/ whose version is already applied on the remote.
//
// Comment-only and string-only edits fail too -- repo-wide find/replace is exactly how
// this recurs. If a deployed migration genuinely needs different behavior, write a new
// migration. If a file must be corrected in place for reasons a new migration cannot
// express, the existing escape hatch applies: add or revise that version's *reason* in
// scripts/migration-content-allowlist.json *in the same PR*. Only content modifications
// (git status M) can be excused that way -- renames, deletions, and type changes (e.g.
// replacing a file with a symlink) are never excused, because the drift check cannot
// catch a same-version rename and a deletion would be an ORPHAN regardless.
//
// What counts as "applied on the remote":
//   - Without a token (the PR CI path): every migration file present on the base ref.
//     Merges to main deploy automatically (.github/workflows/deploy-migrations.yml), so
//     "on main" and "deployed" coincide except for the minutes between merge and deploy --
//     and blocking edits during that window is the correct outcome anyway. PR CI
//     deliberately does *not* pass SUPABASE_ACCESS_TOKEN: the job checks out untrusted
//     PR code, and a contributor could rewrite this script to exfiltrate the token.
//   - With SUPABASE_ACCESS_TOKEN set (local / trusted runs): the remote ledger
//     (supabase_migrations.schema_migrations via the Management API) *unioned with*
//     migrations on the base ref. The union closes the window where a migration has
//     merged to main but the deploy job has not yet recorded it remotely.
//
// Usage:
//   node scripts/check-migration-immutability.mjs --base origin/main
//   node scripts/check-migration-immutability.mjs --self-test
//
// The diff is `git diff base...HEAD` (merge-base to HEAD), so the base ref must be
// fetched (CI checks out with fetch-depth: 0). `--self-test` runs only the fixture suite
// for the pure classification logic (no git, no network) -- the fixtures also run at the
// start of every full invocation, mirroring scripts/check-migration-drift.mjs.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const MIGRATIONS_PREFIX = "supabase/migrations/";
const ALLOWLIST_REPO_PATH = "scripts/migration-content-allowlist.json";
const CONFIG_PATH = join(REPO_ROOT, "supabase", "config.toml");
const API_BASE = process.env.SUPABASE_API_URL || "https://api.supabase.com";

const execFileAsync = promisify(execFile);

/** Read the 14-digit timestamp version prefix from a migration file path. */
export function versionOf(path) {
  if (!path.startsWith(MIGRATIONS_PREFIX) || !path.endsWith(".sql")) return null;
  const match = path.slice(MIGRATIONS_PREFIX.length).match(/^(\d{14})_[^/]*$/);
  return match ? match[1] : null;
}

/**
 * Pure classification of a PR's migration-file changes (unit-tested via --self-test).
 *
 * @param {{status: string, path: string, newPath?: string}[]} changes  parsed
 *   `git diff --name-status` entries limited to supabase/migrations/*.sql. `status` is
 *   the first letter of the name-status code (A/M/D/R/T/…; rename similarity score
 *   stripped); for R, `path` is the old path and `newPath` the new one.
 * @param {Set<string>} appliedVersions  versions considered deployed.
 * @param {Set<string>} allowlistRevisedVersions  versions whose allowlist *reason* was
 *   added or meaningfully changed in the same diff.
 * @returns {{
 *   violations: {path: string, version: string, kind: string, detail: string}[],
 *   excused: {path: string, version: string, reason: string}[],
 * }}
 */
export function classifyMigrationEdits(changes, appliedVersions, allowlistRevisedVersions) {
  const violations = [];
  const excused = [];

  for (const change of changes) {
    const version = versionOf(change.path);
    if (!version) continue; // non-migration or malformed name; other checks own those
    if (!appliedVersions.has(version)) continue; // undeployed migrations are freely editable

    if (change.status === "A") continue; // backfilling a file for an applied version (ORPHAN repair) is allowed

    if (change.status === "D") {
      violations.push({
        path: change.path,
        version,
        kind: "deleted",
        detail:
          "a deployed migration file cannot be deleted; the drift check would report the applied " +
          "version as an ORPHAN. Restore the file.",
      });
      continue;
    }

    // Only content modifications (M) may use the allowlist escape hatch. Renames (R),
    // type changes (T), and any other status are never excused: a same-version rename
    // produces neither presence nor content drift, so the later drift check cannot catch
    // it, and a symlink swap would let later edits hide outside supabase/migrations/.
    if (change.status === "M" && allowlistRevisedVersions.has(version)) {
      excused.push({
        path: change.path,
        version,
        reason: `its ${ALLOWLIST_REPO_PATH} reason was added or revised in this same diff`,
      });
      continue;
    }

    const kind =
      change.status === "R"
        ? `renamed to ${change.newPath}`
        : change.status === "M"
          ? "modified"
          : `changed (${change.status})`;

    violations.push({
      path: change.path,
      version,
      kind,
      detail:
        change.status === "M"
          ? "this version is already applied on the remote. Write a new migration for behavior " +
            `changes; for an in-place correction, add or revise the ${version} reason in ` +
            `${ALLOWLIST_REPO_PATH} (with a written reason) in this same PR.`
          : "this version is already applied on the remote. Renames, deletions, and type " +
            "changes to deployed migration files are never allowed — restore the original " +
            "file and write a new migration for any behavior change.",
    });
  }

  return { violations, excused };
}

/** Trimmed reason string, or null when the entry has no usable reason. */
function normalizedReason(entry) {
  if (!entry || typeof entry.reason !== "string") return null;
  const trimmed = entry.reason.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Versions whose allowlist *reason* differs between the base and head allowlist objects
 * and whose head entry carries a nonempty written reason (the same rule the drift check
 * applies: an entry without a reason does not count).
 *
 * Compares the normalized reason text itself — not the whole JSON object — so adding an
 * ignored property or appending whitespace to an existing reason cannot excuse an edit.
 */
export function allowlistRevisions(baseAllowlist, headAllowlist) {
  const revised = new Set();
  for (const [version, entry] of Object.entries(headAllowlist ?? {})) {
    const headReason = normalizedReason(entry);
    if (headReason === null) continue;
    const baseReason = normalizedReason((baseAllowlist ?? {})[version]);
    if (baseReason !== headReason) revised.add(version);
  }
  return revised;
}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Parse `git diff --name-status -z` output into {status, path, newPath} entries. */
export function parseNameStatus(raw) {
  const fields = raw.split("\0").filter((field) => field !== "");
  const changes = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i][0]; // strip rename/copy similarity score
    if (status === "R" || status === "C") {
      // Treat copy (C) like rename for classification: both relocate an applied file.
      changes.push({ status: status === "C" ? "C" : "R", path: fields[i + 1], newPath: fields[i + 2] });
      i += 3;
    } else {
      changes.push({ status, path: fields[i + 1] });
      i += 2;
    }
  }
  return changes;
}

async function changedFiles(baseRef) {
  const raw = await git([
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    `${baseRef}...HEAD`,
  ]);
  return parseNameStatus(raw);
}

async function allowlistAt(ref) {
  let raw;
  if (ref === null) {
    try {
      raw = await readFile(join(REPO_ROOT, ALLOWLIST_REPO_PATH), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  } else {
    try {
      raw = await git(["show", `${ref}:${ALLOWLIST_REPO_PATH}`]);
    } catch {
      return {}; // file absent at that ref
    }
  }
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${ALLOWLIST_REPO_PATH} must be a JSON object mapping version -> { reason }`);
  }
  return parsed;
}

async function baseMigrationVersions(baseRef) {
  const raw = await git(["ls-tree", "-r", "--name-only", "-z", baseRef, MIGRATIONS_PREFIX]);
  const versions = new Set();
  for (const path of raw.split("\0")) {
    const version = versionOf(path);
    if (version) versions.add(version);
  }
  return versions;
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

async function remoteAppliedVersions(projectRef, token) {
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

/** Union two version sets (remote ledger + base-tree) into a new Set. */
export function unionVersions(...sets) {
  const out = new Set();
  for (const set of sets) {
    for (const version of set) out.add(version);
  }
  return out;
}

const SELF_TEST_FIXTURES = [
  {
    name: "modifying an applied migration is a violation",
    changes: [{ status: "M", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: ["20260101000000"],
    revised: [],
    expect: { violations: ["20260101000000"], excused: [] },
  },
  {
    name: "modifying an unapplied migration is fine",
    changes: [{ status: "M", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: [],
    revised: [],
    expect: { violations: [], excused: [] },
  },
  {
    name: "adding a new migration is fine",
    changes: [{ status: "A", path: "supabase/migrations/20260101000001_b.sql" }],
    applied: ["20260101000000"],
    revised: [],
    expect: { violations: [], excused: [] },
  },
  {
    name: "backfilling a file for an already-applied version (ORPHAN repair) is fine",
    changes: [{ status: "A", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: ["20260101000000"],
    revised: [],
    expect: { violations: [], excused: [] },
  },
  {
    name: "deleting an applied migration is always a violation, even with an allowlist revision",
    changes: [{ status: "D", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: ["20260101000000"],
    revised: ["20260101000000"],
    expect: { violations: ["20260101000000"], excused: [] },
  },
  {
    name: "renaming an applied migration is a violation",
    changes: [
      {
        status: "R",
        path: "supabase/migrations/20260101000000_a.sql",
        newPath: "supabase/migrations/20260101000000_renamed.sql",
      },
    ],
    applied: ["20260101000000"],
    revised: [],
    expect: { violations: ["20260101000000"], excused: [] },
  },
  {
    name: "renaming an applied migration is never excused by an allowlist revision",
    changes: [
      {
        status: "R",
        path: "supabase/migrations/20260101000000_a.sql",
        newPath: "supabase/migrations/20260101000000_renamed.sql",
      },
    ],
    applied: ["20260101000000"],
    revised: ["20260101000000"],
    expect: { violations: ["20260101000000"], excused: [] },
  },
  {
    name: "type-changing an applied migration (e.g. file -> symlink) is a violation",
    changes: [{ status: "T", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: ["20260101000000"],
    revised: [],
    expect: { violations: ["20260101000000"], excused: [] },
  },
  {
    name: "type-changing an applied migration is never excused by an allowlist revision",
    changes: [{ status: "T", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: ["20260101000000"],
    revised: ["20260101000000"],
    expect: { violations: ["20260101000000"], excused: [] },
  },
  {
    name: "modification with a same-diff allowlist revision is excused",
    changes: [{ status: "M", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: ["20260101000000"],
    revised: ["20260101000000"],
    expect: { violations: [], excused: ["20260101000000"] },
  },
  {
    name: "an allowlist revision for a different version does not excuse the edit",
    changes: [{ status: "M", path: "supabase/migrations/20260101000000_a.sql" }],
    applied: ["20260101000000"],
    revised: ["20260101000001"],
    expect: { violations: ["20260101000000"], excused: [] },
  },
  {
    name: "non-migration paths are ignored",
    changes: [
      { status: "M", path: "supabase/migrations/README.md" },
      { status: "M", path: "artifacts/caremetric-carebase/src/main.tsx" },
    ],
    applied: [],
    revised: [],
    expect: { violations: [], excused: [] },
  },
];

const ALLOWLIST_REVISION_FIXTURES = [
  {
    name: "new entry with a reason counts as revised",
    base: {},
    head: { "20260101000000": { reason: "reviewed" } },
    expect: ["20260101000000"],
  },
  {
    name: "changed reason counts as revised",
    base: { "20260101000000": { reason: "old" } },
    head: { "20260101000000": { reason: "new" } },
    expect: ["20260101000000"],
  },
  {
    name: "untouched entry does not count",
    base: { "20260101000000": { reason: "same" } },
    head: { "20260101000000": { reason: "same" } },
    expect: [],
  },
  {
    name: "new entry with a blank reason does not count",
    base: {},
    head: { "20260101000000": { reason: "  " } },
    expect: [],
  },
  {
    name: "whitespace-only reason change does not count",
    base: { "20260101000000": { reason: "reviewed" } },
    head: { "20260101000000": { reason: "  reviewed  " } },
    expect: [],
  },
  {
    name: "adding an ignored property without changing the reason does not count",
    base: { "20260101000000": { reason: "reviewed" } },
    head: { "20260101000000": { reason: "reviewed", note: "noise" } },
    expect: [],
  },
];

const UNION_FIXTURES = [
  {
    name: "unionVersions merges remote and base without duplicates",
    inputs: [
      ["20260101000000", "20260101000001"],
      ["20260101000001", "20260101000002"],
    ],
    expect: ["20260101000000", "20260101000001", "20260101000002"],
  },
];

function runSelfTest() {
  let failures = 0;

  const versionCases = [
    ["supabase/migrations/20260101000000_a.sql", "20260101000000"],
    ["supabase/migrations/notaversion.sql", null],
    ["supabase/migrations/20260101000000_a.txt", null],
    ["scripts/20260101000000_a.sql", null],
  ];
  for (const [path, expected] of versionCases) {
    const got = versionOf(path);
    if (got !== expected) {
      failures += 1;
      console.error(`✗ versionOf(${JSON.stringify(path)}) should be ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
  }

  const parsed = parseNameStatus("M\0a.sql\0R100\0old.sql\0new.sql\0D\0b.sql\0T\0c.sql\0");
  const parsedSummary = parsed.map((c) => `${c.status}:${c.path}${c.newPath ? `->${c.newPath}` : ""}`).join(",");
  if (parsedSummary !== "M:a.sql,R:old.sql->new.sql,D:b.sql,T:c.sql") {
    failures += 1;
    console.error(`✗ parseNameStatus mis-parsed rename/type output: ${parsedSummary}`);
  }

  for (const fixture of SELF_TEST_FIXTURES) {
    const got = classifyMigrationEdits(fixture.changes, new Set(fixture.applied), new Set(fixture.revised));
    const actual = {
      violations: got.violations.map((v) => v.version),
      excused: got.excused.map((e) => e.version),
    };
    if (JSON.stringify(actual) !== JSON.stringify(fixture.expect)) {
      failures += 1;
      console.error(
        `✗ ${fixture.name}\n    expected: ${JSON.stringify(fixture.expect)}\n    actual:   ${JSON.stringify(actual)}`,
      );
    }
  }

  for (const fixture of ALLOWLIST_REVISION_FIXTURES) {
    const actual = [...allowlistRevisions(fixture.base, fixture.head)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(fixture.expect)) {
      failures += 1;
      console.error(
        `✗ ${fixture.name}\n    expected: ${JSON.stringify(fixture.expect)}\n    actual:   ${JSON.stringify(actual)}`,
      );
    }
  }

  for (const fixture of UNION_FIXTURES) {
    const actual = [...unionVersions(...fixture.inputs.map((list) => new Set(list)))].sort();
    if (JSON.stringify(actual) !== JSON.stringify(fixture.expect)) {
      failures += 1;
      console.error(
        `✗ ${fixture.name}\n    expected: ${JSON.stringify(fixture.expect)}\n    actual:   ${JSON.stringify(actual)}`,
      );
    }
  }

  if (failures > 0) {
    console.error(`\nMigration immutability self-test FAILED (${failures} case(s)).`);
    process.exit(1);
  }
  const fixtureCount =
    SELF_TEST_FIXTURES.length + ALLOWLIST_REVISION_FIXTURES.length + UNION_FIXTURES.length;
  console.log(`Migration immutability self-test passed (${fixtureCount} fixtures).`);
}

function resolveBaseRef() {
  const flagIndex = process.argv.indexOf("--base");
  if (flagIndex !== -1) {
    const value = process.argv[flagIndex + 1];
    if (!value) throw new Error("--base requires a ref argument, e.g. --base origin/main");
    return value;
  }
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return "origin/main";
}

async function run() {
  // Always validate the classification logic against fixtures first, so a classifier that
  // silently stops catching edits fails loudly instead of passing every diff.
  runSelfTest();
  if (process.argv.includes("--self-test")) {
    return;
  }

  const baseRef = resolveBaseRef();
  try {
    await git(["rev-parse", "--verify", `${baseRef}^{commit}`]);
  } catch {
    throw new Error(
      `Base ref '${baseRef}' is not available in this clone. Fetch it first ` +
        `(e.g. git fetch origin ${baseRef.replace(/^origin\//, "")}) or pass --base <ref>.`,
    );
  }

  const changes = await changedFiles(baseRef);
  const migrationChanges = changes.filter(
    (change) => versionOf(change.path) !== null || (change.newPath && versionOf(change.newPath) !== null),
  );
  if (migrationChanges.length === 0) {
    console.log(`No migration files changed relative to ${baseRef}; nothing to check.`);
    return;
  }

  const baseVersions = await baseMigrationVersions(baseRef);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  let applied;
  let appliedSource;
  if (token) {
    // Trusted/local path only. PR CI must not set this secret — the job runs PR-controlled
    // code, and a rewritten script could exfiltrate the token before review.
    const projectRef = await resolveProjectRef();
    const remote = await remoteAppliedVersions(projectRef, token);
    applied = unionVersions(remote, baseVersions);
    appliedSource =
      `remote ledger of project ${projectRef} (${remote.size} applied) union ` +
      `migrations on ${baseRef} (${baseVersions.size} version(s); ${applied.size} combined)`;
  } else {
    applied = baseVersions;
    appliedSource =
      `migration files present on ${baseRef} (${applied.size} version(s)); ` +
      "SUPABASE_ACCESS_TOKEN is not set (expected for PR CI), and merges to main deploy " +
      "automatically, so the base tree stands in for the remote ledger";
  }

  const revised = allowlistRevisions(await allowlistAt(baseRef), await allowlistAt(null));
  const { violations, excused } = classifyMigrationEdits(migrationChanges, applied, revised);

  console.log(
    `Migration immutability check: ${migrationChanges.length} migration file change(s) vs ${baseRef}.`,
  );
  console.log(`Deployed versions from: ${appliedSource}.`);

  for (const { path, version, reason } of excused) {
    console.log(`  excused ${path} (version ${version}): ${reason}`);
  }

  if (violations.length === 0) {
    console.log("OK: no already-deployed migration file is modified, deleted, or renamed.");
    return;
  }

  console.error(
    `\nIMMUTABLE -- ${violations.length} already-deployed migration file(s) changed in this diff:`,
  );
  for (const { path, version, kind, detail } of violations) {
    console.error(`  ${path} (version ${version}, ${kind})\n    ${detail}`);
  }
  console.error(
    "\nA deployed migration file is a record of what ran, not source that can be revised -- " +
      "comment-only and wording edits count too, because they are exactly what a repo-wide " +
      "find/replace produces. Revert the file and write a new migration instead.",
  );
  process.exit(1);
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
