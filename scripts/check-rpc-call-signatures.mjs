import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { stripSqlComments } from "./lib/sqlComments.mjs";

// RPC call-signature check.
//
// 131 of this repository's `supabase.rpc(...)` call sites are written as
// `rpc("name" as never, { ... } as never)`. Every one of those names is present in the generated
// `database.types.ts`, so the cast is not load-bearing -- it is left over from code written before
// the types were regenerated. What it costs is the checking: inside `as never`, a misspelt function
// name or a misspelt parameter is invisible to typecheck and to every unit test, and surfaces as a
// PostgREST 404 the first time a real user presses the button.
//
// Removing the casts wholesale is not the answer. Doing so surfaces 171 errors, and 155 of them are
// explicit `null` passed to a parameter whose SQL default is *also* null -- semantically identical,
// so it would be 155 mechanical edits with real regression risk and no behavioural gain. This check
// takes the value without the churn: it reads the migrations for what each function actually
// declares and holds the call sites to it, cast or no cast.
//
// Three rules, all derived from the migrations rather than hand-listed:
//
//   1. The function exists in `public` (and was not dropped without being recreated).
//   2. Every `p_*` argument passed is one the function declares.
//   3. No argument is an explicit `null` where the parameter's default is NOT null.
//   4. No argument is an explicit `undefined` where the parameter has NO default.
//
// Rule 4 is the mirror of rule 3 and closes the other half of the same trap. supabase-js drops
// undefined keys from the request body, so an omitted argument is genuinely absent -- and PostgREST
// resolves an RPC by the set of keys it receives, so a missing REQUIRED parameter means the function
// cannot be resolved at all (PGRST202), not that it runs with a null.
//
// What rule 4 does NOT see, stated plainly rather than implied: a value that is merely *typed* as
// possibly-undefined -- `payload.first_name` off a `Partial<>` -- reads as an ordinary expression
// here. Removing the `as never` casts surfaces thirteen of those through typecheck; every one
// checked so far is guarded (by `enabled:` on the query, or by callers that always pass the field),
// so they are latent rather than live. Catching them properly needs type information this check does
// not have. It catches the literal, which is the form a hand-written call takes.
//
// Rule 3 is the one with history. PostgreSQL applies a default only when the argument is OMITTED --
// passing `null` passes null. `start_certification_attempt(p_observed_at timestamptz default now())`
// was called with an explicit `null` against a NOT NULL column, so starting a certification attempt
// failed outright; that was a P1 in review on this branch. Explicit null against `default null` is
// harmless and is deliberately not flagged, which is what keeps this rule to the cases that matter.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLIENT_SRC = path.join(ROOT, "artifacts", "caremetric-carebase", "src");
const EDGE_FUNCTIONS = path.join(ROOT, "supabase", "functions");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

/** Blank JS/TS comments, preserving length. An RPC named in prose is not a call. */
export function blankTsComments(source) {
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

/**
 * Parameter facts for every `public` function a migration declares.
 *
 * Returns `{ params, nonNullDefaults }` keyed by function name. Later definitions win, because
 * `create or replace` supersedes and migrations are read in filename order. Overloads union their
 * parameter names -- distinguishing them would need type resolution this check does not do, and the
 * union is the safe direction: it can miss a wrong argument, never invent one.
 */
export function declaredParameters(sqlTexts) {
  const params = new Map();
  const nonNullDefaults = new Map();
  const noDefaults = new Map();
  for (const text of sqlTexts) {
    const sql = stripSqlComments(text);
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*returns/gi,
    )) {
      const name = m[1].toLowerCase();
      if (!params.has(name)) params.set(name, new Set());
      const defaults = new Set();
      const required = new Set();
      // Split on commas that are not inside parentheses, so `numeric(10,2)` stays one parameter.
      for (const segment of m[2].split(/,(?![^(]*\))/)) {
        const named = segment.match(/\b(p_[a-z0-9_]*)\s+/i);
        if (named) params.get(name).add(named[1].toLowerCase());
        const withDefault = segment.match(/\b(p_[a-z0-9_]*)\s+[a-z0-9_[\]. ]+?\s+default\s+(.+)$/is);
        if (!withDefault) {
          if (named) required.add(named[1].toLowerCase());
          continue;
        }
        const value = withDefault[2].trim().replace(/\s+/g, " ");
        // `default null` means an explicit null is identical to omitting the argument.
        if (/^null(\s*::.*)?$/i.test(value)) continue;
        defaults.add(withDefault[1].toLowerCase());
      }
      nonNullDefaults.set(name, defaults);
      noDefaults.set(name, required);
    }
  }
  return { params, nonNullDefaults, noDefaults };
}

