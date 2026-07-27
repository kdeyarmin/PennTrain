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
const mockupSandboxReferenceAllowlist = new Set(["scripts/check-source-integrity.mjs"]);
const mockupSandboxReference = /(?:artifacts\/mockup-sandbox|@workspace\/mockup-sandbox|mockup-sandbox)/;
// SupabaseClient.rpc/from/functions are prototype methods whose bodies read `this.rest`, so a
// detached reference throws "Cannot read properties of undefined (reading 'rest')" on every call.
// This shipped in two hooks and broke incident reporting outright; it is invisible to typecheck
// (the cast satisfies it) and to unit tests (they mock the client), so it needs a source rule.
const detachedSupabaseMethod = /=\s*supabase\.(rpc|from|functions|storage)\b(?!\s*\.bind\b)(?!\()/;
const detachedSupabaseMethodAllowlist = new Set(["scripts/check-source-integrity.mjs"]);
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
    if (
      isProductionSource &&
      !mockupSandboxReferenceAllowlist.has(path) &&
      mockupSandboxReference.test(line)
    ) {
      failures.push(`${path}:${index + 1}: production source must not reference artifacts/mockup-sandbox`);
    }
    if (
      isProductionSource &&
      !detachedSupabaseMethodAllowlist.has(path) &&
      detachedSupabaseMethod.test(line)
    ) {
      failures.push(
        `${path}:${index + 1}: supabase client methods lose their receiver when assigned. `
        + `Use supabase.rpc.bind(supabase) (or call it inline) -- a detached reference throws at runtime.`,
      );
    }
  });
}

if (failures.length) {
  process.stderr.write(`Source integrity violations found:\n${failures.map((line) => `- ${line}`).join("\n")}\n`);
  process.exit(1);
}

console.log(`Source integrity check passed (${paths.length} source files scanned).`);
