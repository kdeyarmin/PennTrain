import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { declaredRoutes, isInAppPath, routeMatches } from "./lib/appRoutes.mjs";
import { blankJsComments } from "./lib/jsComments.mjs";

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
 * EVERY string and template literal, filtered by prefix -- the same reading check-server-route-links
 * does, and for the same reason it learned to. An earlier version of this check matched only the
 * syntactic forms that obviously navigate (`href=`, `setLocation(`, and the object keys nav tables
 * use). That reads well and is wrong in one direction: a path routed through a constant
 * (`const RESIDENTS = "/app/residents"`, used later as `href={RESIDENTS}`), a ternary
 * (`role === "platform_admin" ? "/admin/incidents" : "/app/incidents"`), or an array of
 * destinations is invisible to it, and this codebase uses all three. The server check's own header
 * records the identical mistake: "Skipping them was the first version's blind spot."
 *
 * `<Route path="/x">` still is not a link -- but it needs no special case, because a declared route
 * trivially matches itself.
 *
 * Comments are blanked first. The prose in this repository is full of route paths, because people
 * document routing decisions where they make them, and reading it as code reported three sentences
 * about routes as broken routes -- one of them a comment explaining that `/app/compliance` is not a
 * route, i.e. the note left behind by the very fix this check would have made unnecessary.
 */
export function frontendLinkLiterals(source) {
  const code = blankJsComments(source);
  const found = new Set();
  for (const re of [/'([^']*)'/g, /"([^"]*)"/g, /`([^`]*)`/g]) {
    for (const match of code.matchAll(re)) {
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
 * A `*` stands for an interpolated expression whose value this check cannot know, so a link is only
 * a defect when NO expansion of it resolves. WHICH expansions are possible depends on where the
 * expression sits, and reading that from the position rather than allowing every expansion
 * everywhere is what keeps the check strict:
 *
 *   own segment -- `/app/residents/${id}` (a `*` right after `/`) fills exactly one segment, so the
 *                  only expansion is `/app/residents/x`, which `:id` serves. Allowing the empty
 *                  expansion too, as this once did, also accepted `/app/residents` -- a real but
 *                  DIFFERENT route (the list page). Any `/app/<list>/${id}` link would then have
 *                  passed on the strength of the list route alone, even with no detail route
 *                  declared at all: precisely the dead link this check exists to catch.
 *   glued on    -- `/app/survey-day${facilityQ}` may be a query string (`?facility=…`) or empty, and
 *                  may equally extend the segment, so both expansions stand.
 *
 * A literal with no interpolation may still be a concatenation prefix -- `${base}/${id}` is how this
 * codebase builds role-scoped detail links, leaving `/admin/incidents` in the source and
 * `/admin/incidents/<id>` on screen -- so a trailing segment is offered for those too. It costs
 * nothing in strictness: the path still has to match SOME declared route either way.
 */
export function linkCandidates(literal) {
  if (!literal.includes("*")) {
    return [...new Set([literal, `${literal.replace(/\/$/, "")}/x`])];
  }
  const candidates = new Set();
  // Each `*` expands independently by position: after a `/` it is a whole segment, otherwise it is
  // glued to the preceding text and may also vanish.
  const segmentOnly = literal.replace(/(^|\/)\*/g, "$1x");
  candidates.add(segmentOnly.replaceAll("*", "x"));
  candidates.add(segmentOnly.replaceAll("*", ""));
  return [...candidates];
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [() => frontendLinkLiterals('<Link href="/app/residents">'), ["/app/residents"]],
    [() => frontendLinkLiterals("<Link href={`/app/residents/${id}`}>"), ["/app/residents/*"]],
    [() => frontendLinkLiterals('<Redirect to="/app/today" />'), ["/app/today"]],
    [() => frontendLinkLiterals('{ href: "/app/incidents", label: "Incidents" }'), ["/app/incidents"]],
    [() => frontendLinkLiterals('setLocation("/app/work")'), ["/app/work"]],
    [() => frontendLinkLiterals("navigate(`/app/residents/${r.id}/forms`)"), ["/app/residents/*/forms"]],
    // The forms the narrow first version could not see: a constant, a ternary, an array.
    [() => frontendLinkLiterals('const RESIDENTS = "/app/residents";'), ["/app/residents"]],
    [
      () => frontendLinkLiterals('role === "platform_admin" ? "/admin/incidents" : "/app/incidents"'),
      ["/admin/incidents", "/app/incidents"],
    ],
    [() => frontendLinkLiterals('const P = ["/app/a", "/app/b"];'), ["/app/a", "/app/b"]],
    // A `*` on its own segment fills that segment and nothing else -- notably NOT the empty string,
    // which would let a list route vouch for a missing detail route.
    [() => linkCandidates("/app/residents/*"), ["/app/residents/x"]],
    // Glued to a segment it may extend it, or be a query string, or be absent.
    [() => linkCandidates("/app/survey-day*"), ["/app/survey-dayx", "/app/survey-day"]],
    // A plain literal may still be a `${base}/${id}` prefix.
    [() => linkCandidates("/app/today"), ["/app/today", "/app/today/x"]],
    [() => linkCandidates("/admin/incidents/"), ["/admin/incidents/", "/admin/incidents/x"]],
    // External and non-app paths are out of scope.
    [() => frontendLinkLiterals('href="https://www.pa.gov/app/thing"'), []],
    [() => frontendLinkLiterals('href="/functions/v1/thing"'), []],
    // Comments are prose about routes, not routes. This sentence exists in workItemSources.ts.
    [() => frontendLinkLiterals('// The Command Center, not "/app/compliance" -- no such route.'), []],
    [() => frontendLinkLiterals("/* see `/app/compliance` */"), []],
    [() => frontendLinkLiterals('const x = 1; // "/app/gone"\nconst y = "/app/real";'), ["/app/real"]],
    // A `//` inside a string is not a comment opener.
    [() => frontendLinkLiterals('const u = "https://x.test/y"; const p = "/app/real";'), ["/app/real"]],
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
