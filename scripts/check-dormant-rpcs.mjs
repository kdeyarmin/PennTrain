import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// Dormant-RPC check.
//
// This codebase repeatedly shipped the same shape: a table, an RPC over it, an RLS policy, grants --
// and no caller anywhere. Not a stub, not a TODO. Complete, careful, reviewed server work that no
// button, screen or job could reach, so the capability did not exist in the product. BACKLOG.md
// rows G1 through G11 are the audit of that: 21 capabilities closed, including a hospital return
// with no write path, certification attempts with no way to start one, a work queue that could only
// fill itself, and a DME inspection count that could only ever rise because the only writer of the
// history it counts had no caller.
//
// The sweep that found them ran by hand. This is that sweep as a gate, so the count stays at zero
// instead of drifting back one merge at a time.
//
//   A function granted EXECUTE to `authenticated` must be reachable by something: client source,
//   an edge function, or other SQL (another function's body, a trigger, an RLS policy, a cron
//   schedule). Reachable only from pgTAP does not count -- that is dead in production, and is
//   precisely the shape every one of those rows had.
//
// Two mistakes the hand-run version made, both fixed here and both worth knowing about if this is
// ever extended:
//
//   * It read `create or replace function` and `grant execute` out of migration text and never
//     looked for `drop function`, so it reported `unassign_organization_release_cohort` as a
//     finding six days after a reviewed migration deliberately removed it. Migrations apply in
//     filename order; the last statement mentioning a function is the one that counts.
//   * Its authorization-marker pattern was `assert_[a-z_]+`, which cannot match
//     `assert_phase3_admin` because the digit breaks the character class. That was a different
//     sweep, but the lesson is the same: a regex over SQL is a blunt instrument, and a finding is a
//     thing to check rather than a thing to believe.
//
// Legitimately-dormant functions belong in dormant-rpc-allowlist.json with a reason, in the same
// change set that makes them dormant. "It will have a caller soon" is not a reason; land the caller.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const CLIENT_SRC = path.join(ROOT, "artifacts", "caremetric-carebase", "src");
const EDGE_FUNCTIONS = path.join(ROOT, "supabase", "functions");
const ALLOWLIST = path.join(ROOT, "scripts", "dormant-rpc-allowlist.json");

/** Functions a migration grants EXECUTE to `authenticated`. One statement may name several. */
export function grantedToAuthenticated(sql) {
  const granted = new Set();
  for (const block of sql.matchAll(/grant\s+execute\s+on\s+function\s+([\s\S]*?)\s+to\s+([a-z_,\s]+);/gi)) {
    if (!/\bauthenticated\b/.test(block[2])) continue;
    for (const name of block[1].matchAll(/public\.([a-z0-9_]+)\s*\(/gi)) granted.add(name[1]);
  }
  return granted;
}

/** Functions a migration drops and does not re-create later in the same file. */
export function droppedFunctions(sql) {
  const dropped = new Set();
  for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)/gi)) {
    dropped.add(m[1]);
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)/gi)) {
    dropped.delete(m[1]);
  }
  return dropped;
}

/** Lines that only declare, grant, revoke or comment on a function are not call sites. */
const DECLARATIVE =
  /(create\s+(or\s+replace\s+)?function|grant\s+execute|revoke\s+all|comment\s+on\s+function|drop\s+function|has_function|alter\s+function)/i;

/**
 * SQL with its comments removed.
 *
 * Prose is not a caller, and this gate treated it as one. A migration whose header explained why a
 * function was being removed -- naming it, as a good comment does -- made that function look
 * reachable, so the check silently stopped applying to it. That is how
 * `unassign_organization_release_cohort` passed while having no caller at all.
 *
 * Block comments are stripped from the whole file before it is split into lines, because they span
 * lines and a line-at-a-time reader cannot see that it is inside one. A `--` inside a string literal
 * would be stripped too; no migration here does that, and the failure mode is a missed finding
 * rather than a false one.
 */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Blank single-quoted string literals, preserving length so nothing else shifts.
 *
 * A function name inside a quoted string is never a call, and one of them was excusing a genuinely
 * dormant function from this check:
 *
 *     raise exception 'certificates are not directly writable by clients; use issue_certificate()'
 *
 * `issue_certificate` had exactly that one "call site" in the whole repository -- inside its own
 * error message -- so the gate reported it as reached. This is the same mistake as counting a
 * comment as a caller, in a different quoting style, and it is the FOURTH way this script has read
 * SQL wrongly. Dollar-quoted bodies ($$...$$) are deliberately untouched: that is where real calls
 * live, and a single quote inside a body is still a string.
 */
