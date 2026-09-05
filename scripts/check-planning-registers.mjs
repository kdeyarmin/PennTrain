#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

// Planning-register check.
//
// This repository enforces roughly twenty machine-checkable invariants (migration
// immutability, edge-function drift, raise arity, date-only parsing, journey coverage)
// and enforced its planning documents not at all. The result was predictable and is the
// reason this script exists:
//
//   1. BACKLOG.md was introduced as "the single living backlog" in 1bb7af3 and was
//      already wrong two commits later, when #355 shipped SCORM, POC-lifecycle, and
//      import-worker code against rows the file still listed as `open`. Its own
//      "Last verified against main" stamp still pointed at the pre-#355 commit. The
//      file said "edit this file in the same PR that ships or retires work" -- a
//      convention with nothing behind it.
//   2. Seven documents accumulated that each read as the live answer to "what should I
//      work on next", two of which explicitly claim authority in their own first
//      paragraph (BACKLOG.md: "canonical forward backlog";
//      docs/audits/CAREBASE_COMPLETION_PROGRAM_2026-07-31.md: "the authoritative
//      completion register"). A reader cannot tell which is current without reading all
//      of them and diffing against code.
//
// Both failures are mechanical, so both are checkable. Two rules:
//
// RULE 1 -- the freshness stamp must be true.
//   BACKLOG.md declares `**Last verified against main:** \`<sha>\``. That sha must exist,
//   must be an ancestor of HEAD, and no register-affecting commit may sit between it and
//   HEAD. In PR mode (--base), a diff that touches register-affecting paths must also
//   touch BACKLOG.md, so the person shipping the work re-verifies the register while the
//   work is still in their head -- rather than a reviewer noticing months later that
//   every row is a guess.
//
//   "Register-affecting" is deliberately narrow: application source, migrations, and
//   edge functions change what is open. Tests, fixtures, generated types, and docs do
//   not, so a test-only or docs-only PR never trips this. See PATH_RULES below -- that
//   distinction is the whole escape hatch, and it is a principled one rather than a
//   list of excused commits.
//
// RULE 2 -- exactly one document may claim authority.
//   Every planning register is listed in REGISTERS with an explicit role. The canonical
//   one carries no banner; every other one must open with SUPERSESSION_MARKER so a
//   reader who lands on it mid-file learns immediately that it is not the live list. A
//   new root-level planning document that nobody registered fails the check, because
//   "add another comprehensive review markdown" is the exact habit that produced seven
//   of them.
//
// Usage:
//   node scripts/check-planning-registers.mjs                  # tree mode (main / local)
//   node scripts/check-planning-registers.mjs --base origin/main   # PR mode
//   node scripts/check-planning-registers.mjs --self-test       # pure logic fixtures
//
// --self-test runs only the pure classification/parsing fixtures (no git, no network).
// Those fixtures also run at the start of every full invocation, mirroring
// scripts/check-migration-immutability.mjs.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const run = promisify(execFile);

const CANONICAL_REGISTER = "BACKLOG.md";
const BASELINE_PATTERN = /\*\*Last verified against main:\*\*\s*`([0-9a-f]{7,40})`/i;

// Two different claims, because they are two different facts. Calling a live design doc
// "superseded" to satisfy a checker would be a lie that costs more than the sprawl did.
const SUPERSESSION_MARKER = "> **Superseded as a planning source.**";
const REFERENCE_MARKER = "> **Not the backlog.**";

const MARKER_BY_ROLE = {
  superseded: SUPERSESSION_MARKER,
  reference: REFERENCE_MARKER,
};

// How far into the file the supersession banner must appear. A banner buried under a
// screen of prose does not warn anyone.
const BANNER_SCAN_LINES = 12;

/**
 * Every planning document that carries dated, ID'd, or status-bearing work items.
 *
 * role:
 *   "canonical"  -- the live list. Exactly one, and it carries no banner.
 *   "superseded" -- dead as a planning source. Its open items were either folded into
 *                   BACKLOG.md or deliberately dropped. Kept for archaeology.
 *   "reference"  -- still true and still worth reading, but it is not the list of what
 *                   is open. Long-horizon programs, specs, runbook-adjacent docs.
 */
