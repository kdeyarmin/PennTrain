// Audit all packages in pnpm-lock.yaml -- plus the Deno `npm:` imports used by the
// Supabase Edge Functions (N-12b) -- against the npm bulk advisory database.
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
import https from "node:https";
import path from "node:path";

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

// Scan Edge Function sources for npm:/jsr: import specifiers and sort them into
// packages auditable against the npm advisory database vs. skipped specifiers.
async function collectDenoImports(functionsDir) {
  let files;
  try {
    files = await findTypeScriptFiles(functionsDir);
  } catch (error) {
    if (error.code === "ENOENT") return { auditable: new Map(), skipped: [], fileCount: 0 };
    throw error;
  }

  const auditable = new Map(); // npm package name → Set<version>
  const skipped = new Map(); // raw specifier → note (deduplicated)
  for (const file of files) {
    const source = await readFile(file, "utf8");
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
    fileCount: files.length,
  };
}

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
    req.setTimeout(30_000, () => {
      req.destroy(new Error("Advisory request timed out after 30s"));
    });
    req.write(data);
    req.end();
  });
}

const lockfilePath = path.resolve(process.cwd(), "pnpm-lock.yaml");
const lockfileContent = await readFile(lockfilePath, "utf8");
const { packages, parsedEntries } = parsePackagesFromLockfile(lockfileContent);

// Fold the Edge Functions' Deno npm: imports (and trivially-mapped jsr: imports) into the
// same audit set, so one bulk request covers both dependency worlds.
const denoImports = await collectDenoImports(
  path.resolve(process.cwd(), "supabase", "functions"),
);
let denoVersionCount = 0;
for (const [name, versions] of denoImports.auditable) {
  if (!packages.has(name)) packages.set(name, new Set());
  for (const version of versions) {
    packages.get(name).add(version);
    denoVersionCount++;
  }
}

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

// Build payload: { "name": ["v1", "v2"], ... }
const requestPayload = Object.fromEntries(
  [...packages.entries()].map(([name, versions]) => [name, [...versions]]),
);

let advisories;
try {
  advisories = await postJson(
    "registry.npmjs.org",
    "/-/npm/v1/security/advisories/bulk",
    requestPayload,
  );
} catch (error) {
  throw new Error(`Failed to fetch security advisories: ${error.message}`, {
    cause: error,
  });
}

const HIGH_SEVERITY = new Set(["high", "critical"]);
let highCount = 0;
let totalCount = 0;

for (const [pkgName, pkgAdvisories] of Object.entries(advisories)) {
  for (const advisory of pkgAdvisories) {
    totalCount++;
    if (HIGH_SEVERITY.has(advisory.severity)) {
      highCount++;
      console.error(
        `[${advisory.severity.toUpperCase()}] ${pkgName}: ${advisory.title}`,
      );
      console.error(`  Affected: ${advisory.vulnerable_versions}`);
      console.error(`  Details:  ${advisory.url}`);
    }
  }
}

if (totalCount === 0) {
  console.log("No vulnerabilities found.");
} else if (highCount === 0) {
  console.log(
    `${totalCount} low/moderate vulnerabilities found (none at high or critical severity).`,
  );
} else {
  throw new Error(
    `${highCount} high or critical ${highCount === 1 ? "vulnerability" : "vulnerabilities"} found. Resolve before merging.`,
  );
}
