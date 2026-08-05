import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// Server-emitted link check.
//
// The database and the edge functions build in-app links as string literals -- notification `link`
// columns, and `search_workspace`, which branches on role to send a platform admin to
// `/admin/<kind>/<id>` instead of `/app/<kind>/<id>`. Nothing verified that those paths exist.
//
// Two of them did not. `search_workspace` emits eleven `/admin/...` prefixes; nine had a route and
// `/admin/complaints` and `/admin/violations` never got built, so a platform admin who searched a
// complaint number or a citation reference clicked the result and landed on Not Found. GlobalSearch
// navigates `item.route` verbatim -- no `safePathForRole`, no fallback -- so nothing softened it,
// and no test noticed, because the link is assembled in SQL and consumed as an opaque string.
//
// The rule: every in-app path literal in a migration or an edge function must match a route
// declared in App.tsx. Paths are compared with their `:param` segments as wildcards, since the
// server concatenates real ids onto a prefix.
//
// A literal that is deliberately not a route -- an external URL, an anchor, an API path -- belongs
// in server-route-link-allowlist.json with the reason.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const APP_TSX = path.join(ROOT, "artifacts", "caremetric-carebase", "src", "App.tsx");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const EDGE_FUNCTIONS = path.join(ROOT, "supabase", "functions");
const ALLOWLIST = path.join(ROOT, "scripts", "server-route-link-allowlist.json");

// The route prefixes this check governs. Anything else in a string literal is not an in-app link.
const APP_PREFIXES = ["/app", "/admin", "/account", "/employee", "/trainer", "/me", "/portal"];

/** Route paths declared in App.tsx. */
export function declaredRoutes(appSource) {
  return [...appSource.matchAll(/<Route\s+path=\{?["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}

/**
 * In-app path literals in server source.
 *
 * A trailing `/` is kept, because that is the shape the concatenating form takes --
 * `'/admin/complaints/' || c.id::text` -- and it is exactly the case that broke.
 *
 * A template literal's `${...}` becomes a stand-in segment rather than disqualifying the whole
 * literal. Skipping them was the first version's blind spot: an edge function that builds its link
 * with a template is doing the same thing as one that concatenates in SQL, and
 * `compliance-copilot`'s `/app/inspection-items/${row.id}` -- a route that does not exist -- went
 * unreported the entire time the check claimed to be reading every server link.
 */
export function serverLinkLiterals(source) {
  const found = new Set();
  for (const re of [/'([^']*)'/g, /"([^"]*)"/g, /`([^`]*)`/g]) {
    for (const match of source.matchAll(re)) {
      // An interpolated value fills one path segment, which is exactly what a `:param` route accepts.
      const value = match[1].replace(/\$\{[^}]*\}/g, "x");
      if (!APP_PREFIXES.some((p) => value === p || value.startsWith(`${p}/`))) continue;
      // SQL concatenation, or interpolation this cannot read; the quoted prefix stands on its own.
      if (/[|${}]/.test(value)) continue;
      found.add(value);
    }
  }
  return [...found].sort();
}

/**
 * Whether a declared route can serve this link.
 *
 * `:param` matches one segment. A link ending in `/` is a concatenation prefix, so it is tested as
 * though an id follows it -- that is what the server actually produces. A query string is not part
 * of the route: `/app/alerts?status=open` is `/app/alerts`, and several notification links carry
 * deep-link filters that way.
 */
export function routeMatches(route, link) {
  const pathname = link.split("?")[0];
  const candidates = pathname.endsWith("/") ? [pathname.slice(0, -1), `${pathname}id`] : [pathname];
  const pattern = new RegExp(
    `^${route.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`,
  );
  return candidates.some((candidate) => pattern.test(candidate));
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [() => declaredRoutes('<Route path="/app/x">'), ["/app/x"]],
    [() => declaredRoutes('<Route path="/admin/y/:id">'), ["/admin/y/:id"]],
    [() => serverLinkLiterals("select '/app/incidents/' || i.id;"), ["/app/incidents/"]],
    [() => serverLinkLiterals("'https://example.com/app/x'"), []],
    // Not an in-app prefix.
    [() => serverLinkLiterals("'/functions/v1/thing'"), []],
    // An interpolated segment is checked, standing in for the one value it fills.
    [() => serverLinkLiterals("`/app/${kind}/x`"), ["/app/x/x"]],
    [() => serverLinkLiterals("`/app/inspection-items/${row.id}`"), ["/app/inspection-items/x"]],
    // Substituting a segment is what lets a `:param` route accept it.
    [() => routeMatches("/app/inspections/:id", "/app/inspections/x"), true],
    [() => routeMatches("/app/inspections/:id", "/app/inspection-items/x"), false],
    [() => routeMatches("/admin/complaints/:id", "/admin/complaints/"), true],
    [() => routeMatches("/admin/complaints/:id", "/admin/complaints/abc-123"), true],
    // The bug this check exists for: the route simply does not exist.
    [() => routeMatches("/app/complaints/:id", "/admin/complaints/"), false],
    // A prefix must not match a deeper route by accident.
    [() => routeMatches("/app/a/:id/b", "/app/a/"), false],
    [() => routeMatches("/app/settings", "/app/settings"), true],
    // A query string is a deep-link filter, not part of the route.
    [() => routeMatches("/app/alerts", "/app/alerts?status=open"), true],
    [() => routeMatches("/app/x/:id", "/app/x/?resident="), true],
  ];
  let failures = 0;
  for (const [run, expected] of cases) {
    const actual = run();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures += 1;
      process.stderr.write(`self-test failed: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}\n`);
    }
  }
  if (failures) throw new Error(`Server-route-link self-test failed (${failures} case(s)).`);
  process.stdout.write(`Server-route-link self-test passed (${cases.length} cases).\n`);
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

const routes = declaredRoutes(await readFile(APP_TSX, "utf8"));
if (routes.length < 50) {
  throw new Error(
    `Server-route-link check aborted: parsed only ${routes.length} route(s) from App.tsx. A broken `
    + "parse would pass every link vacuously.",
  );
}

let allowlist = {};
try {
  const parsed = JSON.parse(await readFile(ALLOWLIST, "utf8"));
  allowlist = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith("_")));
} catch {
  // An absent allowlist means nothing is excused, which is the correct default.
}