export function blankSqlStrings(sql) {
  const out = sql.split("");
  let i = 0;
  while (i < sql.length) {
    // Skip over a dollar-quoted body wholesale; its contents are code, and its own single-quoted
    // strings are blanked by the ordinary scan once we are inside it.
    if (sql[i] !== "'") { i += 1; continue; }
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === "'") {
        // '' is an escaped quote inside the literal, not the end of it.
        if (sql[j + 1] === "'") { j += 2; continue; }
        break;
      }
      j += 1;
    }
    for (let k = i + 1; k < Math.min(j, sql.length); k += 1) if (out[k] !== "\n") out[k] = " ";
    i = j + 1;
  }
  return out.join("");
}

/**
 * Blank TypeScript COMMENTS, preserving length. An RPC named in prose is not a caller.
 *
 * Comments only -- deliberately not string literals, unlike the SQL side. In SQL a function name in
 * a string is always prose; in TypeScript it is the opposite, because every real call goes through
 * `supabase.rpc("name")` and the name IS a string literal. Blanking strings here would blank every
 * genuine call site in the codebase and report the entire schema as dormant.
 */
export function blankTsNonCode(source) {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    let end;
    if (two === "//") end = source.indexOf("\n", i) === -1 ? source.length : source.indexOf("\n", i);
    else if (two === "/*") end = source.indexOf("*/", i + 2) === -1 ? source.length : source.indexOf("*/", i + 2) + 2;
    else { i += 1; continue; }
    for (let k = i; k < end; k += 1) if (out[k] !== "\n") out[k] = " ";
    i = end;
  }
  return out.join("");
}

export function isCallSite(line, name) {
  const code = blankSqlStrings(stripSqlComments(line));
  return new RegExp(`\\b${name}\\b`).test(code) && !DECLARATIVE.test(code);
}

/**
 * The parts of a migration where a call to another function could actually appear.
 *
 * SQL is a statement language and this check read it a line at a time, which was wrong in a way
 * that mattered. A grant naming several functions puts one per line:
 *
 *     grant execute on function public.set_release_flag(text, ...),
 *       public.assign_organization_release_cohort(uuid, ...)
 *       to authenticated;
 *
 * Only the first line carries the words `grant execute`, so every function after it looked like a
 * bare call and was excused from the check. `assign_organization_release_cohort` has no caller
 * anywhere and this is why nothing said so.
 *
 * So: drop whole grant/revoke/comment/drop/alter statements, which never contain a call. Do NOT
 * drop `create function` statements -- their bodies are where most real calls live -- but do drop
 * the header up to the body delimiter, so a function is not treated as calling itself.
 *
 * Splitting on `;` would cut function bodies apart, so statements are matched to their terminator
 * non-greedily and only for the forms that cannot contain one.
 */
