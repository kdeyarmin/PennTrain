#!/usr/bin/env node
/**
 * A calendar date and an instant must not be mistaken for one another. Both directions.
 *
 * DATE-only columns must not be parsed as instants, and instants must not be sliced into dates.
 * The second half was added after a review found the mirror image of the first living three files
 * away; see "The other direction" below. One confusion, one gate.
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
 *
 * ---------------------------------------------------------------------------------------------
 * THE OTHER DIRECTION: an instant must not be sliced into a date.
 *
 * PostgREST serialises `timestamptz` in UTC, so `row.attested_at.slice(0, 10)` is the UTC calendar
 * date, not Pennsylvania's. Those agree for twenty hours a day and differ for four, which is the
 * worst shape a date bug can take -- it survives every spot check anyone makes during business
 * hours. `2026-01-02T01:00:00Z` is still January 1 in Pennsylvania.
 *
 * A review found it in `annualTrainingHours`, comparing a sliced `credited_at` against a training
 * year: a course finished on a Pennsylvania evening counted against the following year and went
 * missing from the one it was earned in. Reading the rest out found nine more (BACKLOG J83/J84),
 * including a plan written the evening a resident came back from hospital being judged as
 * predating the return, and an upload timestamp seeding a completion-date field with tomorrow.
 *
 * The fix is `facilityDateOf` in lib/dateUtils. It passes a bare `YYYY-MM-DD` through untouched,
 * which is what makes it safe at the call sites fed by a union of a date column and a timestamptz
 * -- converting a date column would walk it BACK a day, turning this check's own subject into its
 * own defect.
 *
 * Not everything that slices is wrong, and the exemptions below say which and why. UTC arithmetic
 * on a bare date string is correct and stays correct: it never asks what day it is now.
 *
 * WHAT THIS HALF DOES NOT CATCH, stated because a pass line that reads like full coverage is worse
 * than no line. It matches on the receiver's trailing identifier being a derived timestamptz column
 * name, so it sees `episode.return_time` and `doc.created_at` and does not see a computed field:
 * `signal.windowEnd`, `card.since`, `entry.at`, a bare `at` prop. Six of the ten sites the J84
 * sweep fixed were visible here; four were not, and were found by reading. That is the same limit
 * the DATE half has and the same trade-off -- a name-based scan over a schema-derived list catches
 * the shape a new query introduces, which is the one most likely to arrive without anyone thinking
 * about timezones at all. It is a floor under the reading, not a substitute for it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { stripSqlComments } from "./lib/sqlComments.mjs";

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
  // `foo date`, `foo date not null`, `foo date default ...` inside a create-table body, and
  // date-typed columns of a `returns table (...)`. A definition starts at a line start OR after
  // the `(` or `,` that opened it -- a line-start anchor alone missed real columns, because the
  // migrations write several definitions per line (`target_value numeric, start_date date not
  // null`) and entire CREATE TABLE bodies on one line (move_in_workspaces). Global, because one
  // such line declares many columns and a single exec would surface at most one.
  /(?:^|[(,])\s*([a-z_][a-z0-9_]*)\s+date\b/gm,
  // `alter table x add column [if not exists] foo date`
  /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+date\b/g,
];

/**
 * Migration SQL with comments, string literals and dollar-quoted bodies blanked, ready for
 * column derivation.
 *
 * All three are where "a date", "due date" and "training date" are English rather than a
 * declaration -- the help-article and course-catalog seeds alone would otherwise declare columns
 * named `a`, `due` and `training`, which are ordinary frontend identifiers, so over-inclusion
 * stops being safe the moment prose can reach the patterns. Every declaration form this check
 * derives from (create-table bodies, `add column`, `returns table (...)` lists) sits outside
 * dollar quotes; blanking them changes the derived set only by removing seed prose. The comment
 * stripper is the string-aware one shared by the other SQL lints, so a `--` inside a literal
 * never eats the closing quote. Dollar quotes go first, because an apostrophe inside a body
 * would otherwise open a "string" that swallows real SQL past the body's end.
 */