// Edge-function TESTS carry fixture URLs that are deliberately not real routes -- a report path
// with a bogus id, a `?secret=ignored` sentinel -- so they are not server-emitted links.
const serverFiles = [
  ...(await walk(MIGRATIONS, (f) => f.endsWith(".sql"))),
  ...(await walk(EDGE_FUNCTIONS, (f) => /\.(ts|js)$/.test(f) && !/\.test\.(ts|js)$/.test(f))),
];

const findings = new Map();
for (const file of serverFiles) {
  const source = await readFile(file, "utf8");
  for (const link of serverLinkLiterals(source)) {
    if (allowlist[link]) continue;
    if (routes.some((route) => routeMatches(route, link))) continue;
    if (!findings.has(link)) findings.set(link, path.relative(ROOT, file));
  }
}

if (findings.size) {
  throw new Error(
    `${findings.size} server-emitted link(s) with no matching route in App.tsx:\n` +
      [...findings].sort().map(([link, file]) => `  ${link}  (first seen in ${file})`).join("\n") +
      "\n\nDeclare the route, correct the link, or record it in scripts/server-route-link-allowlist.json\n" +
      "with the reason it is not an in-app path. A link the server hands a user has to go somewhere:\n" +
      "`search_workspace` sent platform admins to /admin/complaints/<id> and /admin/violations/<id>,\n" +
      "neither of which existed, and GlobalSearch navigates the route verbatim. See BACKLOG.md G17.",
  );
}

process.stdout.write(
  `Server-route-link check passed (${routes.length} declared route(s), ` +
    `${serverFiles.length} server file(s), ${Object.keys(allowlist).length} allowlisted).\n`,
);