/** Function names that exist in `public` after every create/drop in filename order. */
export function definedFunctions(sqlTexts) {
  const defined = new Set();
  for (const text of sqlTexts) {
    const sql = stripSqlComments(text);
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)) {
      defined.delete(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)/gi)) {
      defined.add(m[1].toLowerCase());
    }
  }
  return defined;
}

/** `{ name, args }` for each `.rpc(...)` call whose arguments are an object literal. */
export function rpcCallSites(source) {
  const code = blankTsComments(source);
  const calls = [];
  for (const m of code.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`](?:\s+as\s+never)?\s*(,\s*)?/gi)) {
    const name = m[1].toLowerCase();
    const after = code.slice(m.index + m[0].length);
    if (!m[2] || !after.startsWith("{")) { calls.push({ name, args: null }); continue; }
    let depth = 0;
    let end = 0;
    for (let i = 0; i < after.length; i += 1) {
      if (after[i] === "{") depth += 1;
      else if (after[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const object = after.slice(0, end + 1);
    const args = [];
    for (const a of object.matchAll(/(?:^|[{,\s])(p_[a-z0-9_]*)\s*:\s*([^,}\n]+)/gi)) {
      args.push({ name: a[1].toLowerCase(), value: a[2].trim() });
    }
    calls.push({ name, args });
  }
  return calls;
}

/** Whether an argument expression is an explicit null (rather than an omission). */
export function isExplicitNull(expression) {
  return /^null$/i.test(expression) || /\?\?\s*null$/i.test(expression) || /:\s*null$/i.test(expression);
}

/**
 * Whether an argument expression is an explicit `undefined`.
 *
 * supabase-js drops undefined keys, so this is an omission dressed as a value -- harmless for a
 * defaulted parameter, fatal for one without a default.
 */
export function isExplicitUndefined(expression) {
  return /^undefined$/i.test(expression) || /\?\?\s*undefined$/i.test(expression);
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [() => [...declaredParameters(["create function public.f(p_a uuid, p_b text default now()) returns void"]).params.get("f")], ["p_a", "p_b"]],
    [() => [...declaredParameters(["create function public.f(p_a uuid, p_b text default now()) returns void"]).nonNullDefaults.get("f")], ["p_b"]],
    // `default null` is not a risky default: passing null is identical to omitting.
    [() => [...declaredParameters(["create function public.f(p_a text default null) returns void"]).nonNullDefaults.get("f")], []],
    [() => [...declaredParameters(["create function public.f(p_a text default null::text) returns void"]).nonNullDefaults.get("f")], []],
    // A comma inside a type must not split the parameter list.
    [() => [...declaredParameters(["create function public.f(p_a numeric(10,2), p_b uuid) returns void"]).params.get("f")], ["p_a", "p_b"]],
    [() => [...definedFunctions(["create function public.gone(p_a uuid) returns void", "drop function public.gone(uuid);"])], []],
    [() => [...definedFunctions(["drop function public.x(uuid);", "create or replace function public.x(p_a uuid) returns void"])], ["x"]],
    [() => rpcCallSites('supabase.rpc("f", { p_a: id })').map((c) => c.name), ["f"]],
    [() => rpcCallSites('supabase.rpc("f" as never, { p_a: id } as never)')[0].args.map((a) => a.name), ["p_a"]],
    // A call with no argument object is still a call, and has nothing to check.
    [() => rpcCallSites('supabase.rpc("f")')[0].args, null],
    // Comments are not call sites.
    [() => rpcCallSites('// supabase.rpc("ghost", {})\n').length, 0],
    [() => isExplicitNull("null"), true],
    [() => isExplicitNull("value ?? null"), true],
    [() => isExplicitNull("undefined"), false],
    [() => isExplicitNull("value ?? undefined"), false],
    [() => isExplicitUndefined("undefined"), true],
    [() => isExplicitUndefined("value ?? undefined"), true],
    [() => isExplicitUndefined("null"), false],
    [() => isExplicitUndefined("value ?? null"), false],
    // A parameter with no default is required; one with any default is not.
    [() => [...declaredParameters(["create function public.f(p_a uuid, p_b text default null) returns void"]).noDefaults.get("f")], ["p_a"]],
    [() => [...declaredParameters(["create function public.f(p_a uuid default gen_random_uuid()) returns void"]).noDefaults.get("f")], []],
  ];
  let failures = 0;
  for (const [run, expected] of cases) {
    const actual = run();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures += 1;
      process.stderr.write(`self-test failed: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}\n`);
    }
  }
  if (failures) throw new Error(`RPC call-signature self-test failed (${failures} case(s)).`);
  process.stdout.write(`RPC call-signature self-test passed (${cases.length} cases).\n`);
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

const migrationFiles = (await walk(MIGRATIONS, (f) => f.endsWith(".sql"))).sort();
const migrationTexts = await Promise.all(migrationFiles.map((f) => readFile(f, "utf8")));
const defined = definedFunctions(migrationTexts);
const { params, nonNullDefaults, noDefaults } = declaredParameters(migrationTexts);

if (defined.size < 300) {
  throw new Error(
    `RPC call-signature check aborted: parsed only ${defined.size} public function(s) from `
    + `${migrationFiles.length} migration(s). A broken parse would pass every call vacuously.`,
  );
}

const sourceFiles = [
  ...(await walk(CLIENT_SRC, (f) => /\.tsx?$/.test(f) && !f.endsWith("database.types.ts") && !/\.test\.tsx?$/.test(f))),
  ...(await walk(EDGE_FUNCTIONS, (f) => /\.(ts|js)$/.test(f) && !/\.test\.(ts|js)$/.test(f))),
];

const findings = [];
for (const file of sourceFiles) {
  const rel = path.relative(ROOT, file);
  for (const call of rpcCallSites(await readFile(file, "utf8"))) {
    if (!defined.has(call.name)) {
      findings.push(`${rel}: calls \`${call.name}\`, which no migration defines in public.`);
      continue;
    }
    if (!call.args) continue;
    const declared = params.get(call.name) ?? new Set();
    const risky = nonNullDefaults.get(call.name) ?? new Set();
    const required = noDefaults.get(call.name) ?? new Set();
    for (const arg of call.args) {
      if (declared.size > 0 && !declared.has(arg.name)) {
        findings.push(`${rel}: \`${call.name}\` has no parameter \`${arg.name}\`.`);
      }
      if (required.has(arg.name) && isExplicitUndefined(arg.value)) {
        findings.push(
          `${rel}: \`${call.name}\` is passed an explicit undefined for \`${arg.name}\`, which has no `
          + "default. supabase-js drops undefined keys, so the argument is absent and PostgREST cannot "
          + "resolve the function at all (PGRST202). Pass a value, or give the parameter a default.",
        );
      }
      if (risky.has(arg.name) && isExplicitNull(arg.value)) {
        findings.push(
          `${rel}: \`${call.name}\` is passed an explicit null for \`${arg.name}\`, whose default is `
          + "not null. PostgreSQL applies a default only when the argument is OMITTED, so this passes "
          + "null. Send `undefined` instead.",
        );
      }
    }
  }
}

if (findings.length) {
  throw new Error(
    `${findings.length} RPC call-signature problem(s):\n` +
      findings.map((f) => `  ${f}`).join("\n") +
      "\n\nThese are invisible to typecheck wherever the call site uses `as never`, and 131 of them do.\n" +
      "See BACKLOG.md G18.",
  );
}

process.stdout.write(
  `RPC call-signature check passed (${defined.size} public function(s), ${sourceFiles.length} source file(s), ` +
    `${[...nonNullDefaults.values()].filter((s) => s.size).length} with a non-null-default parameter, ` +
    `${[...noDefaults.values()].filter((s) => s.size).length} with a required parameter).\n`,
);