const REGISTERS = [
  { path: "BACKLOG.md", role: "canonical" },

  // The six that competed with BACKLOG.md for "what should I work on next". Two of them
  // (ROADMAP.md, CAREBASE_COMPLETION_PROGRAM) claimed authority in their own opening
  // paragraph, which is how a reader ends up believing three different things at once.
  { path: "ROADMAP.md", role: "superseded" },
  { path: "WORKFLOW_UX_REVIEW_2026-07-31.md", role: "superseded" },
  { path: "docs/audits/IMPROVEMENT_BACKLOG.md", role: "superseded" },
  { path: "docs/audits/QUICK_WINS.md", role: "superseded" },
  { path: "docs/audits/IMPLEMENTATION_ROADMAP.md", role: "superseded" },
  { path: "docs/audits/CAREBASE_COMPLETION_PROGRAM_2026-07-31.md", role: "superseded" },

  // Branch-scoped progress trackers for branches that have long since merged, and the
  // historical root review set. These read as live status and are not.
  { path: "CAREBASE_25_IMPROVEMENT_PROGRAM.md", role: "superseded" },
  { path: "CAREBASE_25_IMPROVEMENT_PROGRESS.md", role: "superseded" },
  { path: "CAREBASE_ACTIVATION_WAVE_PROGRESS.md", role: "superseded" },
  { path: "PRODUCT_VALUE_OPERATING_SYSTEM.md", role: "superseded" },
  { path: "EFFICIENCY_REVIEW.md", role: "superseded" },
  { path: "END_USER_REVIEW.md", role: "superseded" },
  { path: "ENHANCEMENT_REPORT.md", role: "superseded" },
  { path: "FEATURE_FUNCTIONALITY_ENHANCEMENT_REPORT.md", role: "superseded" },
  { path: "PLATFORM_ENHANCEMENTS.md", role: "superseded" },
  { path: "PennTrain_Backlog_Delta_2026-07-21.md", role: "superseded" },
  { path: "PennTrain_Backlog_Delta_2026-07-24.md", role: "superseded" },
  { path: "PennTrain_Comprehensive_Review_2026-07-20.md", role: "superseded" },
  { path: "PennTrain_Comprehensive_Review_2026-07-21.md", role: "superseded" },
  { path: "PennTrain_Comprehensive_Review_2026-07-24.md", role: "superseded" },
  { path: "PennTrain_Execution_Backlog_2026-07-20.md", role: "superseded" },
  { path: "PennTrain_Feature_Backlog_Delta_2026-07-21.md", role: "superseded" },
  { path: "PennTrain_Feature_Review_2026-07-21.md", role: "superseded" },

  // Live and correct, but not the backlog.
  { path: "IMPLEMENTATION_PLAN.md", role: "reference" },
  { path: "RESIDENT_360_PROGRAM_PLAN.md", role: "reference" },
  { path: "COMPLIANCE_COMMAND_CENTER.md", role: "reference" },
  { path: "MIGRATION_DEPLOYMENT_AUDIT.md", role: "reference" },
  { path: "SURVEY_DAY_MODE_SPEC.md", role: "reference" },
  { path: "PA_DHS_ANNUAL_TRAINING_MATRIX.md", role: "reference" },
  { path: "docs/ops/GO_LIVE_READINESS_REVIEW_PLAN.md", role: "reference" },
  { path: "docs/ops/PILOT_READINESS_PLAN.md", role: "reference" },
];

// Root-level markdown whose name reads like a planning register. Anything matching this
// that is not in REGISTERS is an unregistered eighth opinion.
const PLANNING_NAME_PATTERN =
  /(backlog|roadmap|review|program|progress|plan|delta|audit|wins|enhancement)/i;

// Root markdown that is documentation of the system rather than a plan for it.
const NON_REGISTER_ROOT_DOCS = new Set([
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "ARCHITECTURE.md",
  "DEPLOYMENT.md",
  "BILLING_MODEL.md",
  "PRODUCT_MODULES.md",
  "HOW_TO_PUSH.md",
  "replit.md",
  "ENTERPRISE_OPERATIONS_RUNBOOK.md",
  "PHASE1_OPERATIONS.md",
  "PHASE2_OPERATIONS.md",
  "PHASE3_OPERATIONS.md",
  "PHASE4_OPERATIONS.md",
  "PHASE5_OPERATIONS.md",
]);

