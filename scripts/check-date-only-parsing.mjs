#!/usr/bin/env node
/**
 * DATE-only columns must not be parsed as instants.
 *
 * `new Date("2026-07-26")` is UTC midnight. West of Greenwich that renders as 25 July and sorts
 * before any same-day timestamp, so a DATE column compared against a `timestamptz` -- or simply
 * displayed -- is wrong by a day for most of the world. Postgres `date` columns carry no time, so
 * the value has to be pinned to a local wall-clock time before it becomes a Date.
 *
 * The convention already used almost everywhere in this repo is to append an explicit time:
 *
 *     new Date(`${row.effective_date}T00:00:00`)   // local midnight
 *
 * This found three real instances: a clinical conflict detector that flagged plans written IN
 * RESPONSE to a hospital return as predating it (the error direction changed with the deployment's
 * timezone), and two dates rendered a day early -- one of them on the same line as a correct usage.
 *
 * Sorting-only uses are permitted: a uniform offset does not change an ordering. They are listed
 * explicitly rather than pattern-matched, so adding one is a deliberate act.
 *
 * The set of DATE columns is parsed out of `supabase/migrations` on every run rather than kept as
 * a literal list, so a column added tomorrow is covered tomorrow. See DECLARATION_PATTERNS below
 * for why that replaced the hand-maintained array, and MINIMUM_EXPECTED_COLUMNS for the tripwire
 * that stops a broken parser from turning this into a check that passes without checking.
 *
 * Scope note: this reads the frontend only. The same bug is expressible in SQL -- casting a `date`
 * column to `timestamptz` inside a payload the client renders ships UTC midnight and displays a day
 * early, which is what #322 fixed in the platform-admin dashboard RPC. A sweep of the migrations
 * found no other instance, and the SQL forms that do appear (comparisons, sort keys, insert values)
 * are all cases where a uniform offset is harmless, so there is nothing to gate on yet. If that
 * pattern recurs, extend this check rather than starting a new one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../artifacts/caremetric-carebase/src");
const MIGRATIONS = resolve(HERE, "../supabase/migrations");
const ROOT = resolve(HERE, "..");

// The column list is DERIVED from the migrations rather than hand-maintained.
//
// It used to be a literal array, on the reasoning that the check runs without a database. That was
// true and still left the guard covering 25 of the schema's 78 `date` columns -- and the check
// printed "passed (25 DATE columns)", which reads like authority rather than a third of the
// surface. Among the 53 it did not know: `completion_date`, `expiration_date`, `next_due_date`,
// `date_of_birth`, `termination_date`, and `inspection_date` -- the exact column that shipped a
// day-early compliance timeline in #322. A hand-maintained list of schema facts drifts from the
// schema; the migrations ARE the schema and are sitting right here, so parse them.
//
// Over-inclusion is safe: an extra name only matters if code calls `new Date()` on a field of that
// name, which is precisely the thing worth flagging. Under-inclusion is the dangerous direction,
// so a parser that finds implausibly few columns fails loudly (see MINIMUM_EXPECTED_COLUMNS)
// instead of passing vacuously -- a check that silently stops checking is worse than no check.
const DECLARATION_PATTERNS = [
  // `foo date`, `foo date not null`, `foo date default ...` inside a create-table body,
  // and date-typed columns of a `returns table (...)`.
  /^\s*([a-z_][a-z0-9_]*)\s+date\b/,
  // `alter table x add column [if not exists] foo date`
  /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+date\b/,
];

// plpgsql locals (`v_today date := ...`) and function parameters (`p_due_date date`) are not
// columns. They are declared with the same syntax, and this repo prefixes both by convention.
const NOT_A_COLUMN = /^(v_|p_)/;

// A floor, not a target. Purely a tripwire for a silently-broken parser.
const MINIMUM_EXPECTED_COLUMNS = 60;

export function deriveDateColumns(sqlTexts) {
  const found = new Set();
  for (const text of sqlTexts) {
    for (const line of text.split("\n")) {
      for (const pattern of DECLARATION_PATTERNS) {
        const match = pattern.exec(line);
        if (match && !NOT_A_COLUMN.test(match[1])) found.add(match[1]);
      }
    }
  }
  return [...found].sort();
}

function readMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));
}

// Uses where a uniform offset cannot change the outcome, each with the reason it is safe.
const SORT_ONLY_ALLOWLIST = new Set([
  "src/pages/employee/MyCourses.tsx",   // due_date used only to order the assignment list
  "src/pages/employee/MyTrainings.tsx", // same
]);

// Name collisions: the same column name is `date` in one table and `timestamptz` in another.
//
// The derivation above is deliberately over-inclusive, on the reasoning that "an extra name only
// matters if code calls new Date() on a field of that name, which is precisely the thing worth
// flagging". That holds right up until two tables disagree about a name, and then it does not: this
// check works from names alone and cannot see which table an expression came from, so it reports a
// correct instant parse as a defect.
//
// The answer is NOT to drop the name -- that would stop guarding the table where it really is a
// DATE -- and it is not to rename the local so the regex misses it, which is evasion dressed as
// refactoring. It is to state the collision here, per file and per column, naming both sides so the
// claim can be checked. Anything not listed is still a failure.
const TYPE_COLLISION_ALLOWLIST = new Map([
  [
    "src/pages/app/AdmissionOperations.tsx",
    new Map([[
      "scheduled_for",
      "timestamptz on admission_activities (20260713170000); `date` on survey_rehearsals "
      + "(20260731054000), which is where the name is derived from",
    ]]),
  ],
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Returns the DATE columns this line parses as an instant. Unchanged in behaviour from the
// original inline loop; extracted so the self-test can exercise it without touching the filesystem.
export function offendingColumns(line, columns) {
  const hits = [];
  for (const column of columns) {
    // Parens are BALANCED rather than matched with [^)]*, because a wrapper like
    // String(offer.shift_date) closes early and truncates the argument -- the first version of
    // this check reported three false positives that way.
    for (const start of [...line.matchAll(/new Date\(/g)].map((m) => m.index)) {
      let depth = 0;
      let end = start + "new Date(".length - 1;
      for (let i = end; i < line.length; i += 1) {
        if (line[i] === "(") depth += 1;
        else if (line[i] === ")") { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      const arg = line.slice(start, end + 1);
      if (!new RegExp(`\\b${column}\\b`).test(arg)) continue;
      // A pinned time is "T" followed by a digit (T00:00:00) or by a template expression
      // supplying one (T${shift.start_time}). Only the digit form was accepted at first, which
      // flagged two correct call sites.
      if (/T(\d|\$\{)/.test(arg)) continue;
      hits.push(column);
    }
  }
  return hits;
}

if (process.argv.includes("--self-test")) {
  let failures = 0;
  const fail = (message) => { process.stderr.write(`self-test failed: ${message}\n`); failures += 1; };

  const derived = deriveDateColumns([
    "create table foo (\n  id uuid,\n  effective_date date not null,\n  created_at timestamptz\n);",
    "alter table foo add column if not exists inspection_date date;",
    "create function f(p_due_date date) returns void as $$ declare v_today date := now(); begin end; $$;",
  ]);
  for (const expected of ["effective_date", "inspection_date"]) {
    if (!derived.includes(expected)) fail(`derivation missed \`${expected}\` (got ${derived.join(", ")})`);
  }
  for (const rejected of ["created_at", "p_due_date", "v_today", "id"]) {
    if (derived.includes(rejected)) fail(`derivation wrongly included \`${rejected}\``);
  }

  const cases = [
    ["const d = new Date(row.due_date);", ["due_date"]],
    ["const d = new Date(`${row.due_date}T00:00:00`);", []],
    ["const d = new Date(`${offer.shift_date}T${offer.start_time}`);", []],
    ["const d = new Date(String(offer.shift_date));", ["shift_date"]],
    ["const d = new Date(row.created_at);", []],
  ];
  for (const [line, expected] of cases) {
    const actual = offendingColumns(line, ["due_date", "shift_date"]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`${line} -> [${actual}], expected [${expected}]`);
    }
  }

  if (failures) throw new Error(`Date-only parsing self-test failed (${failures} case(s)).`);
  process.stdout.write(`Date-only parsing self-test passed (${derived.length + cases.length} cases).\n`);
  process.exit(0);
}

const DATE_COLUMNS = deriveDateColumns(readMigrations());

if (DATE_COLUMNS.length < MINIMUM_EXPECTED_COLUMNS) {
  console.error(
    `Date-only parsing check aborted: derived only ${DATE_COLUMNS.length} DATE column(s) from `
    + `supabase/migrations, below the ${MINIMUM_EXPECTED_COLUMNS} expected. The declaration parser `
    + `has probably stopped matching. Fix it rather than lowering the floor -- passing on an empty `
    + `column list would make this check silently vacuous.`,
  );
  process.exit(1);
}

const problems = [];
for (const file of walk(SRC)) {
  const rel = relative(join(ROOT, "artifacts/caremetric-carebase"), file);
  if (SORT_ONLY_ALLOWLIST.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, index) => {
    for (const column of offendingColumns(line, DATE_COLUMNS)) {
      if (TYPE_COLLISION_ALLOWLIST.get(rel)?.has(column)) continue;
      problems.push(
        `${rel}:${index + 1} parses the DATE column \`${column}\` as an instant. Append an `
        + `explicit local time, e.g. new Date(\`\${row.${column}}T00:00:00\`).`,
      );
    }
  });
}

if (problems.length > 0) {
  console.error(`Date-only parsing check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const collisions = [...TYPE_COLLISION_ALLOWLIST.values()].reduce((n, m) => n + m.size, 0);
console.log(
  `Date-only parsing check passed (${DATE_COLUMNS.length} DATE columns derived from migrations, `
  + `${SORT_ONLY_ALLOWLIST.size} sort-only file(s) allowlisted, `
  + `${collisions} name collision(s) with a timestamptz column).`,
);
