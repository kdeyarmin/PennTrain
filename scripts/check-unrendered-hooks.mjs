import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// Unrendered-hook check.
//
// `check-dormant-rpcs.mjs` asks whether a database function has any caller. This asks the question
// one layer up, because satisfying that check turned out not to mean the capability was reachable:
//
//   A hook that calls an RPC, which no component ever renders, is a capability with no way in --
//   and the dormant-RPC gate passes on it, because the RPC does have a caller. That caller is
//   simply unreachable itself.
//
// Nine RPCs were in exactly that state when this was written. Among them: a certificate could not
// be issued, a time-off request could not be cancelled, a support plan could not be acknowledged,
// and a resident's change of condition could not be logged. One of them,
// `add_appointment_preparation_item`, was introduced by the very branch that added the dormant-RPC
// gate -- the hook was written, the surface was not, and the gate reported zero.
//
// The rule: an exported `use*` hook must be referenced from a module that the application entry
// point can actually reach, directly or through another hook that is itself reachable.
//
// "Referenced by some .tsx" was the first version of that rule and it was not enough, which a
// 209-line `ReadinessForecastPanel` proved: it renders a 30/60/90-day workforce forecast, it is the
// only caller of `get_workforce_readiness_forecast` and `route_workforce_readiness_remediation`,
// and nothing imports the panel. Both gates passed -- the RPCs had hooks, the hooks had a .tsx --
// and the capability was three layers deep in nothing. So reachability is now computed from the
// import graph, seeded at `main.tsx` and following static imports and `lazy(() => import(...))`
// alike. A file nobody imports is reported in its own right, because that is the same defect one
// layer out.
//
// Legitimately-unrendered hooks belong in unrendered-hook-allowlist.json with a reason. "It will
// have a screen soon" is not a reason; land the screen, or delete the hook.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLIENT_SRC = path.join(ROOT, "artifacts", "caremetric-carebase", "src");
const ALLOWLIST = path.join(ROOT, "scripts", "unrendered-hook-allowlist.json");
const ENTRY = path.join(CLIENT_SRC, "main.tsx");

const HOOK_DECLARATION = /export\s+function\s+(use[A-Z][A-Za-z0-9_]*)/g;

/**
 * Blank out comments and string/template literals, preserving length so byte offsets still line up.
 *
 * Two things depend on this. Brace-matching a hook body has to ignore a `{` inside a string, and a
 * hook named in a stale comment ("used by Reports.tsx's register") is not a caller -- three hooks
 * looked reachable on nothing but a comment that had outlived the call it described.
 */
export function blankNonCode(source) {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    let end;
    if (two === "//") end = source.indexOf("\n", i) === -1 ? source.length : source.indexOf("\n", i);
    else if (two === "/*") end = source.indexOf("*/", i + 2) === -1 ? source.length : source.indexOf("*/", i + 2) + 2;
    else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote) j += source[j] === "\\" ? 2 : 1;
      end = Math.min(j + 1, source.length);
    } else { i += 1; continue; }
    for (let k = i; k < end; k += 1) if (out[k] !== "\n") out[k] = " ";
    i = end;
  }
  return out.join("");
}

/** Exported hook names declared in a file. */
export function exportedHooks(source) {
  return [...blankNonCode(source).matchAll(HOOK_DECLARATION)].map((m) => m[1]);
}

/**
 * Each exported hook's own source, from `export function` through its closing brace.
 *
 * Reachability propagates hook-to-hook, and hooks live many-to-a-file, so "does this file mention
 * the hook" is the wrong question -- it makes two unreachable siblings vouch for each other. What
 * counts is whether the *body* of a reachable hook calls it.
 */
export function hookBodies(source) {
  const code = blankNonCode(source);
  const bodies = new Map();
  for (const match of code.matchAll(HOOK_DECLARATION)) {
    const open = code.indexOf("{", match.index + match[0].length);
    if (open === -1) continue;
    let depth = 0;
    let end = code.length;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") { depth -= 1; if (depth === 0) { end = i + 1; break; } }
    }
    bodies.set(match[1], code.slice(match.index, end));
  }
  return bodies;
}

/**
 * Module specifiers this source imports, static and dynamic alike.
 *
 * Read from the RAW source, before comments are blanked, because an import path IS a string literal
 * and blanking strings would erase every edge in the graph. Comments are stripped first so a
 * commented-out import does not keep a dead file alive -- the same distinction the caller scan in
 * check-dormant-rpcs.mjs has to make, in the opposite direction.
 */