/**
 * Ordered path rules. First match wins.
 *
 * The "neutral" rules come first on purpose: a test file under src/ is neutral even
 * though src/ is register-affecting. Tests and fixtures prove existing rows; they do not
 * open or close them. Generated files (database.types.ts) are a build artifact of a
 * migration that was itself already counted.
 */
const PATH_RULES = [
  { effect: "neutral", test: (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) },
  { effect: "neutral", test: (p) => /(^|\/)(e2e|__tests__|__fixtures__|fixtures)\//.test(p) },
  { effect: "neutral", test: (p) => /(^|\/)database\.types\.ts$/.test(p) },
  { effect: "neutral", test: (p) => /\.(md|json|lock|yaml|yml|toml)$/.test(p) },
  { effect: "neutral", test: (p) => p.startsWith("supabase/tests/") },

  { effect: "affecting", test: (p) => /^artifacts\/[^/]+\/src\//.test(p) },
  { effect: "affecting", test: (p) => p.startsWith("supabase/migrations/") },
  { effect: "affecting", test: (p) => p.startsWith("supabase/functions/") },
];

/** Classify one repo-relative path as register-affecting or neutral. */
export function classifyPath(path) {
  for (const rule of PATH_RULES) {
    if (rule.test(path)) return rule.effect;
  }
  return "neutral";
}

/** Pull the declared baseline sha out of BACKLOG.md, or null when the stamp is missing. */
export function parseDeclaredBaseline(markdown) {
  const match = BASELINE_PATTERN.exec(markdown);
  return match ? match[1].toLowerCase() : null;
}

/** True when the given banner marker appears near the top of a document. */
export function hasBanner(markdown, marker) {
  return markdown
    .split("\n")
    .slice(0, BANNER_SCAN_LINES)
    .some((line) => line.trim().startsWith(marker));
}

/** True when a document carries any recognised planning banner. */
export function hasAnyBanner(markdown) {
  return Object.values(MARKER_BY_ROLE).some((marker) => hasBanner(markdown, marker));
}

/**
 * Does one commit's file list count as drift?
 *
 * Drift means: it changed something register-affecting and did not re-verify the register
 * in the same commit. Pure so it can be fixtured -- this rule is subtle enough that it
 * shipped wrong once (every conforming commit was flagged), and a regression here would
 * silently un-gate the whole check.
 */
export function commitIsDrift(changedPaths) {
  if (changedPaths.includes(CANONICAL_REGISTER)) return false;
  return changedPaths.some((path) => classifyPath(path) === "affecting");
}

/**
 * Parse the "Standing gaps" table out of BACKLOG.md.
 *
 * A standing gap is a known, accepted, *unfixed* problem -- the kind that survives review
 * cycles precisely because nothing fails while it is open. Each row carries a review date.
 * Once that date passes, this check goes red until someone either closes the row or
 * consciously re-dates it. That is the whole mechanism: it converts "nobody brought it up
 * again" into "the build is red", which is the only form of follow-up this repo has ever
 * actually honoured.
 *
 * Mirrors the human-review freshness gate already in scripts/check-dhs-sources.mjs.
 */
export function parseStandingGaps(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,}\s+.*standing gaps/i.test(line));
  if (start === -1) return [];

  const gaps = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{2,}\s/.test(line)) break;
    if (!line.trim().startsWith("|")) continue;

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;

    const id = cells[0];
    if (!/^SG-\d+$/i.test(id)) continue;

    const dateCell = cells[cells.length - 1];
    const match = /(\d{4}-\d{2}-\d{2})/.exec(dateCell);
    gaps.push({ id, reviewBy: match ? match[1] : null, summary: cells[1] ?? "" });
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Pure-logic fixtures. These run on every invocation, not just --self-test.
// ---------------------------------------------------------------------------

