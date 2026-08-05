import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// Cache-invalidation check.
//
// TanStack Query matches an invalidation against a query by comparing key ELEMENTS, left to right.
// `invalidateQueries({ queryKey: ["a"] })` refreshes `["a", id]`, because "a" === "a". It does not
// refresh `["a-b", id]`, because "a" !== "a-b" -- string prefixes are not key prefixes.
//
// So an invalidation whose first element matches no query's first element is a no-op: the mutation
// succeeds, the toast says it worked, and the list the user is looking at keeps showing the old
// value until something else happens to refetch it. Nothing catches this. It is not a type error,
// the key is a perfectly good string, and a unit test that mocks the client sees a call that
// happened.
//
// Four were real when this was written, and they were all one keystroke:
//
//   revoke_class_checkin_tokens   invalidated ["training_class"]        query is ["training_classes"]
//   submit_credential_renewal     invalidated ["employee-credentials"]  query is ["employee_credentials"]
//   determine_incident_reportability
//                                 invalidated ["incident-notifications"] query is ["incident_notifications"]
//   offline unscheduled-service sync
//                                 invalidated ["daily-operations"]      query is ["daily-operations-command-center"]
//
// The incident one is the sharpest: the file's own comment says determining reportability "also
// creates or stands down notification rows", and the hyphen meant the notification list never heard
// about it.
//
// The rule: every `invalidateQueries({ queryKey: [...] })` root must be the root of some query.
// Roots that are legitimately not query roots belong in query-invalidation-allowlist.json.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLIENT_SRC = path.join(ROOT, "artifacts", "caremetric-carebase", "src");
const ALLOWLIST = path.join(ROOT, "scripts", "query-invalidation-allowlist.json");

/** Blank comments, preserving length. A key named in prose is not a key. */
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
 * `const NAME = ["root", ...]` declarations, so a key held in a constant resolves to its root.
 *
 * Without this the check reports every constant-keyed query as having no definition --
 * `useOfflineObservationDrafts` keeps its key in `const QUERY_KEY = ["offline-observation-drafts"]`
 * and was a false positive until this existed.
 */