export function importedSpecifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const out = [];
  for (const re of [
    /\bfrom\s*["']([^"']+)["']/g,          // import x from "..."  /  export * from "..."
    /\bimport\s*\(\s*["']([^"']+)["']/g,   // import("..."), including inside lazy()
    /\bimport\s*["']([^"']+)["']/g,        // bare side-effect import "..."
  ]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** Whether `source` references `name` other than by declaring it. */
export function referencesHook(source, name) {
  const withoutDeclaration = blankNonCode(source).replace(
    new RegExp(`export\\s+function\\s+${name}\\b`, "g"),
    " ",
  );
  return new RegExp(`\\b${name}\\b`).test(withoutDeclaration);
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [() => exportedHooks("export function useThing() {}"), ["useThing"]],
    [() => exportedHooks("export function useA() {}\nexport function useB2() {}"), ["useA", "useB2"]],
    // Not exported, and not a hook name, are both out of scope.
    [() => exportedHooks("function usePrivate() {}\nexport function helper() {}"), []],
    [() => referencesHook("const x = useThing();", "useThing"), true],
    // A file that only declares the hook does not count as rendering it.
    [() => referencesHook("export function useThing() { return 1; }", "useThing"), false],
    // A declaration plus a real use does count.
    [() => referencesHook("export function useThing() {}\nconst y = useThing();", "useThing"), true],
    // Substring collisions must not count.
    [() => referencesHook("const x = useThingElse();", "useThing"), false],
    // A hook named only in a comment has no caller.
    [() => referencesHook("// useThing() is where this used to live\n", "useThing"), false],
    [() => referencesHook("/* see useThing */ const a = 1;", "useThing"), false],
    [() => referencesHook('const label = "useThing";', "useThing"), false],
    // Bodies are delimited by braces, not by the next declaration.
    [() => [...hookBodies("export function useA() { if (x) { y(); } }\nexport function useB() { useC(); }").keys()], ["useA", "useB"]],
    [() => /\buseC\b/.test(hookBodies("export function useA() { const q = 1; }\nexport function useB() { useC(); }").get("useA")), false],
    [() => /\buseC\b/.test(hookBodies("export function useA() { const q = 1; }\nexport function useB() { useC(); }").get("useB")), true],
    // A brace inside a string must not end the body early.
    [() => /\buseC\b/.test(hookBodies('export function useA() { const s = "}"; useC(); }').get("useA")), true],
    // Import specifiers come from the raw source: the path is a string literal, so blanking strings
    // would erase the graph, while a commented-out import must not keep a dead file alive.
    [() => importedSpecifiers('import { A } from "@/x";'), ["@/x"]],
    [() => importedSpecifiers('const P = lazy(() => import("@/pages/app/Foo"));'), ["@/pages/app/Foo"]],
    [() => importedSpecifiers('export * from "./bar";'), ["./bar"]],
    [() => importedSpecifiers('import "./side-effect";'), ["./side-effect"]],
    [() => importedSpecifiers('// import { A } from "@/dead";\n'), []],
    [() => importedSpecifiers('/* import { A } from "@/dead"; */'), []],
  ];
  let failures = 0;
  for (const [run, expected] of cases) {
    const actual = run();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures += 1;
      process.stderr.write(`self-test failed: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}\n`);
    }
  }
  if (failures) throw new Error(`Unrendered-hook self-test failed (${failures} case(s)).`);
  process.stdout.write(`Unrendered-hook self-test passed (${cases.length} cases).\n`);
  process.exit(0);
}

async function walk(dir, options = {}, out = []) {
  let entries;
  try { entries = await readdir(dir); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) await walk(full, options, out);
    else if (/\.(ts|tsx)$/.test(full) && !full.endsWith("database.types.ts")
      && (options.includeTests || !/\.test\.(ts|tsx)$/.test(full))) {
      out.push(full);
    }
  }
  return out;
}

const files = await walk(CLIENT_SRC);
const sources = new Map(await Promise.all(files.map(async (f) => [f, await readFile(f, "utf8")])));
// A second table that also carries the test files, used only for the "is this module consumed by
// anything at all" question below.
const allFiles = await walk(CLIENT_SRC, { includeTests: true });
const allSources = new Map(await Promise.all(allFiles.map(async (f) => [f, await readFile(f, "utf8")])));

const declaredIn = new Map();
const bodies = new Map();
for (const [file, source] of sources) {
  for (const hook of exportedHooks(source)) declaredIn.set(hook, file);
  for (const [hook, body] of hookBodies(source)) bodies.set(hook, body);
}

// Resolve a specifier the way the bundler does: `@/x` is src/x, everything else is relative, and
// an extensionless path may be a file or a directory index.
function resolveSpecifier(fromFile, specifier, table = sources) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(CLIENT_SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null; // a package, not a file in this graph
  for (const candidate of [
    base, `${base}.ts`, `${base}.tsx`,
    path.join(base, "index.ts"), path.join(base, "index.tsx"),
  ]) {
    if (table.has(candidate)) return candidate;
  }
  return null;
}

// Modules the application entry can actually reach. Anything outside this set is dead weight no
// user can arrive at, however complete it looks.
const reachableModules = new Set();
if (sources.has(ENTRY)) {
  const queue = [ENTRY];
  reachableModules.add(ENTRY);
  while (queue.length) {
    const file = queue.pop();
    for (const specifier of importedSpecifiers(sources.get(file) ?? "")) {
      const target = resolveSpecifier(file, specifier);
      if (target && !reachableModules.has(target)) {
        reachableModules.add(target);
        queue.push(target);
      }
    }
  }
} else {
  throw new Error(`Unrendered-hook check cannot start: entry point ${path.relative(ROOT, ENTRY)} not found.`);
}