const FIXTURES = [
  // classifyPath -- register-affecting
  ["classify src page", () => classifyPath("artifacts/caremetric-carebase/src/pages/app/Today.tsx") === "affecting"],
  ["classify migration", () => classifyPath("supabase/migrations/20260801021000_poc_lifecycle_versions.sql") === "affecting"],
  ["classify edge function", () => classifyPath("supabase/functions/dispatch-notifications/index.ts") === "affecting"],

  // classifyPath -- neutral (the escape hatch)
  ["classify unit test", () => classifyPath("artifacts/caremetric-carebase/src/lib/learning/bundleRuntimeAdapter.test.ts") === "neutral"],
  ["classify e2e fixture", () => classifyPath("artifacts/caremetric-carebase/e2e/fixtures/learning-packages/index.html") === "neutral"],
  ["classify generated types", () => classifyPath("artifacts/caremetric-carebase/src/lib/database.types.ts") === "neutral"],
  ["classify pgtap test", () => classifyPath("supabase/tests/database/rls_and_recalc.test.sql") === "neutral"],
  ["classify markdown", () => classifyPath("docs/design/POC_LIFECYCLE.md") === "neutral"],
  ["classify lockfile", () => classifyPath("pnpm-lock.yaml") === "neutral"],
  ["classify root config", () => classifyPath("railway.json") === "neutral"],

  // parseDeclaredBaseline
  ["baseline parsed", () => parseDeclaredBaseline("**Last verified against main:** `b7d734b` (2026-08-01)") === "b7d734b"],
  ["baseline lowercased", () => parseDeclaredBaseline("**Last verified against main:** `B7D734B`") === "b7d734b"],
  ["baseline missing", () => parseDeclaredBaseline("# Backlog\n\nno stamp here") === null],

  // hasBanner / hasAnyBanner
  ["banner found", () => hasBanner(`# Doc\n\n${SUPERSESSION_MARKER} See BACKLOG.md.\n`, SUPERSESSION_MARKER)],
  ["banner absent", () => hasBanner("# Doc\n\nSome prose.\n", SUPERSESSION_MARKER) === false],
  [
    "banner too deep",
    () => hasBanner(`# Doc\n${"\nfiller".repeat(30)}\n${SUPERSESSION_MARKER}\n`, SUPERSESSION_MARKER) === false,
  ],
  [
    // The two markers are distinct claims; a reference banner must not satisfy a
    // supersession requirement or the distinction is decorative.
    "reference banner does not satisfy supersession",
    () => hasBanner(`# Doc\n\n${REFERENCE_MARKER} See BACKLOG.md.\n`, SUPERSESSION_MARKER) === false,
  ],
  ["any-banner detects reference", () => hasAnyBanner(`# Doc\n\n${REFERENCE_MARKER}\n`)],
  ["any-banner detects supersession", () => hasAnyBanner(`# Doc\n\n${SUPERSESSION_MARKER}\n`)],
  ["any-banner rejects plain doc", () => hasAnyBanner("# Doc\n\nprose\n") === false],

  // commitIsDrift -- the rule that shipped wrong once. A stamp cannot name the commit
  // containing it, so a commit that re-verifies the register certifies its own work.
  [
    "drift: src only",
    () => commitIsDrift(["artifacts/caremetric-carebase/src/pages/app/Today.tsx"]),
  ],
  ["drift: migration only", () => commitIsDrift(["supabase/migrations/20260801_x.sql"])],
  [
    "conforming: src + register in one commit",
    () =>
      commitIsDrift(["artifacts/caremetric-carebase/src/pages/app/Today.tsx", "BACKLOG.md"]) ===
      false,
  ],
  [
    "conforming: migration + register in one commit",
    () => commitIsDrift(["supabase/migrations/20260801_x.sql", "BACKLOG.md"]) === false,
  ],
  ["no drift: neutral files only", () => commitIsDrift(["README.md", "railway.json"]) === false],
  ["no drift: tests only", () => commitIsDrift(["src/lib/thing.test.ts"]) === false],
  ["no drift: empty commit", () => commitIsDrift([]) === false],
  [
    // A register edit alone is not drift and must not need a stamp bump to itself.
    "no drift: register only",
    () => commitIsDrift(["BACKLOG.md"]) === false,
  ],

  // parseStandingGaps
  [
    "standing gaps parsed",
    () => {
      const gaps = parseStandingGaps(
        [
          "## Standing gaps",
          "",
          "| ID | Gap | Gate | Review by |",
          "| --- | --- | --- | --- |",
          "| SG-1 | Railway ships untested | tests in build | 2026-09-01 |",
          "| SG-2 | PA rule pack empty | authored pack | 2026-10-01 |",
          "",
          "## Next section",
          "",
          "| SG-9 | not a gap, wrong section | x | 2020-01-01 |",
        ].join("\n"),
      );
      return (
        gaps.length === 2 &&
        gaps[0].id === "SG-1" &&
        gaps[0].reviewBy === "2026-09-01" &&
        gaps[1].reviewBy === "2026-10-01"
      );
    },
  ],
  [
    "standing gap without date is caught",
    () => {
      const gaps = parseStandingGaps(
        ["## Standing gaps", "", "| SG-1 | thing | gate | soon |"].join("\n"),
      );
      return gaps.length === 1 && gaps[0].reviewBy === null;
    },
  ],
  ["no standing gaps section", () => parseStandingGaps("# Backlog\n\nnothing here").length === 0],
  [
    "header row is not a gap",
    () =>
      parseStandingGaps(
        ["## Standing gaps", "", "| ID | Gap | Review by |", "| --- | --- | --- |"].join("\n"),
      ).length === 0,
  ],
];

