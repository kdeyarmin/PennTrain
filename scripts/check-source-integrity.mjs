import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const git = process.platform === "win32" ? "git.exe" : "git";
const listed = spawnSync(git, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "buffer",
  maxBuffer: 50 * 1024 * 1024,
});

if (listed.error || listed.status !== 0 || !Buffer.isBuffer(listed.stdout)) {
  process.stderr.write(listed.stderr?.toString() || listed.error?.message || "Unable to list source files.\n");
  process.exit(1);
}

const paths = listed.stdout.toString("utf8").split("\0").filter(Boolean);
const conflictMarker = /^(<{7}|={7}|>{7})(?:\s|$)/;
const productionSourcePrefixes = [
  "artifacts/caremetric-carebase/src/",
  "artifacts/caremetric-carebase/server/",
  "scripts/",
  "supabase/functions/",
];
const mockupSandboxReference = /(?:artifacts\/mockup-sandbox|@workspace\/mockup-sandbox|mockup-sandbox)/;
const failures = [];

for (const path of paths) {
  const bytes = await readFile(path);
  // A NUL byte is a reliable signal that the source file is binary. Avoid
  // decoding generated PDFs/images while still scanning every text format,
  // including SQL and Markdown files that TypeScript cannot protect.
  if (bytes.includes(0)) continue;
  const lines = bytes.toString("utf8").split(/\r?\n/);
  const isProductionSource = productionSourcePrefixes.some((prefix) => path.startsWith(prefix));
  lines.forEach((line, index) => {
    if (conflictMarker.test(line)) failures.push(`${path}:${index + 1}: ${line.trim()}`);
    if (isProductionSource && mockupSandboxReference.test(line)) {
      failures.push(`${path}:${index + 1}: production source must not reference artifacts/mockup-sandbox`);
    }
  });
}

if (failures.length) {
  process.stderr.write(`Source integrity violations found:\n${failures.map((line) => `- ${line}`).join("\n")}\n`);
  process.exit(1);
}

console.log(`Source integrity check passed (${paths.length} source files scanned).`);