// A hook is reachable if a .tsx renders it, or the body of a reachable hook calls it. Iterate to a
// fixed point: a chain of hooks is only as reachable as the component at the end of it.
//
// The declaring file counts when it is itself a .tsx -- a hook declared beside the component that
// uses it is rendered by definition, and `referencesHook` already discounts the declaration.
const reachable = new Set();
for (const [hook, declaration] of declaredIn) {
  for (const [file, source] of sources) {
    if (!reachableModules.has(file)) continue;
    if (!file.endsWith(".tsx") || (file === declaration && !declaration.endsWith(".tsx"))) continue;
    if (referencesHook(source, hook)) { reachable.add(hook); break; }
  }
}
let grew = true;
while (grew) {
  grew = false;
  for (const hook of declaredIn.keys()) {
    if (reachable.has(hook)) continue;
    for (const caller of reachable) {
      if (caller === hook) continue;
      if (!reachableModules.has(declaredIn.get(caller) ?? "")) continue;
      if (new RegExp(`\\b${hook}\\b`).test(bodies.get(caller) ?? "")) {
        reachable.add(hook);
        grew = true;
        break;
      }
    }
  }
}

let allowlist = {};
try {
  const parsed = JSON.parse(await readFile(ALLOWLIST, "utf8"));
  allowlist = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith("_")));
} catch {
  // An absent allowlist means nothing is excused, which is the correct default.
}

// A file NOTHING consumes is the same defect one layer out: complete-looking work with no way in.
// Reported separately because the remedy differs -- a dead module is imported or deleted, where a
// dead hook is rendered or deleted.
//
// This asks a deliberately different question from hook reachability, and so it is seeded
// differently. Hooks are seeded at `main.tsx` alone, because "a user can reach it" is the whole
// point. Modules are seeded at `main.tsx` PLUS every test file and the build config, because a pure
// helper exercised only by its own unit test is tested, not dead -- `lib/bulkActions.ts` is exactly
// that. Merging the two seeds would reopen the hole this check exists to close: a component that
// only a test imports still has no way in for a user.
const consumerSeeds = [
  ENTRY,
  ...(await walk(CLIENT_SRC, { includeTests: true })).filter((f) => /\.test\.(ts|tsx)$/.test(f)),
];
const consumedModules = new Set();
for (const seed of consumerSeeds) {
  if (!allSources.has(seed)) continue;
  const queue = [seed];
  consumedModules.add(seed);
  while (queue.length) {
    const file = queue.pop();
    for (const specifier of importedSpecifiers(allSources.get(file) ?? "")) {
      const target = resolveSpecifier(file, specifier, allSources);
      if (target && !consumedModules.has(target)) {
        consumedModules.add(target);
        queue.push(target);
      }
    }
  }
}

const deadModules = [...sources.keys()]
  .filter((file) => !consumedModules.has(file))
  .filter((file) => !allowlist[path.relative(ROOT, file)])
  .sort();

const findings = [];
for (const [hook, declaration] of [...declaredIn].sort()) {
  if (reachable.has(hook)) continue;
  if (allowlist[hook]) continue;
  findings.push(`${hook}  (${path.relative(ROOT, declaration)})`);
}

if (deadModules.length) {
  throw new Error(
    `${deadModules.length} module(s) the application entry point cannot reach:\n` +
      deadModules.map((f) => `  ${path.relative(ROOT, f)}`).join("\n") +
      "\n\nImport it from something reachable, or delete it. A file nobody imports is complete-looking\n" +
      "work with no way in -- `ReadinessForecastPanel` was 209 lines of workforce forecast, the only\n" +
      "caller of two RPCs, and imported by nothing. See BACKLOG.md G16.25.\n" +
      "If it is deliberately unreferenced, record its repo-relative path in\n" +
      "scripts/unrendered-hook-allowlist.json with the reason.",
  );
}

if (findings.length) {
  throw new Error(
    `${findings.length} exported hook(s) that no component renders:\n` +
      findings.map((f) => `  ${f}`).join("\n") +
      "\n\nRender it, delete it, or record it in scripts/unrendered-hook-allowlist.json with the reason.\n" +
      "A hook nothing renders is a capability with no way in, and the dormant-RPC gate cannot see it:\n" +
      "the RPC has a caller, and that caller is unreachable. See BACKLOG.md G16.",
  );
}
// Say how much of the allowlist is debt rather than only that the check passed. An allowlist that
// reports its own size and nothing else reads as "handled"; these are capabilities with no way in.
const awaiting = Object.values(allowlist).filter((entry) => entry?.awaiting_surface).length;
process.stdout.write(
  `Unrendered-hook check passed (${declaredIn.size} exported hook(s) across ` +
    `${reachableModules.size} reachable module(s), ${Object.keys(allowlist).length} allowlisted, ` +
    `${awaiting} awaiting a surface).\n`,
);