function runFixtures() {
  const failures = FIXTURES.filter(([, assertion]) => {
    try {
      return !assertion();
    } catch {
      return true;
    }
  }).map(([name]) => name);

  if (failures.length > 0) {
    console.error("check-planning-registers self-test failed:");
    for (const name of failures) console.error(`  - ${name}`);
    process.exit(1);
  }
  return FIXTURES.length;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function git(args) {
  const { stdout } = await run("git", args, { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

async function revParse(ref) {
  try {
    return await git(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

/**
 * True when this working copy is a shallow clone.
 *
 * The freshness rule reads history: it resolves the declared baseline commit and walks
 * `baseline..HEAD`. A shallow checkout has neither, so the rule cannot be evaluated —
 * and a shallow clone is the normal case for most CI jobs (`actions/checkout` defaults to
 * fetch-depth 1). Reporting "that is not a commit in this repository" there would be a
 * false accusation about a stamp that is perfectly correct.
 *
 * This is a skip, not a bypass: it triggers only on a genuinely shallow repository. In a
 * full clone -- every developer machine, and the dedicated `planning-registers` CI job,
 * which checks out with fetch-depth 0 -- a bogus or stale stamp still fails. The banner
 * and singularity rules are pure filesystem checks and run either way.
 */
async function isShallowRepository() {
  try {
    return (await git(["rev-parse", "--is-shallow-repository"])) === "true";
  } catch {
    return false;
  }
}

async function isAncestor(ancestor, descendant) {
  try {
    await git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commits in (from, to] that changed register-affecting files *without* re-verifying the
 * register in the same commit.
 *
 * The second half of that sentence is load-bearing. A stamp can never name the commit
 * that contains it, and a squash merge cannot carry a SHA computed before the squash
 * existed. So a commit that touches BACKLOG.md is treated as self-certifying: whoever
 * wrote it re-verified the register as part of the same change, which is exactly the
 * discipline being enforced.
 *
 * Without this, every *conforming* product PR would turn main red the moment it merged --
 * PR mode would pass it, then tree mode on main would flag the merge commit as drift,
 * blocking ci-result and with it deploy-migrations.yml. A gate that fails on correct
 * behaviour trains people to disable the gate.
 */
async function registerAffectingCommits(from, to) {
  const UNIT_SEPARATOR = "\x1f";
  const raw = await git(["log", "--format=%H%x1f%s", "--name-only", `${from}..${to}`]);
  if (!raw) return [];

  const commits = [];
  let current = null;

  for (const line of raw.split("\n")) {
    if (line.includes(UNIT_SEPARATOR)) {
      const [sha, subject] = line.split(UNIT_SEPARATOR);
      current = { sha, subject, changedPaths: [] };
      commits.push(current);
      continue;
    }
    const path = line.trim();
    if (path && current) current.changedPaths.push(path);
  }

  return commits
    .filter((commit) => commitIsDrift(commit.changedPaths))
    .map((commit) => ({
      ...commit,
      paths: commit.changedPaths.filter((path) => classifyPath(path) === "affecting"),
    }));
}

// ---------------------------------------------------------------------------
// Rule 1 -- the freshness stamp must be true
// ---------------------------------------------------------------------------

async function checkFreshness(baseRef) {
  const problems = [];
  const backlogPath = join(REPO_ROOT, CANONICAL_REGISTER);

  let markdown;
  try {
    markdown = await readFile(backlogPath, "utf8");
  } catch {
    return [`${CANONICAL_REGISTER} is missing. The canonical register may not be deleted.`];
  }

  const declared = parseDeclaredBaseline(markdown);
  if (!declared) {
    return [
      `${CANONICAL_REGISTER} has no freshness stamp.`,
      "  Add a line of the form: **Last verified against main:** `<sha>` (<date>)",
    ];
  }

  const declaredSha = await revParse(declared);
  if (!declaredSha) {
    // Order matters: only an *unresolvable* stamp gets the shallow excuse. A shallow
    // clone that still contains the baseline commit is fully checkable, and most are --
    // truncated history is not the same as no history.
    if (await isShallowRepository()) {
      console.log(
        `Freshness rule skipped: \`${declared}\` is beyond this shallow clone's history. ` +
          "The planning-registers CI job checks out with fetch-depth 0 and is the real gate.",
      );
      return problems;
    }
    return [
      `${CANONICAL_REGISTER} is stamped against \`${declared}\`, which is not a commit in this repository.`,
      "  Re-verify the register against a real commit and update the stamp.",
    ];
  }

  const head = await revParse("HEAD");
  if (!(await isAncestor(declaredSha, head))) {
    problems.push(
      `${CANONICAL_REGISTER} is stamped against \`${declared}\`, which is not an ancestor of HEAD.`,
      "  The stamp must name a commit this branch actually contains.",
    );
    return problems;
  }

  if (baseRef) {
    // PR mode: work landing in this diff must re-verify the register.
    const baseSha = await revParse(baseRef);
    if (!baseSha) {
      return [`--base ref \`${baseRef}\` could not be resolved. Fetch it first (CI uses fetch-depth: 0).`];
    }
    const mergeBase = await git(["merge-base", baseSha, head]);
    const changed = (await git(["diff", "--name-only", `${mergeBase}...${head}`]))
      .split("\n")
      .filter(Boolean);

    const affecting = changed.filter((path) => classifyPath(path) === "affecting");
    const touchesRegister = changed.includes(CANONICAL_REGISTER);

    if (affecting.length > 0 && !touchesRegister) {
      problems.push(
        `This change touches ${affecting.length} register-affecting file(s) but leaves ${CANONICAL_REGISTER} untouched.`,
        "",
        "  Application source, migrations, and edge functions change what is open. Re-verify",
        `  the affected rows and bump the stamp in this same change set -- that is the whole`,
        `  point of a living register. Tests, fixtures, generated types, and docs are exempt.`,
        "",
        "  Register-affecting files here:",
        ...affecting.slice(0, 12).map((path) => `    ${path}`),
        ...(affecting.length > 12 ? [`    ... and ${affecting.length - 12} more`] : []),
      );
    }
    return problems;
  }

  // Tree mode: the stamp must still be true for the tree as it stands.
  const drifted = await registerAffectingCommits(declaredSha, head);
  if (drifted.length > 0) {
    problems.push(
      `${CANONICAL_REGISTER} is stamped against \`${declared}\` but ${drifted.length} register-affecting commit(s) have landed since:`,
      "",
      ...drifted.map((commit) => `    ${commit.sha.slice(0, 7)}  ${commit.subject}`),
      "",
      `  Re-verify the affected rows against code and bump the stamp in ${CANONICAL_REGISTER}.`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Rule 2 -- exactly one document may claim authority
// ---------------------------------------------------------------------------

async function checkRegisterSingularity() {
  const problems = [];
  const registered = new Map(REGISTERS.map((entry) => [entry.path, entry]));

  const canonical = REGISTERS.filter((entry) => entry.role === "canonical");
  if (canonical.length !== 1) {
    problems.push(`REGISTERS must declare exactly one canonical register; found ${canonical.length}.`);
  }

  for (const entry of REGISTERS) {
    let markdown;
    try {
      markdown = await readFile(join(REPO_ROOT, entry.path), "utf8");
    } catch {
      // A retired register is fine; it just may not stay listed as live.
      problems.push(
        `${entry.path} is listed in REGISTERS but does not exist.`,
        "  Remove it from scripts/check-planning-registers.mjs in the same change set.",
      );
      continue;
    }

    if (entry.role === "canonical") {
      if (hasAnyBanner(markdown)) {
        problems.push(
          `${entry.path} is the canonical register but carries a banner that disclaims it.`,
        );
      }
      continue;
    }

    const marker = MARKER_BY_ROLE[entry.role];
    if (!marker) {
      problems.push(`${entry.path} has unknown role "${entry.role}".`);
      continue;
    }

    if (!hasBanner(markdown, marker)) {
      problems.push(
        `${entry.path} is registered as "${entry.role}" but does not say so up front.`,
        `  Add this within the first ${BANNER_SCAN_LINES} lines:`,
        `    ${marker} See [BACKLOG.md](...) for open work.`,
      );
    }
  }

  // An unregistered root-level planning document is an eighth opinion nobody asked for.
  const rootEntries = await readdir(REPO_ROOT, { withFileTypes: true });
  for (const dirent of rootEntries) {
    if (!dirent.isFile() || !dirent.name.endsWith(".md")) continue;
    if (registered.has(dirent.name)) continue;
    if (NON_REGISTER_ROOT_DOCS.has(dirent.name)) continue;
    if (!PLANNING_NAME_PATTERN.test(dirent.name)) continue;

    problems.push(
      `${dirent.name} is a new root-level planning document that no one registered.`,
      `  ${CANONICAL_REGISTER} is the living backlog -- update it instead of adding a parallel register.`,
      "  If this document genuinely must exist, add it to REGISTERS in",
      "  scripts/check-planning-registers.mjs with an explicit role and a supersession banner.",
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Rule 3 -- a standing gap may not quietly outlive its review date
// ---------------------------------------------------------------------------

async function checkStandingGaps(today) {
  const problems = [];

  let markdown;
  try {
    markdown = await readFile(join(REPO_ROOT, CANONICAL_REGISTER), "utf8");
  } catch {
    return []; // Rule 1 already reported the missing register.
  }

  const gaps = parseStandingGaps(markdown);
  if (gaps.length === 0) return problems;

  for (const gap of gaps) {
    if (!gap.reviewBy) {
      problems.push(
        `Standing gap ${gap.id} has no review date.`,
        "  Every standing gap needs a `Review by` date in ISO form (YYYY-MM-DD).",
      );
      continue;
    }
    if (gap.reviewBy < today) {
      problems.push(
        `Standing gap ${gap.id} passed its review date (${gap.reviewBy}, today is ${today}).`,
        `    ${gap.summary}`,
        "",
        "  This row is an accepted, unfixed problem. Do one of:",
        "    - fix it and delete the row;",
        "    - decide it is permanently acceptable and move it to \"Explicitly not now\";",
        "    - deliberately re-date it, which is a decision someone is now on record for.",
        "  Letting it sit is the one option this check removes.",
        "",
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const selfTestOnly = argv.includes("--self-test");
  const baseIndex = argv.indexOf("--base");
  const baseRef = baseIndex >= 0 ? argv[baseIndex + 1] : null;

  const fixtureCount = runFixtures();
  if (selfTestOnly) {
    console.log(`check-planning-registers self-test passed (${fixtureCount} fixtures).`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const problems = [
    ...(await checkFreshness(baseRef)),
    ...(await checkRegisterSingularity()),
    ...(await checkStandingGaps(today)),
  ];

  if (problems.length > 0) {
    console.error("Planning-register check failed.\n");
    for (const line of problems) console.error(line);
    console.error("");
    process.exit(1);
  }

  console.log(
    `Planning registers OK (${fixtureCount} fixtures, ${REGISTERS.length} registered documents, ` +
      `${baseRef ? `PR mode against ${baseRef}` : "tree mode"}).`,
  );
}

main().catch((error) => {
  console.error("check-planning-registers crashed:", error);
  process.exit(1);
});
