// Audit all packages in pnpm-lock.yaml against the npm bulk advisory database.
//
// pnpm audit uses the retired npm legacy audit endpoint (/-/npm/v1/security/audits,
// which now returns 410). This script calls the replacement bulk advisory endpoint
// (/-/npm/v1/security/advisories/bulk) directly so it works regardless of which
// pnpm version is installed.
import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";

// Extract package name→versions from the `packages:` block of pnpm-lock.yaml.
// That block lists every resolved package as:
//
//   'package-name@x.y.z':
//     resolution: ...
//
// Scoped packages start with @, so the *last* @ in the key separates name from version.
// We stop at the `snapshots:` block, which reuses the same syntax with peer-dep
// suffixes like '@scope/name@x.y.z(peer@v):' that would produce bogus version strings.
function parsePackagesFromLockfile(content) {
  const packagesMatch = /(^|\n)packages:\n/.exec(content);
  if (!packagesMatch) {
    throw new Error("pnpm-lock.yaml is missing a top-level packages: section.");
  }
  const packagesStart = packagesMatch.index + packagesMatch[1].length;
  const snapshotsMatch = /(^|\n)snapshots:\n/.exec(content);
  const snapshotsStart = snapshotsMatch ? snapshotsMatch.index + snapshotsMatch[1].length : -1;
  const section =
    snapshotsStart === -1
      ? content.slice(packagesStart)
      : content.slice(packagesStart, snapshotsStart);

  const map = new Map(); // package name → Set<version>
  // Lines look like:  '(@scope/)?name@semver':
  for (const match of section.matchAll(/^  '(.+)@([^@'(]+)':/gm)) {
    const name = match[1];
    const version = match[2];
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(version);
  }
  return map;
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
const packages = parsePackagesFromLockfile(lockfileContent);

if (packages.size === 0) {
  console.log("No packages found in pnpm-lock.yaml.");
  process.exit(0);
}

console.log(
  `Auditing ${packages.size} packages against the npm advisory database…`,
);

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