export function withoutSqlProse(sql) {
  return stripSqlComments(sql)
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

// plpgsql locals (`v_today date := ...`) and function parameters (`p_due_date date`) are not
// columns. They are declared with the same syntax, and this repo prefixes both by convention.
// `returns` is the RETURNS keyword of a function signature -- `returns date` and `returns timestamptz`
// both parse as a column declaration under these patterns. Harmless while over-inclusion is the rule,
// but it showed up as a phantom date/timestamptz name collision, which is noise in a number meant to
// be read.
const NOT_A_COLUMN = /^(v_|p_|returns$)/;

// A floor, not a target. Purely a tripwire for a silently-broken parser.
const MINIMUM_EXPECTED_COLUMNS = 60;

export function deriveDateColumns(sqlTexts) {
  const found = new Set();
  for (const text of sqlTexts) {
    for (const pattern of DECLARATION_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (!NOT_A_COLUMN.test(match[1])) found.add(match[1]);
      }
    }
  }
  return [...found].sort();
}

function readMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => withoutSqlProse(readFileSync(join(MIGRATIONS, f), "utf8")));
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
// refactoring. It is to state, per file and per column, that this particular call site is the
// timestamptz one. Anything not listed is still a failure.
//
// The entry records a JUDGEMENT ("this expression came from the timestamptz table"), never a schema
// fact. The schema fact -- that the name is declared both ways -- is derived from the migrations and
// re-checked on every run, because this file's whole argument against the old hand-written column
// list was that hand-maintained schema facts drift from the schema. An entry naming a column that is
// not actually ambiguous is a hard failure rather than a silent exemption, so if either side of the
// collision is ever retyped this stops being quietly true.
const TYPE_COLLISION_ALLOWLIST = new Map([
  [
    "src/pages/app/AdmissionOperations.tsx",
    new Map([["scheduled_for", "the activity trail reads admission_activities, not survey_rehearsals"]]),
  ],
]);

// Instant-to-date truncations that are CORRECT, each with the reason. Listed rather than
// pattern-matched, for the same reason SORT_ONLY_ALLOWLIST is: adding one should be a deliberate
// act by somebody who has thought about it.
//
// Both entries do UTC arithmetic on a bare `YYYY-MM-DD` that was already decided -- they build a
// Date at an explicit `T00:00:00Z`, shift it in UTC, and read the UTC date back. Nothing there ever
// asks what day it is now, which is the only question the timezone can change the answer to.
const UTC_DATE_ARITHMETIC_ALLOWLIST = new Map([
  ["src/lib/scheduleDates.ts", "isoDate/addDaysIso/startOfWeekIso shift an already-decided date string in UTC; todayIso uses facilityToday"],
  ["src/lib/calendarExport.ts", "addOneDay shifts an ICS date string built at T00:00:00Z"],
]);

// A floor for the timestamptz derivation, matching MINIMUM_EXPECTED_COLUMNS above. Without it a
// broken parser would derive nothing and the slicing scan would pass by finding no columns to
// look for -- exactly the vacuous pass the date-column floor exists to prevent.
const MINIMUM_EXPECTED_TIMESTAMPTZ_COLUMNS = 100;

