import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// plpgsql RAISE with a `%` placeholder and no matching argument fails at CREATE FUNCTION time with
// "too few parameters specified for RAISE" (42601). It is invisible to every static check in this
// repo and only surfaces when a database actually applies the migration -- which, for anyone without
// a local Supabase stack, means a full CI round trip. This catches it in seconds instead.
//
// Only migrations newer than the baseline are scanned, matching check-migration-policies.mjs, so
// adopting this does not require rewriting history.
const BASELINE_VERSION = 20260720205629;
const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Strip SQL comments WITHOUT stripping the inside of string literals.
 *
 * The regex this replaced matched `--` to end-of-line anywhere at all, so it could not tell a
 * comment from an em-dash inside a message -- and this codebase writes messages like 'This course
 * has not been started yet -- open it and work through at least one lesson before marking it
 * complete.' Everything from the em-dash onwards was deleted, which left an unterminated quote; the
 * scanner then ran on to the NEXT quote in the file and read
 * `using errcode = 'check_violation'` as a RAISE argument, reporting "0 placeholder(s) but 1
 * argument(s)" for three statements that have been correct since the day they were written.
 *
 * It stayed hidden because only migrations newer than the baseline are scanned, and until now no
 * post-baseline migration happened to put `--` inside a RAISE message. That is the same shape as the
 * other near-misses in this program: a check that could not see the case it was wrong about.
 */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const pair = sql.slice(i, i + 2);
    if (pair === "--") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (pair === "/*") {
      // Postgres block comments nest, so count depth rather than scanning to the first `*/`.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth += 1; i += 2; }
        else if (sql.slice(i, i + 2) === "*/") { depth -= 1; i += 2; }
        else i += 1;
      }
      out += " ";
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      out += quote;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { out += quote + quote; i += 2; continue; } // '' escape
          out += quote;
          i += 1;
          break;
        }
        out += sql[i];
        i += 1;
      }
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Count `%` placeholders, ignoring the `%%` escape. */
export function countPlaceholders(format) {
  return (format.match(/(?<!%)%(?!%)/g) ?? []).length;
}

/**
 * Split a RAISE argument list on top-level commas only, so a comma inside a function call or a
 * quoted string does not inflate the count.
 */
export function countArguments(argumentText) {
  const trimmed = argumentText.trim().replace(/^,/, "").trim();
  if (!trimmed) return 0;
  let depth = 0;
  let inString = false;
  let count = 1;
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (inString) {
      if (char === "'") inString = trimmed[i + 1] === "'" ? (i += 1, true) : false;
      continue;
    }
    if (char === "'") inString = true;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) count += 1;
  }
  return count;
}

export function findRaiseArityProblems(sql) {
  const cleaned = stripSqlComments(sql);
  const problems = [];
  const pattern = /raise\s+(?:exception|warning|notice|info|log|debug)\s+('(?:[^']|'')*')([\s\S]*?)(?:\busing\b|;)/gi;
  let match;
  while ((match = pattern.exec(cleaned)) !== null) {
    const placeholders = countPlaceholders(match[1]);
    const args = countArguments(match[2]);
    if (placeholders !== args) {
      problems.push({ format: match[1], placeholders, args });
    }
  }
  return problems;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["raise exception 'plain';", 0],
    ["raise exception 'value %', v_x;", 0],
    ["raise exception 'value %' using errcode = '1';", 1],
    ["raise exception 'a % b %', v_x using errcode = '1';", 1],
    ["raise exception 'a % b %', v_x, v_y using errcode = '1';", 0],
    ["raise exception 'literal 100%% done';", 0],
    ["raise exception 'value %', coalesce(a, b) using errcode = '1';", 0],
    ["-- raise exception 'commented %';", 0],
    // The regression that motivated the string-aware scanner: an em-dash inside the message.
    //
    // Each of these is written with something QUOTED AFTER IT, and that is not decoration. The
    // obvious way to write the case --
    //     ["raise exception 'not started yet -- open it first.';", 0]
    // -- passes under the broken implementation too, so it guards nothing: truncating at `--` left
    // an unterminated quote, the format regex requires a closing quote, so it simply matched nothing
    // and reported zero problems. The bug only shows itself when the runaway string has a later
    // quote to run into, which in a real migration it always does. Each of the three below was run
    // against the old implementation and fails there, so each one guards the fix.
    ["raise exception 'not started yet -- open it first.'\n  using errcode = 'check_violation';", 0],
    ["raise exception 'needs % of % -- wait.', v_a, v_b;\nraise exception 'next';", 0],
    ["raise exception 'the resident''s file -- see notes';\nraise exception 'next';", 0],
    // A genuine mismatch beside an em-dash must still be REPORTED -- the fix must not buy silence by
    // making the scanner blind. This one passes under both implementations, by coincidence rather
    // than by design, so it is a correctness case and not a regression guard.
    ["raise exception 'a -- b';\nraise exception 'c %' using errcode = '1';", 1],
    // A real comment on the line AFTER a string must still be stripped.
    ["raise exception 'fine'; -- raise exception 'commented %';", 0],
    // Block comments still nest.
    ["/* outer /* inner */ still comment */ raise exception 'plain';", 0],
  ];
  let failures = 0;
  for (const [sql, expected] of cases) {
    const actual = findRaiseArityProblems(sql).length;
    if (actual !== expected) {
      failures += 1;
      process.stderr.write(`self-test failed: ${sql} -> ${actual}, expected ${expected}\n`);
    }
  }
  if (failures) throw new Error(`RAISE arity self-test failed (${failures} case(s)).`);
  process.stdout.write(`RAISE arity self-test passed (${cases.length} cases).\n`);
  process.exit(0);
}

const entries = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
const findings = [];
let scanned = 0;
for (const name of entries) {
  const version = Number(name.split("_")[0]);
  if (!Number.isFinite(version) || version <= BASELINE_VERSION) continue;
  scanned += 1;
  const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
  for (const problem of findRaiseArityProblems(sql)) {
    findings.push(`${name}: ${problem.placeholders} placeholder(s) but ${problem.args} argument(s) -- ${problem.format}`);
  }
}

if (findings.length) {
  throw new Error(`RAISE placeholder/argument mismatch:\n${findings.join("\n")}`);
}
process.stdout.write(`RAISE arity check passed (${scanned} migration(s) newer than baseline ${BASELINE_VERSION}).\n`);
