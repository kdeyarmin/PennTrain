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

export function isCallSite(line, name) {
  return new RegExp(`\\b${name}\\b`).test(line) && !DECLARATIVE.test(line);
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

const migrationNames = (await readdir(MIGRATIONS)).filter((n) => n.endsWith(".sql")).sort();
const granted = new Set();
const dropped = new Set();
const migrationLines = [];
for (const name of migrationNames) {
  const sql = await readFile(path.join(MIGRATIONS, name), "utf8");
  for (const fn of grantedToAuthenticated(sql)) granted.add(fn);
  for (const fn of droppedFunctions(sql)) dropped.add(fn);
  migrationLines.push(...sql.split("\n"));
}
for (const fn of dropped) granted.delete(fn);

const clientFiles = await walk(
  CLIENT_SRC,
  (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("database.types.ts") && !/\.test\.(ts|tsx)$/.test(f),
);
const edgeFiles = await walk(EDGE_FUNCTIONS, (f) => /\.(ts|js)$/.test(f));
const callerText = (await Promise.all([...clientFiles, ...edgeFiles].map((f) => readFile(f, "utf8")))).join("\n");

let allowlist = {};
try {
  allowlist = JSON.parse(await readFile(ALLOWLIST, "utf8"));
} catch {
  // An absent allowlist means nothing is excused, which is the correct default.
}

const findings = [];
for (const fn of [...granted].sort()) {
  if (new RegExp(`\\b${fn}\\b`).test(callerText)) continue;
  if (migrationLines.some((line) => isCallSite(line, fn))) continue;
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
    `${dropped.size} later dropped and excluded, ${Object.keys(allowlist).length} allowlisted).\n`,
);
