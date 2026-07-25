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

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
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
