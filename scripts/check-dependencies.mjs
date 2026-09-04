// Audit all packages in pnpm-lock.yaml -- plus the Deno `npm:` imports used by the
// Supabase Edge Functions (N-12b) -- against the npm bulk advisory database.
//
// WHOSE FAULT IS A RED GATE. This audits the LIVE advisory database, so a newly-published
// advisory turns every open branch red the day it lands, main included, with no commit
// behind it. That happened three times in one week (GHSA-mh99-v99m-4gvg, then
// GHSA-rgw5-rvv9-x895, then GHSA-7p8r-x3mc-p8w7), and each time it blocked branches that
// had not touched a dependency at all. Left alone it trains people to read a red gate as
// noise, which is the failure mode that eventually lets a real one through.
//
// The fix is not to stop auditing live, and not to pin a stale snapshot -- both trade away
// the thing the gate is for. It is to answer a question this script previously could not:
// did THIS change introduce the vulnerable package, or did it already exist on the base
// branch? Pass `--base <ref>` and the same audit runs twice, once for HEAD's dependency set
// and once for the base ref's. An advisory that fires against BOTH is pre-existing: it is
// reported loudly and does not fail the branch, because blocking a docs PR on it helps
// nobody and the base branch's own run already fails for it. An advisory that fires only
// against HEAD is this change's doing and fails, as before.
//
// Comparison is by advisory id against two audits, deliberately, rather than by matching
// `vulnerable_versions` ranges locally: the registry already does that matching correctly
// for each set, and reimplementing semver range logic inside a security gate is exactly
// where a subtle bug would be invisible and expensive.
//
// FAIL CLOSED. Without `--base`, or when the base ref cannot be read, every high/critical
// advisory fails -- the original behaviour. Pushes to main pass no base and are therefore
// always strict, which is what keeps a pre-existing advisory from living forever: main goes
// red, and that is the right branch to go red.
//
// pnpm audit uses the retired npm legacy audit endpoint (/-/npm/v1/security/audits,
// which now returns 410). This script calls the replacement bulk advisory endpoint
// (/-/npm/v1/security/advisories/bulk) directly so it works regardless of which
// pnpm version is installed.
//
// Edge Functions run on Deno and pull dependencies via `npm:pkg@version` / `jsr:...`
// specifiers, so they never appear in pnpm-lock.yaml and were previously unaudited.
// This script scans supabase/functions/**/*.ts for those specifiers and audits the
// `npm:` ones through the same bulk endpoint (one request, same network-failure
// behavior: any fetch/parse error throws and fails the check). `jsr:` packages are
// resolved to their npm counterpart only where the mapping is trivial and 1:1
// (@supabase/supabase-js is a straight mirror of the npm package); everything else
// on jsr has no npm advisory coverage and is listed-and-skipped with a note.
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Extract package name→versions from the `packages:` block of pnpm-lock.yaml.
// pnpm can emit package keys quoted or unquoted, depending on the package name
// and lockfile version, for example:
//
//   '@scope/name@1.2.3':
//     resolution: ...
//   react@19.1.0:
//     resolution: ...
//
// Scoped packages start with @, so the *last* @ in the key separates name from version.
// We stop at the `snapshots:` block, which reuses the same syntax with peer-dep
// suffixes like '@scope/name@x.y.z(peer@v):' that would produce bogus version strings.
function parsePackagesFromLockfile(content) {
  const packagesMatch = /(^|\r?\n)packages:\r?\n/.exec(content);
  if (!packagesMatch) {
    throw new Error("pnpm-lock.yaml is missing a top-level packages: section.");
  }
  const packagesStart = packagesMatch.index + packagesMatch[1].length;
  const snapshotsMatch = /(^|\r?\n)snapshots:\r?\n/.exec(content);
  const snapshotsStart = snapshotsMatch ? snapshotsMatch.index + snapshotsMatch[1].length : -1;
  const section =
    snapshotsStart === -1
      ? content.slice(packagesStart)
      : content.slice(packagesStart, snapshotsStart);

  const map = new Map(); // package name → Set<version>
  let parsedEntries = 0;
  for (const match of section.matchAll(/^  (?:'([^']+)'|([^\s][^:]*)):/gm)) {
    const key = (match[1] ?? match[2] ?? "").trim().replace(/^\//, "");
    const separator = key.lastIndexOf("@");
    if (separator <= 0 || separator === key.length - 1) continue;
    const name = key.slice(0, separator);
    const version = key.slice(separator + 1);
    if (!name || !version || version.includes("(")) continue;
    parsedEntries++;
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(version);
  }
  if (parsedEntries === 0) {
    throw new Error("No package entries could be parsed from pnpm-lock.yaml.");
  }
  return { packages: map, parsedEntries };
}

// jsr packages whose npm counterpart is a trivial, 1:1 mirror of the same code under the
// same name. Only these are folded into the npm advisory audit; other jsr packages (e.g.
// @std/*) are jsr-native with no npm advisory coverage and are listed-and-skipped instead.
const TRIVIAL_JSR_TO_NPM = new Map([["@supabase/supabase-js", "@supabase/supabase-js"]]);

// An exact, auditable version: x.y.z with optional prerelease/build suffix. Range
// specifiers (^, ~, bare majors like `@2`) cannot be matched against advisory version
// ranges reliably, so they are listed-and-skipped rather than silently guessed at.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

async function findTypeScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await findTypeScriptFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      paths.push(fullPath);
    }
  }
  return paths.sort();
}