export function constantKeyRoots(source) {
  const roots = new Map();
  for (const m of blankTsComments(source).matchAll(
    /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]*)?=\s*\[\s*["'`]([^"'`]+)["'`]/g,
  )) {
    roots.set(m[1], m[2]);
  }
  return roots;
}

/**
 * Heads of every inner array inside an array-of-arrays literal.
 *
 * A table of query keys -- `[["a"], ["b", id]]`, either standalone or as the values of a record --
 * exists to be handed to something one entry at a time. The entries never appear at a `queryKey:`
 * site, so the patterns below cannot see them, which is the hole `invalidateQueries({ queryKey: key
 * })` fell through.
 */
export function nestedKeyTableRoots(source) {
  const code = blankTsComments(source);
  const roots = [];
  for (const open of [...code.matchAll(/\[\s*\[/g)].map((m) => m.index)) {
    let depth = 0;
    let end = open;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "[") depth += 1;
      else if (code[i] === "]") { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    for (const m of code.slice(open, end).matchAll(/\[\s*["'`]([^"'`]+)["'`]/g)) roots.push(m[1]);
  }
  return roots;
}

/**
 * Roots of every key literal following `pattern`, resolving constants through `constants`.
 *
 * `unresolved` counts the identifiers that named a key the gate could not follow -- a loop variable,
 * an index into a table, a helper's return value. A caller that cares whether it saw the whole
 * picture has to be told when it did not.
 */
export function keyRoots(source, pattern, constants) {
  const roots = [];
  let unresolved = 0;
  for (const m of blankTsComments(source).matchAll(pattern)) {
    const literal = m[1];
    const identifier = m[2];
    if (literal) roots.push(literal);
    else if (identifier && constants.has(identifier)) roots.push(constants.get(identifier));
    else if (identifier) unresolved += 1;
  }
  roots.unresolved = unresolved;
  return roots;
}

// `queryKey:` then a string literal or an identifier. The surrounding `[` is optional because a key
// is just as often held whole in a variable -- `queryKey: key` -- and requiring the bracket made
// every one of those invisible rather than merely unresolved.
const KEY_HEAD = String.raw`queryKey:\s*(?:\[\s*(?:\.\.\.)?)?(?:["'\`]([^"'\`]+)["'\`]|([A-Za-z_$][A-Za-z0-9_$]*))`;
export const QUERY_PATTERN = new RegExp(String.raw`use(?:Infinite)?Query\(\{[\s\S]{0,600}?${KEY_HEAD}`, "g");
export const INVALIDATE_PATTERN = new RegExp(String.raw`invalidateQueries\(\{\s*${KEY_HEAD}`, "g");
// A query key may also be declared standalone and handed to useQuery, or built by a helper.
export const ANY_KEY_PATTERN = new RegExp(KEY_HEAD, "g");

if (process.argv.includes("--self-test")) {
  const constants = constantKeyRoots('const QUERY_KEY = ["drafts"];');
  const cases = [
    [() => [...constants], [["QUERY_KEY", "drafts"]]],
    [() => keyRoots('useQuery({ queryKey: ["a", id] })', QUERY_PATTERN, new Map()), ["a"]],
    // A constant used as the whole key resolves, with or without the spread form.
    [() => keyRoots("useQuery({ queryKey: QUERY_KEY })", QUERY_PATTERN, constants), ["drafts"]],
    [() => keyRoots("useQuery({ queryKey: [...QUERY_KEY, id] })", QUERY_PATTERN, constants), ["drafts"]],
    // Module-first resolution: the local declaration wins over a same-named one elsewhere.
    [() => {
      const global = new Map([["QUERY_KEY", "somewhere-else"]]);
      const local = new Map([...global, ...constantKeyRoots('const QUERY_KEY = ["mine"];')]);
      return keyRoots("useQuery({ queryKey: [...QUERY_KEY, id] })", QUERY_PATTERN, local);
    }, ["mine"]],
    [() => keyRoots('invalidateQueries({ queryKey: ["b"] })', INVALIDATE_PATTERN, new Map()), ["b"]],
    // Comments are not call sites.
    [() => keyRoots('// invalidateQueries({ queryKey: ["ghost"] })\n', INVALIDATE_PATTERN, new Map()), []],
    // An unfollowable key is reported as such rather than passing silently, which is what makes the
    // key-table fallback fire. This is the case that hid "daily-operations".
    [() => keyRoots("invalidateQueries({ queryKey: key })", INVALIDATE_PATTERN, new Map()).unresolved, 1],
    [() => keyRoots('invalidateQueries({ queryKey: ["b"] })', INVALIDATE_PATTERN, new Map()).unresolved, 0],
    // Key tables, standalone and as record values, including the shape that hid the bug.
    [() => nestedKeyTableRoots('const T = [["a"], ["b", id]];'), ["a", "b"]],
    [() => nestedKeyTableRoots('const T: R = { k: [["a"]], j: [["b"], ["c"]] };'), ["a", "b", "c"]],
    [() => nestedKeyTableRoots('const T = [["daily-operations"]];'), ["daily-operations"]],
    // A flat key is not a key table; only the inner arrays of a nested one count.
    [() => nestedKeyTableRoots('const K = ["a", "b"];'), []],
    [() => nestedKeyTableRoots('// const T = [["ghost"]];\n'), []],
    // The bug this exists for: these two roots are NOT the same key, though they look alike.
    [() => "training_class" === "training_classes", false],
    [() => "daily-operations" === "daily-operations-command-center", false],
  ];
  let failures = 0;
  for (const [run, expected] of cases) {
    const actual = run();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures += 1;
      process.stderr.write(`self-test failed: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}\n`);
    }
  }
  if (failures) throw new Error(`Query-invalidation self-test failed (${failures} case(s)).`);
  process.stdout.write(`Query-invalidation self-test passed (${cases.length} cases).\n`);
  process.exit(0);
}

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (/\.tsx?$/.test(full) && !full.endsWith("database.types.ts") && !/\.test\.tsx?$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

const files = await walk(CLIENT_SRC);
const sources = new Map(await Promise.all(files.map(async (f) => [f, await readFile(f, "utf8")])));

// Key constants resolve module-first, then globally. Several hook modules each declare their own
// `const QUERY_KEY = [...]` with a different root, so a single flat map silently resolves one
// module's constant to another's key -- which is how `useOfflineObservationDrafts` looked like an
// orphan while its query was right there. A constant is also routinely exported and spread at a
// call site in another file, so the global map is still needed as the fallback.
const globalConstants = new Map();
for (const source of sources.values()) {
  for (const [name, root] of constantKeyRoots(source)) globalConstants.set(name, root);
}
const constantsFor = (source) => new Map([...globalConstants, ...constantKeyRoots(source)]);

// Query roots come from sources with every `invalidateQueries({...})` removed first, so an
// invalidation's own key can never vouch for itself. Doing this as a second pass over an already
// populated set was the first attempt, and it wrongly cleared two roots that other queries really
// did define.
const queryRoots = new Set();
const invalidations = new Map();
for (const [file, source] of sources) {
  const constants = constantsFor(source);
  const code = blankTsComments(source);
  const withoutInvalidations = code.replace(/invalidateQueries\(\{[\s\S]*?\}\s*\)/g, " ");
  // Any surviving `queryKey:` establishes a real key -- useQuery, useInfiniteQuery, setQueryData,
  // prefetchQuery, getQueryData, and the helper builders that hand one to them.
  for (const root of keyRoots(withoutInvalidations, ANY_KEY_PATTERN, constants)) queryRoots.add(root);
  const invalidated = keyRoots(code, INVALIDATE_PATTERN, constants);
  // An invalidation keyed on something the gate could not follow means this file dispatches keys
  // dynamically, so its key tables are the invalidation list. `useOfflineServiceDrafts` does exactly
  // this -- a per-kind record of key arrays, walked in a loop -- and its `["daily-operations"]` entry
  // (the real key root is "daily-operations-command-center") survived the first version of this check
  // because no root ever appeared at a `queryKey:` site to be read.
  const roots = invalidated.unresolved ? [...invalidated, ...nestedKeyTableRoots(source)] : invalidated;
  for (const root of roots) {
    if (!invalidations.has(root)) invalidations.set(root, path.relative(ROOT, file));
  }
}

let allowlist = {};
try {
  const parsed = JSON.parse(await readFile(ALLOWLIST, "utf8"));
  allowlist = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith("_")));
} catch {
  // An absent allowlist means nothing is excused, which is the correct default.
}

const findings = [...invalidations]
  .filter(([root]) => !queryRoots.has(root) && !allowlist[root])
  .sort();

if (findings.length) {
  throw new Error(
    `${findings.length} cache invalidation(s) whose key root matches no query:\n` +
      findings.map(([root, file]) => `  "${root}"  (${file})`).join("\n") +
      "\n\nTanStack Query compares key ELEMENTS, so \"training_class\" does not match\n" +
      "[\"training_classes\", id] and \"daily-operations\" does not match\n" +
      "[\"daily-operations-command-center\", id]. An invalidation that matches nothing is a mutation\n" +
      "that succeeds while the list the user is looking at keeps showing the old value.\n" +
      "Correct the key, delete the line, or record the root in\n" +
      "scripts/query-invalidation-allowlist.json with the reason. See BACKLOG.md G19.",
  );
}

process.stdout.write(
  `Query-invalidation check passed (${queryRoots.size} query root(s), ` +
    `${invalidations.size} invalidation root(s), ${Object.keys(allowlist).length} allowlisted).\n`,
);
