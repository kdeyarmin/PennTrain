// Records a content digest for every PA DHS source the forms library links to.
//
// WHAT THIS IS FOR, and what it deliberately is not. check-dhs-sources.mjs asks whether each link
// still resolves; it issues a HEAD (or a 1 KB range) and never reads the document. So a form whose
// content was replaced last month passes it. The thing that actually protects the product is a
// human reading the forms and re-stamping DHS_FORMS_LAST_VERIFIED -- and that review went stale
// (H12) largely because it is 35 PDFs every 45 days with no way to tell which, if any, moved.
//
// This records a SHA-256 of each source's bytes so the NEXT review is "these three changed" rather
// than "read all thirty-five". It is not, and must not become, a substitute for the attestation:
//
//   * the digest file records when the DIGEST was taken, which is a different date from when a
//     human last confirmed the forms, and both are printed;
//   * a first digest taken today says nothing about the 54 days before it -- the forms could have
//     changed at any point in that window and this would not know;
//   * check-dhs-sources.mjs still fails on the attestation's age regardless of what the digests
//     say. Re-stamping on the strength of "no bytes changed" would be exactly the laundering
//     record_citation_verification exists to prevent.
//
// Run: node scripts/snapshot-dhs-sources.mjs [--write]
// Without --write it reports the diff and changes nothing.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const DIGEST_PATH = "docs/ops/dhs-source-digests.json";
const FORMS_PATH = "artifacts/caremetric-carebase/src/lib/dhsFormsLibrary.ts";
const CITATIONS_PATH = "artifacts/caremetric-carebase/src/lib/paRegulatoryCitations.ts";
const write = process.argv.includes("--write");

async function sourceUrls() {
  const forms = await readFile(FORMS_PATH, "utf8");
  const formUrls = [...new Set(
    [...forms.matchAll(/url:\s*"(https:\/\/www\.pa\.gov\/[^"]+)"/g)].map((m) => m[1]),
  )];
  const citations = await readFile(CITATIONS_PATH, "utf8");
  const constants = new Map(
    [...citations.matchAll(/const\s+(\w+)\s*=\s*"(https:\/\/[^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const citationUrls = [...new Set(
    [...citations.matchAll(/sourceUrl:\s*(?:"([^"]+)"|(\w+))/g)]
      .map((m) => m[1] ?? constants.get(m[2]))
      .filter((url) => url && /^https:\/\/www\.pacodeandbulletin\.gov\//.test(url)),
  )];
  return [...formUrls, ...citationUrls].sort();
}

async function digest(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "CareMetric-source-monitor/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 750));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

let previous = { takenAt: null, sources: {} };
try {
  previous = JSON.parse(await readFile(DIGEST_PATH, "utf8"));
} catch {
  // First run. Everything below reads as "new", which is the honest description.
}

const urls = await sourceUrls();
const queue = [...urls];
const current = {};
const errors = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const url = queue.shift();
    try { current[url] = await digest(url); }
    catch (error) { errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}));

// A change to a FORM is the signal; a change to an index or a chapter table of contents is not.
//
// Two of these sources are HTML -- the licensing landing page and the 55 Pa. Code chapter TOCs --
// and they carry site navigation, banners and, on at least one, bytes that differ between HTTP
// clients at identical length. Reporting those beside the PDFs would produce a "changed" line on
// most runs, and a report that is usually wrong is one the reviewer learns to skip, which is how
// this review went stale in the first place. They are still digested and still reported; they are
// just reported as what they are.
const isDocument = (url) => /\.pdf(?:$|\?)/i.test(url);

const changedDocuments = [];
const changedPages = [];
const added = [];
for (const url of Object.keys(current).sort()) {
  const before = previous.sources?.[url];
  if (!before) added.push(url);
  else if (before.sha256 !== current[url].sha256) {
    (isDocument(url) ? changedDocuments : changedPages).push(url);
  }
}
const removed = Object.keys(previous.sources ?? {}).filter((url) => !urls.includes(url));

process.stdout.write(`Digested ${Object.keys(current).length}/${urls.length} source(s).\n`);
if (previous.takenAt) process.stdout.write(`Previous digest taken ${previous.takenAt}.\n`);
for (const url of added) process.stdout.write(`NEW       ${url}\n`);
for (const url of changedDocuments) process.stdout.write(`CHANGED   ${url}\n`);
for (const url of changedPages) process.stdout.write(`PAGE      ${url}\n`);
for (const url of removed) process.stdout.write(`REMOVED   ${url}\n`);
for (const failure of errors) process.stderr.write(`FAIL ${failure}\n`);

if (changedDocuments.length) {
  process.stdout.write(
    `\n${changedDocuments.length} FORM DOCUMENT(S) changed since ${previous.takenAt ?? "the last digest"}. `
    + "Those are the ones a re-attestation has to read.\n",
  );
} else if (previous.takenAt) {
  process.stdout.write(
    "\nNo form document changed since the previous digest. That is NOT an attestation: it says "
    + "nothing about the window before that digest was taken, and the human review still has to "
    + "happen on its own schedule.\n",
  );
}
if (changedPages.length) {
  process.stdout.write(
    `${changedPages.length} index or table-of-contents page(s) changed. These carry navigation and `
    + "change routinely; a change here is not evidence a form moved.\n",
  );
}

if (write) {
  if (errors.length) {
    process.stderr.write("Refusing to write a digest file with sources that could not be read.\n");
    process.exitCode = 1;
  } else {
    await writeFile(DIGEST_PATH, `${JSON.stringify({
      // Read this together with DHS_FORMS_LAST_VERIFIED, never instead of it. This is when the
      // BYTES were recorded; that is when a person last read the forms.
      takenAt: new Date().toISOString().slice(0, 10),
      note: "Content digests for the PA DHS form and citation sources. Taken by "
        + "scripts/snapshot-dhs-sources.mjs so a human re-attestation can be scoped to what "
        + "actually changed. NOT an attestation: see dhsFormsLibrary.ts DHS_FORMS_LAST_VERIFIED "
        + "and paRegulatoryCitations.ts PA_CITATIONS_LAST_VERIFIED for that, and BACKLOG.md H12.",
      sources: Object.fromEntries(Object.keys(current).sort().map((url) => [url, current[url]])),
    }, null, 2)}\n`);
    process.stdout.write(`Wrote ${DIGEST_PATH}.\n`);
  }
}
if (errors.length) process.exitCode = 1;