export function sqlCallSiteText(sql) {
  return blankSqlStrings(stripSqlComments(sql))
    // Statements that can never contain a call, removed entirely.
    .replace(/\b(grant|revoke)\b[\s\S]*?;/gi, " ")
    .replace(/\bcomment\s+on\s+function\b[\s\S]*?;/gi, " ")
    .replace(/\bdrop\s+function\b[\s\S]*?;/gi, " ")
    .replace(/\balter\s+function\b[\s\S]*?;/gi, " ")
    // A function's own signature is not a call to itself; its body is kept.
    .replace(/\bcreate\s+(or\s+replace\s+)?function\b[\s\S]*?\bas\s+\$[a-z_]*\$/gi, " ");
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [() => [...grantedToAuthenticated("grant execute on function public.foo(uuid) to authenticated;")], ["foo"]],
    [() => [...grantedToAuthenticated("grant execute on function public.a(uuid),\n public.b(text) to authenticated, service_role;")], ["a", "b"]],
    // Granted only to service_role is not a user-reachable RPC and is not this check's business.
    [() => [...grantedToAuthenticated("grant execute on function public.only_svc(uuid) to service_role;")], []],
    [() => [...droppedFunctions("drop function if exists public.gone(uuid, text);")], ["gone"]],
    // A drop followed by a re-create in the same migration is a redefinition, not a removal.
    [() => [...droppedFunctions("drop function public.x(uuid);\ncreate or replace function public.x(uuid, text) returns void")], []],
    [() => isCallSite("  perform public.foo(v_id);", "foo"), true],
    [() => isCallSite("grant execute on function public.foo(uuid) to authenticated;", "foo"), false],
    [() => isCallSite("create or replace function public.foo(uuid)", "foo"), false],
    [() => isCallSite("select has_function('public','foo',array['uuid'],'exists');", "foo"), false],
    // Prose is not a caller. A migration header explaining why `foo` was removed named `foo`, and
    // that alone used to excuse it from the check.
    [() => isCallSite("-- Console, and dropped `foo` as console-only with no other caller.", "foo"), false],
    [() => isCallSite("  perform public.foo(v_id); -- unrelated note", "foo"), true],
    [() => stripSqlComments("select 1; /* foo\n bar */ select 2;").includes("foo"), false],
    // A multi-function grant puts one function per line, and only the first line carries the
    // keywords. Every later one used to read as a bare call and be excused from the check.
    [() => sqlCallSiteText(
      "grant execute on function public.a(uuid),\n  public.dormant_one(uuid)\n  to authenticated;",
    ).includes("dormant_one"), false],
    // A function name inside a quoted SQL string is prose, not a call. `issue_certificate` had
    // exactly one "call site" in the repository -- its own error message -- and this is the fourth
    // way this script has read SQL wrongly.
    [() => sqlCallSiteText("do $$ begin raise exception 'use issue_certificate()'; end $$;").includes("issue_certificate"), false],
    [() => sqlCallSiteText("do $$ begin perform public.real_call(v); end $$;").includes("real_call"), true],
    // '' is an escaped quote inside a literal, not the end of it.
    [() => blankSqlStrings("select 'it''s issue_certificate', real_call;").includes("real_call"), true],
    [() => blankSqlStrings("select 'it''s issue_certificate', real_call;").includes("issue_certificate"), false],
    // TypeScript: comments are prose, string literals are call sites.
    [() => blankTsNonCode("// calls issue_certificate directly\n").includes("issue_certificate"), false],
    [() => blankTsNonCode("/* see issue_certificate */").includes("issue_certificate"), false],
    [() => blankTsNonCode('supabase.rpc("issue_certificate", {});').includes("issue_certificate"), true],
    [() => sqlCallSiteText(
      "revoke all on function public.a(uuid),\n  public.dormant_two(uuid)\n  from public, anon;",
    ).includes("dormant_two"), false],
    // A function body IS a call site, and must survive the header being stripped.
    [() => sqlCallSiteText(
      "create or replace function public.outer(uuid) returns void language plpgsql as $$\n" +
      "begin perform public.inner_fn(1); end $$;",
    ).includes("inner_fn"), true],
    // ...and the function does not count as calling itself.
    [() => sqlCallSiteText(
      "create or replace function public.selfie(uuid) returns void language plpgsql as $$\nbegin end $$;",
    ).includes("selfie"), false],
    // Cross-migration drop-then-restore. Applying drops as each migration is read has to leave a
    // later re-grant standing; collecting every drop and subtracting at the end does not, and that
    // is what previously hid `unassign_organization_release_cohort` from the check entirely.
    [() => {
      const migrations = [
        "grant execute on function public.later_restored(uuid) to authenticated;",
        "drop function if exists public.later_restored(uuid);",
        "create or replace function public.later_restored(uuid, text) returns void as $$ $$;\n" +
          "grant execute on function public.later_restored(uuid, text) to authenticated;",
      ];
      const live = new Set();
      for (const sql of migrations) {
        for (const fn of droppedFunctions(sql)) live.delete(fn);
        for (const fn of grantedToAuthenticated(sql)) live.add(fn);
      }
      return [...live];
    }, ["later_restored"]],
    // ...and a drop that is never undone still removes the function.
    [() => {
      const live = new Set();
      for (const sql of [
        "grant execute on function public.gone_for_good(uuid) to authenticated;",
        "drop function if exists public.gone_for_good(uuid);",
      ]) {
        for (const fn of droppedFunctions(sql)) live.delete(fn);
        for (const fn of grantedToAuthenticated(sql)) live.add(fn);
      }
      return [...live];
    }, []],
  ];
  let failures = 0;
  for (const [run, expected] of cases) {
    const actual = run();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures += 1;
      process.stderr.write(`self-test failed: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}\n`);
    }
  }
  if (failures) throw new Error(`Dormant-RPC self-test failed (${failures} case(s)).`);
  process.stdout.write(`Dormant-RPC self-test passed (${cases.length} cases).\n`);
  process.exit(0);
}

