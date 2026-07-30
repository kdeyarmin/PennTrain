import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname } from "node:path";

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

// Extensions whose contents are legitimately binary. A NUL byte in anything else is a defect
// rather than a reason to stop looking -- see the skip logic below.
const BINARY_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".avif", ".bmp",
  ".pdf", ".mp4", ".webm", ".mov", ".mp3", ".wav",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".gz", ".br", ".wasm",
]);

const failures = [];
let scanned = 0;
let skippedBinary = 0;

for (const path of paths) {
  const bytes = await readFile(path);
  // A NUL byte means this file cannot be read as text. For a real asset that is expected and the
  // file is skipped. For anything else it is a defect worth failing on, because the consequences
  // are silent and compounding: git renders the file as "Binary files differ" so changes to it are
  // invisible in review, grep reports "binary file matches" instead of the line, and -- the reason
  // this rule exists -- the `continue` below used to drop the file from every check in this script
  // while the summary still counted it as scanned.
  //
  // That is not hypothetical. scripts/check-database-types-format.mjs carried two literal NUL
  // bytes as a join separator, and was silently exempt from the conflict-marker, mockup-sandbox
  // and detached-supabase-method rules for as long as it did. Writing the separator as the "\0"
  // escape is byte-identical at runtime and keeps the file text.
  //
  // An unrecognized binary type fails rather than passes; adding its extension above is a
  // deliberate act, which is the right direction for a rule about invisible files.
  if (bytes.includes(0)) {
    if (BINARY_ASSET_EXTENSIONS.has(extname(path).toLowerCase())) {
      skippedBinary += 1;
      continue;
    }
    failures.push(
      `${path}: contains NUL byte(s), so git diffs it as binary, grep skips it, and this check `
      + `cannot read it. If a NUL is intended (e.g. a join separator), write it as the "\\0" `
      + `escape instead of a literal byte. If the file really is a binary asset, add its `
      + `extension to BINARY_ASSET_EXTENSIONS.`,
    );
    continue;
  }
  scanned += 1;
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

// Report what was actually read, not how many paths git listed. The previous wording counted
// binary skips as scanned, which is the same overstatement this script now guards against.
console.log(
  `Source integrity check passed (${scanned} source file(s) scanned, `
  + `${skippedBinary} binary asset(s) skipped).`,
);
