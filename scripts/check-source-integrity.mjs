import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname } from "node:path";

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

// Safari on iOS, and popup blockers generally, only honour window.open while the browser still
// considers itself inside the user gesture -- and an `await` ends that. Every one of this app's
// thirty-four document opens sits after an await for a signed URL, so on the device an aide is most
// likely holding, the certificate, the class notice, the POC document and the binder export did
// nothing at all: no tab, no error, no download. lib/openDocumentUrl.ts navigates the current tab
// when the open is refused, which is the difference between the document arriving and the button
// appearing broken. This keeps the next one from going back.
const rawWindowOpen = /\bwindow\.open\s*\(/;
const rawWindowOpenAllowlist = new Set([
  "scripts/check-source-integrity.mjs",
  "artifacts/caremetric-carebase/src/lib/openDocumentUrl.ts",
]);

// Extensions whose contents are legitimately binary. A NUL byte in anything else is a defect
// rather than a reason to stop looking -- see the skip logic below.
const BINARY_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".avif", ".bmp",
  ".pdf", ".mp4", ".webm", ".mov", ".mp3", ".wav",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".gz", ".br", ".wasm",
]);

// Comment lines are skipped: ComplianceBinder.tsx explains, in prose, the very bug the window.open
// rule exists for, and a rule that cannot tell an explanation from an occurrence teaches people to
// stop writing the explanations.
//
// The distinction has to be made on where the comment ENDS, not where the line begins. A `//` runs
// to the end of its line, so nothing after it is code. A block comment does not: `/* why */
// window.open(url)` and a continuation line ` */ window.open(url)` both put a live call after the
// comment closes, and a predicate that skipped the whole line because of its first two characters
// walked straight past them. So a block-comment line is prose only when nothing but whitespace
// follows its last `*/`. A gate with a hole in it is worse than no gate, because it is believed.
function isCommentOnlyLine(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) return true;
  if (!trimmed.startsWith("*") && !trimmed.startsWith("/*")) return false;
  const close = line.lastIndexOf("*/");
  return close === -1 || line.slice(close + 2).trim() === "";
}

if (process.argv.includes("--self-test")) {
  const selfTestFailures = [];
  for (const line of [
    "  // this used to call window.open() once per file",
    "   * every browser blocks all but the first window.open(",
    "  /* window.open() is refused once an await has ended the gesture */",
    "   */",
    "  /* an unterminated block opens here",
  ]) {
    if (!isCommentOnlyLine(line)) selfTestFailures.push(`prose read as code: ${line.trim()}`);
  }
  for (const line of [
    "  window.open(url);",
    "  /* why */ window.open(url);",
    "   */ window.open(url);",
    "  /* a */ /* b */ window.open(url);",
  ]) {
    if (isCommentOnlyLine(line)) selfTestFailures.push(`code read as prose: ${line.trim()}`);
    if (!rawWindowOpen.test(line)) selfTestFailures.push(`call not matched: ${line.trim()}`);
  }
  if (selfTestFailures.length > 0) {
    console.error(`Source integrity self-test failed:\n  ${selfTestFailures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Source integrity self-test passed.");
  process.exit(0);
}

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
      !isCommentOnlyLine(line) &&
      !rawWindowOpenAllowlist.has(path) &&
      rawWindowOpen.test(line)
    ) {
      failures.push(
        `${path}:${index + 1}: window.open() after an await is blocked on iOS Safari and the `
        + `document silently never arrives. Use openDocumentUrl() from @/lib/openDocumentUrl.`,
      );
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
