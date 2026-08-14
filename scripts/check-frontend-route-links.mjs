import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { declaredRoutes, isInAppPath, routeMatches } from "./lib/appRoutes.mjs";

// Client-emitted link check -- the other half of check-server-route-links.mjs.
//
// That check exists because `search_workspace` emitted two `/admin/...` prefixes with no route
// behind them, and a platform admin who clicked a search result landed on Not Found. Its scope was
// migrations and edge functions, because that is where the links it was written for are assembled.
//
// The client had the same defect and no check. `carebaseGlossary.ts` still carries the note:
// "`/app/compliance` is not a route App.tsx registers -- these three sent the reader to the 404
// page. check-server-route-links verifies exactly this rule, but only for links built in
// migrations and edge functions; a client-side registry like this one is outside its scope."
// Three dead links reached users, were repaired by hand, and the gap was written down instead of
// closed. Nothing stopped the fourth: `Dashboard.tsx` was reporting `route: "/app/dashboard"` to
// product telemetry for a page mounted at `/app`.
//
// Same rule, read from the client side: every in-app path literal in CareBase source must match a
// route declared in App.tsx. A literal that is deliberately not a route belongs in
// frontend-route-link-allowlist.json with the reason.
//
// Deliberately NOT covered: paths assembled from variables (`href={item.route}`). Those are only
// as good as whatever produced them, and the producers that live in SQL are already covered by the
// server check. This reads literals, which is where a typo or a renamed route actually lands.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const APP_SRC = path.join(ROOT, "artifacts", "caremetric-carebase", "src");
const APP_TSX = path.join(APP_SRC, "App.tsx");
const ALLOWLIST = path.join(ROOT, "scripts", "frontend-route-link-allowlist.json");

/**
 * In-app path literals in client source.
 *
 * Only the forms that actually navigate or declare a destination, rather than every quoted string:
 * a bare string starting with `/app` may be a storage key, an analytics label, or a comment
 * fragment, and treating all of them as links is how a check like this ends up with an allowlist
 * longer than its findings.
 *
 *   href="/x"  href={"/x"}  href={`/x/${id}`}  to="/x"
 *   href: "/x"  path: "/x"  route: "/x"  url: "/x"  link: "/x"  destination: "/x"
 *   setLocation("/x")  navigate("/x")  setLocation(`/x/${id}`)
 *
 * `<Route path="/x">` is deliberately not one of them -- that is a declaration, not a link, and
 * matching it against itself proves nothing.
 */