// Split "name@version/subpath" (name may be @scoped) into { name, version }.
function parseSpecifierBody(body) {
  const versionSeparator = body.indexOf("@", body.startsWith("@") ? body.indexOf("/") : 0);
  if (versionSeparator <= 0) {
    // No version -- keep just the package name (scope/name or bare name), drop any subpath.
    const segments = body.split("/");
    const name = body.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
    return { name, version: null };
  }
  const name = body.slice(0, versionSeparator);
  let version = body.slice(versionSeparator + 1);
  const subpath = version.indexOf("/");
  if (subpath !== -1) version = version.slice(0, subpath);
  return { name, version: version || null };
}

// Read every edge-function .ts file from disk. Split from the scanner below so the base
// ref can supply the same shape out of a git tree instead -- see readTreeDenoSources.
async function readDiskDenoSources(functionsDir) {
  let files;
  try {
    files = await findTypeScriptFiles(functionsDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    files.map(async (file) => ({ path: file, content: await readFile(file, "utf8") })),
  );
}

// Scan Edge Function sources for npm:/jsr: import specifiers and sort them into
// packages auditable against the npm advisory database vs. skipped specifiers.
function collectDenoImports(sources) {
  const auditable = new Map(); // npm package name → Set<version>
  const skipped = new Map(); // raw specifier → note (deduplicated)
  for (const { content: source } of sources) {
    for (const match of source.matchAll(/["'](npm|jsr):([^"']+)["']/g)) {
      const scheme = match[1];
      const raw = `${scheme}:${match[2]}`;
      const { name, version } = parseSpecifierBody(match[2]);
      if (!name) continue;
      if (scheme === "jsr" && !TRIVIAL_JSR_TO_NPM.has(name)) {
        skipped.set(raw, "jsr-native package with no trivial npm equivalent; review advisories on jsr.io/GitHub");
        continue;
      }
      if (!version || !EXACT_VERSION.test(version)) {
        skipped.set(raw, "non-exact version specifier; pin to x.y.z or audit manually");
        continue;
      }
      const npmName = scheme === "jsr" ? TRIVIAL_JSR_TO_NPM.get(name) : name;
      if (!auditable.has(npmName)) auditable.set(npmName, new Set());
      auditable.get(npmName).add(version);
    }
  }
  return {
    auditable,
    skipped: [...skipped.entries()].map(([specifier, note]) => ({ specifier, note })).sort((a, b) => a.specifier.localeCompare(b.specifier)),
    fileCount: sources.length,
  };
}

const FUNCTIONS_PREFIX = "supabase/functions";

async function git(args) {
  const { stdout } = await execFileAsync("git", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Edge-function sources as they exist at `ref`, in the same shape readDiskDenoSources returns. */
async function readTreeDenoSources(ref) {
  let listing;
  try {
    listing = await git(["ls-tree", "-r", "--name-only", "-z", ref, FUNCTIONS_PREFIX]);
  } catch {
    return [];
  }
  const files = listing.split("\0").filter((entry) => entry.endsWith(".ts")).sort();
  const sources = [];
  for (const file of files) {
    sources.push({ path: file, content: await git(["show", `${ref}:${file}`]) });
  }
  return sources;
}

/**
 * The auditable package set for one tree: lockfile packages plus edge-function npm: imports.
 * Both sides of the base comparison are built through this, so a difference between them is a
 * real dependency difference and never a difference in how the two were collected.
 */
function buildAuditSet(lockfileContent, denoSources) {
  const { packages, parsedEntries } = parsePackagesFromLockfile(lockfileContent);
  const denoImports = collectDenoImports(denoSources);
  let denoVersionCount = 0;
  for (const [name, versions] of denoImports.auditable) {
    if (!packages.has(name)) packages.set(name, new Set());
    for (const version of versions) {
      packages.get(name).add(version);
      denoVersionCount++;
    }
  }
  return { packages, parsedEntries, denoImports, denoVersionCount };
}

const HIGH_SEVERITY = new Set(["high", "critical"]);

/**
 * True when two audit sets name exactly the same packages at exactly the same versions.
 *
 * WHY A SECURITY GATE IS ALLOWED TO SKIP ITSELF. It is not skipping itself. `--base` mode asks
 * one question -- did THIS change introduce a high or critical advisory? -- and answers it by
 * auditing two dependency sets and diffing the results. When the two sets are identical, both
 * audits send the same payload to the same endpoint and get back the same reply, so every
 * advisory lands in `preExisting` and `introduced` is empty by construction, whatever the
 * registry says today or tomorrow. The verdict is knowable from the sets alone, so asking is
 * not a check -- it is a network call whose answer cannot change the outcome.
 *
 * WHY IT MATTERS. The audit fails closed on a transport error, and it runs FIRST in the
 * `application` job, ahead of check:all. So an unreachable registry does not degrade one
 * signal; it reddens the whole job on every open branch at once, including branches that touch
 * no dependency at all. Observed on 2026-09-04: one `503 Service Unavailable` followed by 60s
 * timeouts on every retry, across three job runs in seven minutes, on a documentation-only
 * branch. That is exactly the "people learn to read a red gate as noise" failure this script's
 * own header was written to prevent, arriving through the transport instead of through the
 * advisory feed -- and the header's fix (ask whether the change introduced it) already contains
 * the answer.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not weaken strict mode: with no `--base`, or an
 * unreadable one, `baseSet` is null, no comparison is possible, and every high advisory fails
 * as before. Pushes to main pass no base, so main still goes red for a pre-existing advisory,
 * which is the branch that should. And the comparison is exact in both directions -- a changed
 * version, an added package, a removed package, an added version of a package already present
 * -- because "close enough" here would let a real dependency change skip the audit.
 */
function auditSetsAreIdentical(headPackages, basePackages) {
  if (headPackages.size !== basePackages.size) return false;
  for (const [name, versions] of headPackages) {
    const baseVersions = basePackages.get(name);
    if (!baseVersions || baseVersions.size !== versions.size) return false;
    for (const version of versions) {
      if (!baseVersions.has(version)) return false;
    }
  }
  return true;
}

/**
 * Sort HEAD's advisories into what this change introduced and what the base already carried.
 *
 * Pure, and exported-in-spirit for --self-test, because this is the one piece of judgment in
 * the script: everything else is I/O. `baseAdvisories` is null in strict mode (no --base, or
 * an unreadable base), and null must behave exactly like the original script -- every
 * high/critical counted as introduced. That is the fail-closed guarantee, and the self-test
 * asserts it rather than leaving it to a reading of the code.
 */
function classifyAdvisories(headAdvisories, baseAdvisories) {
  const baseKeys = new Set();
  for (const [pkgName, list] of Object.entries(baseAdvisories ?? {})) {
    for (const advisory of list) baseKeys.add(`${pkgName}\u0000${advisory.id}`);
  }
  const introduced = [];
  const preExisting = [];
  let lowOrModerate = 0;
  for (const [pkgName, list] of Object.entries(headAdvisories ?? {})) {
    for (const advisory of list) {
      if (!HIGH_SEVERITY.has(advisory.severity)) {
        lowOrModerate++;
        continue;
      }
      const entry = { pkgName, advisory };
      if (baseKeys.has(`${pkgName}\u0000${advisory.id}`)) preExisting.push(entry);
      else introduced.push(entry);
    }
  }
  return { introduced, preExisting, lowOrModerate };
}

const ADVISORY_REQUEST_TIMEOUT_MS = 60_000;
const ADVISORY_REQUEST_ATTEMPTS = 3;

function postJson(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path: urlPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("error", reject);
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Advisory endpoint responded with ${res.statusCode}: ${raw}`,
              ),
            );
          } else {
            try {
              resolve(JSON.parse(raw));
            } catch (parseError) {
              reject(
                new Error(
                  `Failed to parse advisory response JSON: ${parseError.message}`,
                  { cause: parseError },
                ),
              );
            }
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(ADVISORY_REQUEST_TIMEOUT_MS, () => {
      req.destroy(
        new Error(
          `Advisory request timed out after ${ADVISORY_REQUEST_TIMEOUT_MS / 1_000}s`,
        ),
      );
    });
    req.write(data);
    req.end();
  });
}

async function fetchAdvisories(hostname, urlPath, body) {
  let lastError;
  for (let attempt = 1; attempt <= ADVISORY_REQUEST_ATTEMPTS; attempt++) {
    try {
      return await postJson(hostname, urlPath, body);
    } catch (error) {
      lastError = error;
      if (attempt === ADVISORY_REQUEST_ATTEMPTS) break;

      const delayMs = 1_000 * 2 ** (attempt - 1);
      console.warn(
        `Advisory request attempt ${attempt}/${ADVISORY_REQUEST_ATTEMPTS} failed: ${error.message}. ` +
          `Retrying in ${delayMs / 1_000}s…`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { baseRef: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--self-test") options.selfTest = true;
    else if (argv[i] === "--base") {
      const value = argv[++i];
      if (!value) throw new Error("--base requires a ref argument, e.g. --base origin/main");
      options.baseRef = value;
    }
  }
  return options;
}

function runSelfTest() {
  const high = (id) => ({ id, severity: "high", title: `t${id}`, vulnerable_versions: "<1", url: `u${id}` });
  const cases = [];
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, actual, expected });
  };
  const shape = (r) => ({
    introduced: r.introduced.map((e) => `${e.pkgName}:${e.advisory.id}`),
    preExisting: r.preExisting.map((e) => `${e.pkgName}:${e.advisory.id}`),
    lowOrModerate: r.lowOrModerate,
  });

  // THE fail-closed case: no base means strict, exactly as before --base existed.
  check("null base fails every high advisory",
    shape(classifyAdvisories({ a: [high(1)] }, null)),
    { introduced: ["a:1"], preExisting: [], lowOrModerate: 0 });

  check("an advisory the base also has is pre-existing",
    shape(classifyAdvisories({ a: [high(1)] }, { a: [high(1)] })),
    { introduced: [], preExisting: ["a:1"], lowOrModerate: 0 });

  check("an advisory only HEAD has is introduced",
    shape(classifyAdvisories({ a: [high(1)] }, { a: [high(2)] })),
    { introduced: ["a:1"], preExisting: [], lowOrModerate: 0 });

  // Same advisory id, different package: NOT a match. Keyed on both, or a shared advisory
  // affecting two packages would excuse the one this change actually introduced.
  check("the same id under a different package is not pre-existing",
    shape(classifyAdvisories({ a: [high(1)] }, { b: [high(1)] })),
    { introduced: ["a:1"], preExisting: [], lowOrModerate: 0 });

  check("low/moderate is counted, never failed on",
    shape(classifyAdvisories({ a: [{ ...high(1), severity: "moderate" }] }, null)),
    { introduced: [], preExisting: [], lowOrModerate: 1 });

  check("critical is treated as high",
    shape(classifyAdvisories({ a: [{ ...high(1), severity: "critical" }] }, {})),
    { introduced: ["a:1"], preExisting: [], lowOrModerate: 0 });

  check("a mixed set splits both ways",
    shape(classifyAdvisories({ a: [high(1), high(2)] }, { a: [high(2)] })),
    { introduced: ["a:1"], preExisting: ["a:2"], lowOrModerate: 0 });

  // The identical-set short-circuit. Every one of these has to be exact: if any "nearly the
  // same" set read as identical, a real dependency change would skip the audit entirely, which
  // is the one way this optimization could become a hole.
  const auditSet = (entries) => new Map(entries.map(([name, versions]) => [name, new Set(versions)]));

  check("identical sets are identical regardless of insertion order",
    auditSetsAreIdentical(
      auditSet([["a", ["1.0.0"]], ["b", ["2.0.0"]]]),
      auditSet([["b", ["2.0.0"]], ["a", ["1.0.0"]]]),
    ),
    true);

  check("a changed version is not identical",
    auditSetsAreIdentical(auditSet([["a", ["1.0.0"]]]), auditSet([["a", ["1.0.1"]]])),
    false);

  check("an added package is not identical",
    auditSetsAreIdentical(auditSet([["a", ["1.0.0"]], ["b", ["2.0.0"]]]), auditSet([["a", ["1.0.0"]]])),
    false);

  check("a removed package is not identical",
    auditSetsAreIdentical(auditSet([["a", ["1.0.0"]]]), auditSet([["a", ["1.0.0"]], ["b", ["2.0.0"]]])),
    false);

  // Same package count and the same name, one extra version: the outer size check passes and
  // only the per-package version comparison catches it.
  check("an added version of a package already present is not identical",
    auditSetsAreIdentical(auditSet([["a", ["1.0.0", "1.1.0"]]]), auditSet([["a", ["1.0.0"]]])),
    false);

  check("two empty sets are identical",
    auditSetsAreIdentical(auditSet([]), auditSet([])),
    true);

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) {
    console.error(`  FAIL ${c.name}`);
    console.error(`    expected ${JSON.stringify(c.expected)}`);
    console.error(`    actual   ${JSON.stringify(c.actual)}`);
  }
  if (failed.length > 0) {
    throw new Error(`Dependency-gate self-test failed (${failed.length}/${cases.length} cases).`);
  }
  console.log(`Dependency-gate self-test passed (${cases.length} cases).`);
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) {
  runSelfTest();
  process.exit(0);
}

const head = buildAuditSet(
  await readFile(path.resolve(process.cwd(), "pnpm-lock.yaml"), "utf8"),
  await readDiskDenoSources(path.resolve(process.cwd(), "supabase", "functions")),
);
const { packages, parsedEntries, denoImports, denoVersionCount } = head;

if (packages.size === 0) {
  console.log("No packages found in pnpm-lock.yaml or supabase/functions imports.");
  process.exit(0);
}

console.log(
  `Auditing ${packages.size} packages (${parsedEntries} lockfile entries; ` +
    `${denoImports.auditable.size} Deno-imported packages / ${denoVersionCount} versions from ` +
    `${denoImports.fileCount} edge-function .ts files) against the npm advisory database…`,
);
if (denoImports.skipped.length > 0) {
  console.log(
    `Skipped ${denoImports.skipped.length} Deno import specifier(s) not auditable via the npm advisory database:`,
  );
  for (const { specifier, note } of denoImports.skipped) {
    console.log(`  ${specifier} — ${note}`);
  }
}

// Base set. Any failure to read it degrades to strict mode with a visible reason -- never to
// a silent pass, and never to a hard error either, because a missing base ref is a CI
// configuration problem and should not masquerade as a vulnerability.
let baseSet = null;
if (options.baseRef) {
  try {
    await git(["rev-parse", "--verify", `${options.baseRef}^{commit}`]);
    baseSet = buildAuditSet(
      await git(["show", `${options.baseRef}:pnpm-lock.yaml`]),
      await readTreeDenoSources(options.baseRef),
    );
    console.log(
      `Comparing against ${options.baseRef} (${baseSet.packages.size} packages) to tell ` +
        `newly-introduced advisories from ones that branch already carries…`,
    );
  } catch (error) {
    console.warn(
      `Could not read the dependency set at '${options.baseRef}' (${error.message.trim()}). ` +
        `Auditing in strict mode: every high or critical advisory will fail this run.`,
    );
    baseSet = null;
  }
} else {
  console.log(
    "No --base given; auditing in strict mode (every high or critical advisory fails).",
  );
}

// The one case whose answer is already known: see auditSetsAreIdentical. Resolving it from the
// sets in hand keeps a registry outage from failing branches that changed no dependency, without
// touching what the gate concludes when they did.
if (baseSet && auditSetsAreIdentical(packages, baseSet.packages)) {
  console.log(
    `Dependency set is identical to ${options.baseRef} (${packages.size} packages, same versions), ` +
      `so this change cannot introduce an advisory -- every result would classify as pre-existing. ` +
      `Skipping the advisory audit; ${options.baseRef}'s own strict run owns anything pre-existing.`,
  );
  process.exit(0);
}

const toPayload = (set) =>
  Object.fromEntries([...set.entries()].map(([name, versions]) => [name, [...versions]]));

async function audit(set, label) {
  try {
    return await fetchAdvisories(
      "registry.npmjs.org",
      "/-/npm/v1/security/advisories/bulk",
      toPayload(set),
    );
  } catch (error) {
    throw new Error(`Failed to fetch security advisories for ${label}: ${error.message}`, {
      cause: error,
    });
  }
}

const headAdvisories = await audit(packages, "this branch");
// A base audit that cannot be fetched must not quietly excuse anything: fall back to strict
// rather than treating an empty result as "the base was clean".
let baseAdvisories = null;
if (baseSet) {
  try {
    baseAdvisories = await audit(baseSet.packages, options.baseRef);
  } catch (error) {
    console.warn(`${error.message} Auditing in strict mode instead.`);
    baseAdvisories = null;
  }
}

const { introduced, preExisting, lowOrModerate } = classifyAdvisories(
  headAdvisories,
  baseAdvisories,
);

const report = (entry, stream) => {
  const { pkgName, advisory } = entry;
  stream(`[${advisory.severity.toUpperCase()}] ${pkgName}: ${advisory.title}`);
  stream(`  Affected: ${advisory.vulnerable_versions}`);
  stream(`  Details:  ${advisory.url}`);
};

if (preExisting.length > 0) {
  console.warn(
    `\n${preExisting.length} high/critical advisor${preExisting.length === 1 ? "y" : "ies"} ` +
      `already present on ${options.baseRef} — NOT caused by this change, and not failing it:`,
  );
  for (const entry of preExisting) report(entry, (line) => console.warn(`  ${line}`));
  console.warn(
    `  These still need fixing. ${options.baseRef}'s own run fails on them, which is the ` +
      `branch that should be red for a dependency it already ships.\n`,
  );
}

for (const entry of introduced) report(entry, (line) => console.error(line));

const totalHigh = introduced.length + preExisting.length;
if (totalHigh === 0 && lowOrModerate === 0) {
  console.log("No vulnerabilities found.");
} else if (introduced.length === 0) {
  console.log(
    `${lowOrModerate} low/moderate vulnerabilities found (none at high or critical severity ` +
      `introduced by this change).`,
  );
} else {
  throw new Error(
    `${introduced.length} high or critical ${introduced.length === 1 ? "vulnerability" : "vulnerabilities"} ` +
      `introduced by this change. Resolve before merging.`,
  );
}