// `foo timestamptz`, `foo timestamp with time zone`, and the `add column` form of each -- matched
// mid-line as well as at line start, for the same reason as DECLARATION_PATTERNS.
const TIMESTAMPTZ_PATTERNS = [
  /(?:^|[(,])\s*([a-z_][a-z0-9_]*)\s+timestamptz\b/gm,
  /(?:^|[(,])\s*([a-z_][a-z0-9_]*)\s+timestamp\s+with\s+time\s+zone\b/gm,
  /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+timestamptz\b/g,
  /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+timestamp\s+with\s+time\s+zone\b/g,
];

export function deriveTimestamptzColumns(sqlTexts) {
  const found = new Set();
  for (const text of sqlTexts) {
    for (const pattern of TIMESTAMPTZ_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (!NOT_A_COLUMN.test(match[1])) found.add(match[1]);
      }
    }
  }
  return [...found].sort();
}

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
/**
 * Offending call sites in `text`, as { column, index } where index is the offset of `new Date(`.
 *
 * Takes arbitrary text, not a line. The balanced-paren walk below never cared about newlines; only
 * the CALLER did, and scanning line by line meant a Prettier-wrapped call --
 *
 *     const d = new Date(
 *       row.effective_date,
 *     );
 *
 * -- was invisible: the line holding `new Date(` has no closing paren, so the walk fell through
 * with `arg` equal to just "new Date(", which contains no column name and was skipped. The check
 * reported a pass on a file it had not actually examined. Formatting is not something a
 * correctness gate may depend on.
 */
export function offendingCallSites(text, columns) {
  const hits = [];
  for (const column of columns) {
    // Parens are BALANCED rather than matched with [^)]*, because a wrapper like
    // String(offer.shift_date) closes early and truncates the argument -- the first version of
    // this check reported three false positives that way.
    for (const start of [...text.matchAll(/new Date\(/g)].map((m) => m.index)) {
      let depth = 0;
      let end = start + "new Date(".length - 1;
      for (let i = end; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      const arg = text.slice(start, end + 1);
      if (!new RegExp(`\\b${column}\\b`).test(arg)) continue;
      // A pinned time is "T" followed by a digit (T00:00:00) or by a template expression
      // supplying one (T${shift.start_time}). Only the digit form was accepted at first, which
      // flagged two correct call sites.
      if (/T(\d|\$\{)/.test(arg)) continue;
      hits.push({ column, index: start });
    }
  }
  return hits;
}

/** Column names only, for the self-test cases below. */
export function offendingColumns(text, columns) {
  return offendingCallSites(text, columns).map((hit) => hit.column);
}

// Every shape that turns a string or a Date into a ten-character calendar date. Written out
// rather than composed, because a backreference for the matching quote would renumber the moment
// this is concatenated after a capture group -- and a regex that quietly matches the wrong thing is
// how a gate stops gating.
//
// `foo.bar?.baz.slice(0, 10)`: the receiver is the identifier chain immediately before it.
const SLICED_RECEIVER =
  /([A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*)(?:\?\.|\.)(?:slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\(["']T["']\)\[\s*0\s*\])/g;

// `d.toISOString().slice(0, 10)`: no column name to match on, and wrong for the same reason
// whatever produced the Date. Exempt only via UTC_DATE_ARITHMETIC_ALLOWLIST.
const SLICED_ISO_STRING =
  /toISOString\(\)\s*(?:\?\.|\.)(?:slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\(["']T["']\)\[\s*0\s*\])/g;

/**
 * Instants truncated to a calendar date, as { what, index }.
 *
 * `columns` is the derived timestamptz set. A receiver is reported when its trailing identifier is
 * one of those names -- the same name-based reasoning the DATE half uses, with the same
 * over-inclusion trade-off: a local called `created_at` that never came from the database is worth
 * a second look anyway.
 */
export function slicedInstantSites(text, columns) {
  const names = columns instanceof Set ? columns : new Set(columns);
  const hits = [];
  SLICED_RECEIVER.lastIndex = 0;
  let match;
  while ((match = SLICED_RECEIVER.exec(text)) !== null) {
    const receiver = match[1];
    const trailing = receiver.split(/\?\.|\./).pop();
    if (!names.has(trailing)) continue;
    hits.push({ what: receiver, index: match.index });
  }
  SLICED_ISO_STRING.lastIndex = 0;
  while ((match = SLICED_ISO_STRING.exec(text)) !== null) {
    hits.push({ what: "toISOString()", index: match.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Receiver names only, for the self-test cases below. */
export function slicedInstants(text, columns) {
  return slicedInstantSites(text, columns).map((hit) => hit.what);
}

if (process.argv.includes("--self-test")) {
  let failures = 0;
  const fail = (message) => { process.stderr.write(`self-test failed: ${message}\n`); failures += 1; };

  const derived = deriveDateColumns([
    "create table foo (\n  id uuid,\n  effective_date date not null,\n  created_at timestamptz\n);",
    "alter table foo add column if not exists inspection_date date;",
    "create function f(p_due_date date) returns void as $$ declare v_today date := now(); begin end; $$;",
    // Shapes that exist verbatim in the migrations: several definitions per line (qapi_projects),
    // and a whole CREATE TABLE on one line (move_in_workspaces, confidential_incident_intakes).
    " target_value numeric, start_date date not null default current_date,",
    "create table public.m(id uuid,target_move_in_date date not null,retention_until date,noted_at timestamptz not null default now());",
  ]);
  for (const expected of ["effective_date", "inspection_date", "start_date", "target_move_in_date", "retention_until"]) {
    if (!derived.includes(expected)) fail(`derivation missed \`${expected}\` (got ${derived.join(", ")})`);
  }
  for (const rejected of ["created_at", "p_due_date", "v_today", "id", "target_value", "noted_at"]) {
    if (derived.includes(rejected)) fail(`derivation wrongly included \`${rejected}\``);
  }
  if (deriveDateColumns(["create function f() returns date as $$ begin end; $$;"]).includes("returns")) {
    fail("derivation treated the RETURNS keyword as a column");
  }

  // Prose is not a declaration. Comments, seed strings and dollar-quoted catalog blobs say
  // things like "a date", "hire date" and "training date", and mid-line matching would read
  // those as columns named `a`, `hire` and `training` -- ordinary frontend identifiers, so the
  // scan would flag calls that never touch the database.
  const prose = deriveDateColumns([withoutSqlProse(
    "-- named person, a date, and a source URL\n"
    + "select 'you''ll need their hire date and the due date' as answer;\n"
    + "do $catalog$ {\"content\":\"verify material date, training date, attendees\"} $catalog$;\n"
    + "create table p (\n  birth_date date\n);",
  )]);
  if (JSON.stringify(prose) !== JSON.stringify(["birth_date"])) {
    fail(`prose blanking derived [${prose}], expected [birth_date]`);
  }

  // The timestamptz side, which exists only to find names declared BOTH ways.
  const ts = deriveTimestamptzColumns([
    "create table foo (\n  started_at timestamptz not null,\n  ended_at timestamp with time zone,\n  due date\n);",
    "alter table foo add column if not exists closed_at timestamptz;",
    "create function f() returns timestamptz as $$ declare v_now timestamptz; begin end; $$;",
    "create table public.m(id uuid,noted_at timestamptz not null,retention_until date);",
  ]);
  for (const expected of ["started_at", "ended_at", "closed_at", "noted_at"]) {
    if (!ts.includes(expected)) fail(`timestamptz derivation missed \`${expected}\` (got ${ts.join(", ")})`);
  }
  for (const rejected of ["due", "v_now", "returns", "retention_until"]) {
    if (ts.includes(rejected)) fail(`timestamptz derivation wrongly included \`${rejected}\``);
  }

  // The collision set is the intersection, which is what a per-call-site entry is allowed to name.
  const sql = [
    "create table a (\n  scheduled_for timestamptz\n);",
    "create table b (\n  scheduled_for date,\n  only_a_date date\n);",
  ];
  const ambiguous = deriveTimestamptzColumns(sql).filter((n) => deriveDateColumns(sql).includes(n));
  if (JSON.stringify(ambiguous) !== JSON.stringify(["scheduled_for"])) {
    fail(`collision set was [${ambiguous}], expected [scheduled_for]`);
  }

  const cases = [
    ["const d = new Date(row.due_date);", ["due_date"]],
    ["const d = new Date(`${row.due_date}T00:00:00`);", []],
    ["const d = new Date(`${offer.shift_date}T${offer.start_time}`);", []],
    ["const d = new Date(String(offer.shift_date));", ["shift_date"]],
    ["const d = new Date(row.created_at);", []],
    // Prettier wraps a long call across lines. Scanning line by line never saw this one.
    ["const d = new Date(\n  row.due_date,\n);", ["due_date"]],
    ["const d = new Date(\n  `${row.due_date}T00:00:00`,\n);", []],
  ];
  for (const [line, expected] of cases) {
    const actual = offendingColumns(line, ["due_date", "shift_date"]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`${line} -> [${actual}], expected [${expected}]`);
    }
  }

  // The slicing half. `columns` here stands in for the derived timestamptz set.
  const tsCols = ["created_at", "attested_at", "return_time", "submitted_at"];
  const sliceCases = [
    // The defect, in each shape that expresses it.
    ["doc.created_at.slice(0, 10)", ["doc.created_at"]],
    ["a.attested_at?.slice(0, 10)", ["a.attested_at"]],
    ["x.return_time.substring(0, 10)", ["x.return_time"]],
    ['e.submitted_at.split("T")[0]', ["e.submitted_at"]],
    ["d.toISOString().slice(0, 10)", ["toISOString()"]],
    // A DATE column sliced is a no-op, not a defect -- and flagging it would push somebody toward
    // a conversion that walks the value back a day.
    ["row.effective_date.slice(0, 10)", []],
    // Not every ten-character slice is a date. This one is a hash prefix.
    ["item.payload_sha256.slice(0, 10)", []],
    // The fix must not report itself.
    ["formatDateForDisplay(facilityDateOf(a.attested_at))", []],
    // A different width is a different operation.
    ["doc.created_at.slice(0, 7)", []],
  ];
  for (const [source, expected] of sliceCases) {
    const actual = slicedInstants(source, tsCols);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`${source} -> [${actual}], expected [${expected}]`);
    }
  }

  if (failures) throw new Error(`Date-only parsing self-test failed (${failures} case(s)).`);
  process.stdout.write(
    `Date-only parsing self-test passed (${derived.length + ts.length + cases.length + sliceCases.length + 3} cases).\n`,
  );
  process.exit(0);
}

const MIGRATION_TEXTS = readMigrations();
const DATE_COLUMNS = deriveDateColumns(MIGRATION_TEXTS);
const AMBIGUOUS_COLUMNS = new Set(
  deriveTimestamptzColumns(MIGRATION_TEXTS).filter((name) => DATE_COLUMNS.includes(name)),
);

// A collision entry is only meaningful while the collision exists. If either side is retyped the
// entry becomes an exemption nobody has reviewed, so it fails loudly instead.
const staleCollisions = [];
for (const [file, columns] of TYPE_COLLISION_ALLOWLIST) {
  for (const column of columns.keys()) {
    if (!AMBIGUOUS_COLUMNS.has(column)) {
      staleCollisions.push(
        `${file}: \`${column}\` is listed as a date/timestamptz name collision, and the migrations no `
        + `longer declare it both ways. Remove the entry -- and if it is now a DATE everywhere, check `
        + `that call site, because it stopped being exempt for a reason.`,
      );
    }
  }
}
if (staleCollisions.length > 0) {
  console.error(`Date-only parsing check failed (${staleCollisions.length} stale collision entr(ies)):\n`);
  for (const problem of staleCollisions) console.error(`  ${problem}`);
  process.exit(1);
}

const TIMESTAMPTZ_COLUMNS = new Set(deriveTimestamptzColumns(MIGRATION_TEXTS));
if (TIMESTAMPTZ_COLUMNS.size < MINIMUM_EXPECTED_TIMESTAMPTZ_COLUMNS) {
  console.error(
    `Date-only parsing check aborted: derived only ${TIMESTAMPTZ_COLUMNS.size} timestamptz column(s) `
    + `from supabase/migrations, below the ${MINIMUM_EXPECTED_TIMESTAMPTZ_COLUMNS} expected. The `
    + `slicing half of this check would pass by having nothing to look for.`,
  );
  process.exit(1);
}

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
  // The WHOLE file, not line by line -- see offendingCallSites. Line numbers are derived from the
  // match offset so the message is unchanged.
  for (const { column, index } of offendingCallSites(text, DATE_COLUMNS)) {
    if (TYPE_COLLISION_ALLOWLIST.get(rel)?.has(column)) continue;
    const line = text.slice(0, index).split("\n").length;
    problems.push(
      `${rel}:${line} parses the DATE column \`${column}\` as an instant. Append an `
      + `explicit local time, e.g. new Date(\`\${row.${column}}T00:00:00\`).`,
    );
  }
  if (UTC_DATE_ARITHMETIC_ALLOWLIST.has(rel)) continue;
  for (const { what, index } of slicedInstantSites(text, TIMESTAMPTZ_COLUMNS)) {
    const line = text.slice(0, index).split("\n").length;
    problems.push(
      `${rel}:${line} truncates the instant \`${what}\` to a calendar date by slicing, which takes `
      + `the UTC day rather than the facility's -- they differ after 20:00 ET. Use `
      + `facilityDateOf(${what}) from lib/dateUtils; it passes a bare YYYY-MM-DD through unchanged, `
      + `so it is safe on a field that may hold either.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`Date-only parsing check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const collisions = [...TYPE_COLLISION_ALLOWLIST.values()].reduce((n, m) => n + m.size, 0);
console.log(
  `Date-only parsing check passed (${DATE_COLUMNS.length} DATE and ${TIMESTAMPTZ_COLUMNS.size} `
  + `timestamptz columns derived from migrations, ${SORT_ONLY_ALLOWLIST.size} sort-only and `
  + `${UTC_DATE_ARITHMETIC_ALLOWLIST.size} UTC-arithmetic file(s) allowlisted, `
  + `${collisions} of ${AMBIGUOUS_COLUMNS.size} date/timestamptz name collision(s) adjudicated).`,
);