const LINK_PATTERNS = [
  /\b(?:href|to)=\{?["'`]([^"'`]+)["'`]\}?/g,
  /\b(?:href|to)=\{`([^`]+)`\}/g,
  /\b(?:href|path|route|to|url|link|destination)\s*:\s*["'`]([^"'`]+)["'`]/g,
  /\b(?:href|path|route|to|url|link|destination)\s*:\s*`([^`]+)`/g,
  /\b(?:setLocation|navigate)\(\s*["'`]([^"'`]+)["'`]/g,
  /\b(?:setLocation|navigate)\(\s*`([^`]+)`/g,
];

export function frontendLinkLiterals(source) {
  const found = new Set();
  for (const re of LINK_PATTERNS) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      // `${...}` becomes `*`, a stand-in whose possible expansions are decided by linkCandidates().
      const value = match[1].replace(/\$\{[^}]*\}/g, "*");
      if (!isInAppPath(value)) continue;
      // Interpolation this cannot read (a whole path in one expression) proves nothing either way.
      if (/[${}]/.test(value)) continue;
      found.add(value);
    }
  }
  return [...found].sort();
}

/**
 * The paths a link literal could actually resolve to at runtime.
 *
 * A `*` stands for an interpolated expression, and this check cannot know its value -- so a link is
 * only a defect when NO expansion of it resolves. Two expansions matter, and both occur in this
 * codebase:
 *
 *   one segment  -- `/app/residents/${id}`      → `/app/residents/x`, matching `:id`
 *   empty/suffix -- `/app/survey-day${facilityQ}` → `/app/survey-day`, where the expression is a
 *                   query string (`?facility=…`) or the empty string
 *
 * Substituting a segment unconditionally was wrong for the second shape and reported
 * `/app/survey-dayx` -- a path no route serves and no user ever visits -- as a dead link.
 */
export function linkCandidates(literal) {
  if (!literal.includes("*")) return [literal];
  return [...new Set([literal.replaceAll("*", "x"), literal.replaceAll("*", "")])];
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [() => frontendLinkLiterals('<Link href="/app/residents">'), ["/app/residents"]],
    [() => frontendLinkLiterals('<Link href={"/app/x"}>'), ["/app/x"]],
    [() => frontendLinkLiterals("<Link href={`/app/residents/${id}`}>"), ["/app/residents/*"]],
    [() => frontendLinkLiterals('<Redirect to="/app/today" />'), ["/app/today"]],
    [() => frontendLinkLiterals('{ href: "/app/incidents", label: "Incidents" }'), ["/app/incidents"]],
    [() => frontendLinkLiterals('{ route: "/app/state-forms" }'), ["/app/state-forms"]],
    [() => frontendLinkLiterals('setLocation("/app/work")'), ["/app/work"]],
    [() => frontendLinkLiterals("navigate(`/app/residents/${r.id}/forms`)"), ["/app/residents/*/forms"]],
    // A whole segment expands to one value; a suffix glued to a segment may also be empty, which is
    // the `?facility=…` shape the survey-path checklist builds.
    [() => linkCandidates("/app/residents/*"), ["/app/residents/x", "/app/residents/"]],
    [() => linkCandidates("/app/survey-day*"), ["/app/survey-dayx", "/app/survey-day"]],
    [() => linkCandidates("/app/today"), ["/app/today"]],
    // A declaration is not a link; matching the route table against itself proves nothing.
    [() => frontendLinkLiterals('<Route path="/app/today">'), []],
    // External and non-app paths are out of scope.
    [() => frontendLinkLiterals('href="https://www.pa.gov/app/thing"'), []],
    [() => frontendLinkLiterals('href="/functions/v1/thing"'), []],
    // A bare quoted string that is not a navigation form is not a link.
    [() => frontendLinkLiterals('const key = "/app/cache-key";'), []],
    // The defect that motivated this check: telemetry naming a route that does not exist.
    [() => frontendLinkLiterals('{ eventName: "benchmark_viewed", route: "/app/dashboard" }'), ["/app/dashboard"]],
    [() => routeMatches("/app", "/app/dashboard"), false],
    [() => routeMatches("/app", "/app"), true],
    // A query string or hash is a deep link within a route, not a different route.
    [() => routeMatches("/app/survey-day", "/app/survey-day?facility=abc"), true],
    [() => routeMatches("/app/binder", "/app/binder#section"), true],
  ];
  let failures = 0;
  for (const [run, expected] of cases) {
    const actual = run();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures += 1;
      process.stderr.write(`self-test failed: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}\n`);
    }
  }
  if (failures) throw new Error(`Frontend-route-link self-test failed (${failures} case(s)).`);
  process.stdout.write(`Frontend-route-link self-test passed (${cases.length} cases).\n`);
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
    `Frontend-route-link check aborted: parsed only ${routes.length} route(s) from App.tsx. A broken `
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

// Tests carry fixture routes that are deliberately not real -- a bogus id, a route asserted to be
// missing -- so they are not client-emitted links.
const clientFiles = await walk(
  APP_SRC,
  (f) => /\.(tsx|ts)$/.test(f) && !/\.test\.(tsx|ts)$/.test(f),
);

const findings = new Map();
let linkCount = 0;
for (const file of clientFiles) {
  const links = frontendLinkLiterals(await readFile(file, "utf8"));
  linkCount += links.length;
  for (const link of links) {
    if (allowlist[link]) continue;
    const candidates = linkCandidates(link);
    if (candidates.some((candidate) => routes.some((route) => routeMatches(route, candidate)))) continue;
    const where = findings.get(link) ?? new Set();
    where.add(path.relative(ROOT, file));
    findings.set(link, where);
  }
}

// A regex that stops matching would report zero findings and look like a pass. This repository has
// hundreds of in-app links in client source; finding almost none means the reader broke.
if (linkCount < 100) {
  throw new Error(
    `Frontend-route-link check aborted: found only ${linkCount} in-app link literal(s) across `
    + `${clientFiles.length} client file(s). A broken reader would pass vacuously.`,
  );
}

if (findings.size > 0) {
  const lines = [
    "Frontend-route-link check failed.",
    "",
    `${findings.size} in-app link literal(s) in CareBase source do not match any route declared in App.tsx.`,
    "A user who clicks one of these lands on Not Found.",
    "",
  ];
  for (const [link, where] of [...findings].sort()) {
    lines.push(`  ${link}`);
    for (const file of [...where].sort()) lines.push(`      ${file}`);
  }
  lines.push(
    "",
    "  Fix the path, add the route to App.tsx, or -- if the literal is deliberately not a route --",
    `  record it with a reason in ${path.relative(ROOT, ALLOWLIST)}.`,
  );
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `Frontend-route-link check passed (${routes.length} declared route(s), ${clientFiles.length} client file(s), `
  + `${linkCount} link literal(s), ${Object.keys(allowlist).length} allowlisted).\n`,
);
