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
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../artifacts/caremetric-carebase/src");
const ROOT = resolve(HERE, "..");

// Column names whose Postgres type is `date`. Kept as a list because the check runs without a
// database; regenerate with:
//   select distinct column_name from information_schema.columns
//   where table_schema='public' and data_type='date';
const DATE_COLUMNS = [
  "effective_date", "review_due_date", "due_date", "admission_date", "discharge_date",
  "completed_date", "expires_on", "review_date", "participation_date", "prepared_date",
  "inquiry_date", "expected_move_in_date", "target_move_in_date", "target_go_live_date",
  "provisional_start_date", "start_date", "shift_date", "week_started_on", "started_on",
  "effective_from", "effective_to", "period_start", "period_end", "hire_date", "birth_date",
];

// Uses where a uniform offset cannot change the outcome, each with the reason it is safe.
const SORT_ONLY_ALLOWLIST = new Set([
  "src/pages/employee/MyCourses.tsx",   // due_date used only to order the assignment list
  "src/pages/employee/MyTrainings.tsx", // same
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

const problems = [];
for (const file of walk(SRC)) {
  const rel = relative(join(ROOT, "artifacts/caremetric-carebase"), file);
  if (SORT_ONLY_ALLOWLIST.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, index) => {
    for (const column of DATE_COLUMNS) {
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
        problems.push(
          `${rel}:${index + 1} parses the DATE column \`${column}\` as an instant. Append an `
          + `explicit local time, e.g. new Date(\`\${row.${column}}T00:00:00\`).`,
        );
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`Date-only parsing check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `Date-only parsing check passed (${DATE_COLUMNS.length} DATE columns, `
  + `${SORT_ONLY_ALLOWLIST.size} sort-only file(s) allowlisted).`,
);
