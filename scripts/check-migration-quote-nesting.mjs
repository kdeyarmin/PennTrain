import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Roughly thirty migrations on top of the 20260720 baseline patch an existing function in place
// with the same idiom: read `pg_get_functiondef(...)` into `v_def`, build the replacement as a
// single-quoted plpgsql string, `replace()` it in, and `execute` the result. That idiom nests
// quoting two levels deep and the compiler only sees the mistake at APPLY time, from a `do $do$`
// block, as a bare 42601 several hundred lines from the line that caused it. Anyone without a
// local stack -- and anyone WITH one that already has the migration applied, which is the more
// dangerous case -- finds out from a red CI job twenty minutes later.
//
// The two levels are:
//
//   1. `v_new := '...'` -- a plpgsql string literal, so every apostrophe inside it doubles.
//   2. The emitted text lands inside `AS $function$ ... $function$`, which pg_get_functiondef
//      always dollar-quotes. Inside a dollar-quoted body an apostrophe stands alone.
//
// So a string literal in the patched body is written `''active''` at level 1 -- two quotes -- and
// `''''active''''` is one doubling too many. It emits `''active''`: an empty string, a bare word,
// another empty string. `syntax error at or near "active"`.
//
// Four consecutive quotes are not wrong by themselves. `coalesce(p_token, '''')` is the correct
// way to write an empty string literal at level 1, and this repo has two of those. The signal that
// separates them is what sits next to the run: an empty literal is bounded by punctuation, while
// the doubling mistake wraps a word. So the rule is a run of exactly four quotes with a word
// character on the far side of it -- specific enough to have no allowlist, which is the point.
//
// If a future migration nests three levels deep (a body that pg_get_functiondef renders
// single-quoted, say), extend this file rather than starting another one: the invariant is about
// the depth of quoting, not about the number four.
const BASELINE_VERSION = 20260720205629;
const MIGRATIONS_DIR = "supabase/migrations";

// A run of exactly four quotes -- (?<!')…(?!') keeps six or eight out -- with a word character
// immediately before or after it.
const OVER_DOUBLED = /(?<!')''''(?=\w)|(?<=\w)''''(?!')/g;

export function findOverDoubledQuotes(sql) {
  const findings = [];
  const lines = sql.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    OVER_DOUBLED.lastIndex = 0;
    if (OVER_DOUBLED.test(lines[i])) {
      findings.push({ line: i + 1, text: lines[i].trim() });
    }
  }
  return findings;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    // The defect this exists for, in both the shapes it took.
    ["  where r.status = ''''active'''';", 1],
    ["  set status = ''''superseded'''', updated_at = now();", 1],
    // Correct at level 1: one doubling.
    ["  where r.status = ''active'';", 0],
    ["  set status = ''superseded'', updated_at = now();", 0],
    // Correct at level 1: an EMPTY string literal, which is genuinely four quotes. Both real
    // occurrences in this repo are of this shape, and neither may be flagged.
    ["  v_old := '  if length(coalesce(p_token, '''')) < 32 then';", 0],
    ["    v_scim_mapped_role := nullif(btrim(coalesce(v_mapping.app_role, '''')), '''');", 0],
    ["  select coalesce(x, '''') into v;", 0],
    // An empty literal next to a comma or a bracket is still an empty literal.
    ["  values ('''', 1);", 0],
    ["  concat('''', v_a);", 0],
    // Six and eight quotes are a different depth question and are deliberately not this rule's
    // business -- matching them here would report the same line twice on a three-level patch.
    ["  where r.status = ''''''active'''''';", 0],
    // An apostrophe inside a comment in the emitted body: one doubling, like everything else.
    ["  -- the old plan''s instructions", 0],
    ["  -- the old plan''''s instructions", 1],
    // Ordinary SQL outside any patch block is untouched.
    ["insert into t(name) values ('Ann''s room');", 0],
    ["comment on function f() is 'the resident''s file';", 0],
  ];
  let failures = 0;
  for (const [sql, expected] of cases) {
    const actual = findOverDoubledQuotes(sql).length;
    if (actual !== expected) {
      failures += 1;
      process.stderr.write(`self-test failed: ${sql} -> ${actual}, expected ${expected}\n`);
    }
  }
  if (failures) throw new Error(`Migration quote-nesting self-test failed (${failures} case(s)).`);
  process.stdout.write(`Migration quote-nesting self-test passed (${cases.length} cases).\n`);
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
  for (const problem of findOverDoubledQuotes(sql)) {
    findings.push(`${name}:${problem.line}: ${problem.text}`);
  }
}

if (findings.length) {
  throw new Error(
    "A quoted word is doubled twice inside a patched function body. The emitted body is "
      + "dollar-quoted, so one doubling is correct -- `''active''`, not `''''active''''`, which "
      + "emits an empty string, a bare word and another empty string (42601 at apply time):\n"
      + findings.join("\n"),
  );
}
process.stdout.write(
  `Migration quote-nesting check passed (${scanned} migration(s) newer than baseline ${BASELINE_VERSION}).\n`,
);