async function walk(dir, filter, out = []) {
  let entries;
  try { entries = await readdir(dir); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) await walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

// Migrations apply in filename order, so the LAST statement about a function is the one that counts
// -- and that has to be decided per migration, as they are read. An earlier version accumulated every
// drop across the whole scan and subtracted the lot at the end, which quietly reversed the answer for
// any function dropped once and re-created later: `unassign_organization_release_cohort` is dropped by
// 20260802030000 and restored by 20260804160000, and the end-of-scan subtraction removed it from the
// check even though it is granted and live. A gate that silently stops checking a function is worse
// than no gate, because the zero it reports is trusted.
const migrationNames = (await readdir(MIGRATIONS)).filter((n) => n.endsWith(".sql")).sort();
const granted = new Set();
let dropCount = 0;
const migrationCallSites = [];
for (const name of migrationNames) {
  const sql = await readFile(path.join(MIGRATIONS, name), "utf8");
  // Drops first, then grants: `droppedFunctions` already discounts a drop that the same file
  // re-creates, so a migration that replaces a function ends with it granted, as it should.
  for (const fn of droppedFunctions(sql)) {
    if (granted.delete(fn)) dropCount += 1;
  }
  for (const fn of grantedToAuthenticated(sql)) granted.add(fn);
  migrationCallSites.push(sqlCallSiteText(sql));
}

const clientFiles = await walk(
  CLIENT_SRC,
  (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("database.types.ts") && !/\.test\.(ts|tsx)$/.test(f),
);
const edgeFiles = await walk(EDGE_FUNCTIONS, (f) => /\.(ts|js)$/.test(f));
// Comments and string literals are blanked here for the same reason they are in the SQL scan: a
// function named in prose is not a caller. This bit the check within minutes of the SQL fix landing
// -- the note explaining why `useIssueCertificate` had been deleted mentioned the RPC by name, and
// that comment alone made the newly-dormant function look reached.
const callerText = (await Promise.all(
  [...clientFiles, ...edgeFiles].map(async (f) => blankTsNonCode(await readFile(f, "utf8"))),
)).join("\n");

let allowlist = {};
try {
  const parsed = JSON.parse(await readFile(ALLOWLIST, "utf8"));
  // `_`-prefixed keys are prose for whoever opens the file next, not function names.
  allowlist = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith("_")));
} catch {
  // An absent allowlist means nothing is excused, which is the correct default.
}

const findings = [];
for (const fn of [...granted].sort()) {
  if (new RegExp(`\\b${fn}\\b`).test(callerText)) continue;
  if (migrationCallSites.some((text) => new RegExp(`\\b${fn}\\b`).test(text))) continue;
  if (allowlist[fn]) continue;
  findings.push(fn);
}

if (findings.length) {
  const detail = findings.map((fn) => `  ${fn}`).join("\n");
  throw new Error(
    `${findings.length} RPC(s) granted to authenticated with no caller anywhere -- no client, no edge function, no other SQL:\n${detail}\n\n` +
      "Wire a caller, or record the function in scripts/dormant-rpc-allowlist.json with the reason it is\n" +
      "legitimately unreachable. See BACKLOG.md G1-G11 for what this shape has cost before.",
  );
}
process.stdout.write(
  `Dormant-RPC check passed (${granted.size} function(s) granted to authenticated, ` +
    `${dropCount} dropped and excluded, ${Object.keys(allowlist).length} allowlisted).\n`,
);
