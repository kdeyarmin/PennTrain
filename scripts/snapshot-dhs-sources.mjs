// Records a content digest for every PA DHS source the forms library links to.
//
// WHAT THIS IS FOR, and what it deliberately is not. check-dhs-sources.mjs asks whether each link
// still resolves; it issues a HEAD (or a 1 KB range) and never reads the document. So a form whose
// content was replaced last month passes it. The thing that actually protects the product is a
// human reading the forms and re-stamping DHS_FORMS_LAST_VERIFIED -- and that review went stale
// (H12) largely because it is 35 PDFs every 45 days with no way to tell which, if any, moved.
//
// This records a SHA-256 of each source's bytes so the NEXT review is "these three changed" rather
// than "read all thirty-five", and each source's origin Last-Modified so the review that is
// ALREADY overdue can be scoped too -- the digests only speak from the previous digest forward,
// and pa.gov's write times reach back behind it. Neither is, or may become, the attestation:
//
//   * the digest file records when the DIGEST was taken, which is a different date from when a
//     human last confirmed the forms, and both are printed;
//   * a first digest taken today says nothing about the 54 days before it -- the forms could have
//     changed at any point in that window and the digest would not know. Last-Modified narrows
//     that window but does not close it: it is a write time on the url as it stands, blind to a
//     form superseded at a different url;
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
const attested = (await readFile(FORMS_PATH, "utf8"))
  .match(/DHS_FORMS_LAST_VERIFIED\s*=\s*"(\d{4}-\d{2}-\d{2})"/)?.[1] ?? null;

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
  return { formUrls, citationUrls, all: [...formUrls, ...citationUrls].sort() };
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
      const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
      return {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
        // When the origin last wrote these bytes, where the origin says. pa.gov's document store
        // does; the pacodeandbulletin.gov pages do not. null has to keep meaning "unknown" and
        // must never collapse into "unchanged" -- see the modified-since report below.
        lastModified: Number.isFinite(lastModified) ? new Date(lastModified).toISOString() : null,
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

const { formUrls, citationUrls, all: urls } = await sourceUrls();
const formUrlSet = new Set(formUrls);
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

// A change to a FORM is the signal; a change to a chapter table of contents is not.
//
// What decides that is whether the forms library links the url, NOT whether it ends in .pdf. The
// extension is a tempting proxy and it is wrong for exactly one entry: "Application for Licensure"
// is a DhsForm the product puts in front of users, and it is a web page. Keying off .pdf files it
// in with the 55 Pa. Code TOCs as navigation, which would let the one form that is a page change
// without the report ever saying so.
//
// So there are three kinds, and each is reported as what it is:
//
//   * FORM DOCUMENT -- a form served as a PDF. Bytes and write time are reliable evidence here.
//   * FORM PAGE -- a form served as a web page. It is a form, so it is never called navigation;
//     but it carries site chrome and its bytes and write time move on their own, so a diff on it
//     is not evidence either way and the reviewer has to open it.
//   * PAGE -- a citation table of contents. Navigation. One of these also returns different bytes
//     to different HTTP clients at identical length, and a report that is usually wrong is one the
//     reviewer learns to skip, which is how this review went stale in the first place.
const isPdf = (url) => /\.pdf(?:$|\?)/i.test(url);
const isFormDocument = (url) => formUrlSet.has(url) && isPdf(url);
const isFormPage = (url) => formUrlSet.has(url) && !isPdf(url);

const changedDocuments = [];
const changedFormPages = [];
const changedPages = [];
const added = [];
for (const url of Object.keys(current).sort()) {
  const before = previous.sources?.[url];
  if (!before) added.push(url);
  else if (before.sha256 !== current[url].sha256) {
    if (isFormDocument(url)) changedDocuments.push(url);
    else if (isFormPage(url)) changedFormPages.push(url);
    else changedPages.push(url);
  }
}
const removed = Object.keys(previous.sources ?? {}).filter((url) => !urls.includes(url));

process.stdout.write(`Digested ${Object.keys(current).length}/${urls.length} source(s).\n`);
if (previous.takenAt) process.stdout.write(`Previous digest taken ${previous.takenAt}.\n`);
for (const url of added) process.stdout.write(`NEW       ${url}\n`);
for (const url of changedDocuments) process.stdout.write(`CHANGED   ${url}\n`);
for (const url of changedFormPages) process.stdout.write(`FORM PAGE ${url}\n`);
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
if (changedFormPages.length) {
  process.stdout.write(
    `${changedFormPages.length} FORM PAGE(S) changed. A form served as a web page carries site `
    + "chrome that moves on its own, so this is not proof the form did -- but it is a form, not "
    + "navigation, and nothing here can tell the two apart. Open it.\n",
  );
}
if (changedPages.length) {
  process.stdout.write(
    `${changedPages.length} table-of-contents page(s) changed. These carry navigation and change `
    + "routinely; a change here is not evidence a form moved.\n",
  );
}

// What the ORIGIN says about the window the digests cannot cover.
//
// The digest diff can only speak from the previous digest forward. On the run that establishes a
// baseline it therefore says nothing at all -- and that is exactly the run where a lapsed
// attestation needs scoping. pa.gov's document store sends Last-Modified on every form PDF, so
// the origin can speak about the window BEFORE the first digest: it is when those bytes were last
// written, which the digest file was not around to observe.
//
// Read it the same way as a digest, and no further:
//
//   * it is a WRITE time, so re-uploading identical bytes reads as modified. That error runs in
//     the safe direction -- it over-reports, and the reviewer reads a document that turns out
//     unchanged;
//   * it cannot see a form superseded at a DIFFERENT url while this one keeps serving the bytes
//     it always had. Neither can the digest. Only a person against the DHS index can;
//   * a source that sends no Last-Modified is UNKNOWN and prints as such. It is never counted
//     among the unmodified;
//   * it reports the form PDFs only. The licensing landing page and the chapter TOCs are pages by
//     the same rule the digest diff uses above, and their write times track the site rather than a
//     form, so counting them would only dilute the number. Every printed count says PDFs so the
//     report is never read as covering all 35 form sources.
//
// So this scopes the reading. It is not the reading, and it re-stamps nothing.
const cutoff = attested ? Date.parse(`${attested}T00:00:00Z`) : NaN;
// Built from the urls the library LISTS, not from the ones that answered. A pdf whose fetch
// exhausted its retries is absent from `current`, and counting only what came back would shrink
// the denominator and let the run still conclude the set is static -- about a form it never read.
// It lands in `unknown` below instead, which both prints it and withholds that conclusion.
const documents = formUrls.filter(isPdf).sort();
const formPages = formUrls.filter((url) => !isPdf(url)).sort();
if (Number.isFinite(cutoff) && documents.length) {
  const writeTime = (url) => Date.parse(current[url]?.lastModified ?? "");
  const modified = documents.filter((url) => Number.isFinite(writeTime(url)) && writeTime(url) > cutoff);
  const unknown = documents.filter((url) => !Number.isFinite(writeTime(url)));
  const known = documents.filter((url) => Number.isFinite(writeTime(url)));
  const newest = known.length ? new Date(Math.max(...known.map(writeTime))).toISOString().slice(0, 10) : null;

  process.stdout.write(
    `\nOrigin write times for the ${documents.length} form PDF(s), against the ${attested} attestation:\n`,
  );
  for (const url of modified) process.stdout.write(`MODIFIED  ${current[url].lastModified.slice(0, 10)}  ${url}\n`);
  for (const url of unknown) {
    process.stdout.write(`UNKNOWN   ${current[url] ? "no Last-Modified" : "fetch failed    "}  ${url}\n`);
  }
  process.stdout.write(
    `${modified.length}/${documents.length} form PDF(s) written since ${attested}`
    + `${unknown.length ? `, ${unknown.length} unknown (not read, or no Last-Modified)` : ""}.`
    + `${newest ? ` Newest write across those PDFs: ${newest}.` : ""}\n`,
  );
  if (modified.length) {
    process.stdout.write("Those are the form PDFs a re-attestation has to read.\n");
  } else if (!unknown.length) {
    process.stdout.write(
      `The origin reports no form PDF written since the attestation date, so the reading is those `
      + `${documents.length} confirmed static rather than any one of them re-read. That is evidence `
      + "for scoping the review, NOT the review: it cannot see a form replaced at another url, and "
      + "only a person re-stamps DHS_FORMS_LAST_VERIFIED.\n",
    );
  }
  if (formPages.length) {
    process.stdout.write(
      `Not covered above: ${formPages.length} form source(s) served as web pages, whose write time `
      + "tracks the site rather than the form and is therefore no evidence about either. They are "
      + "forms, so the review opens them by hand:\n",
    );
    for (const url of formPages) process.stdout.write(`FORM PAGE ${url}\n`);
  }
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
      note: "Content digests and origin write times for the PA DHS form and citation sources. "
        + "Taken by scripts/snapshot-dhs-sources.mjs so a human re-attestation can be scoped to "
        + "what actually changed. lastModified is the origin's Last-Modified, null where the "
        + "origin sends none -- null means unknown, never unchanged. NOT an attestation: see "
        + "dhsFormsLibrary.ts DHS_FORMS_LAST_VERIFIED and paRegulatoryCitations.ts "
        + "PA_CITATIONS_LAST_VERIFIED for that, and BACKLOG.md H12.",
      sources: Object.fromEntries(Object.keys(current).sort().map((url) => [url, current[url]])),
    }, null, 2)}\n`);
    process.stdout.write(`Wrote ${DIGEST_PATH}.\n`);
  }
}
if (errors.length) process.exitCode = 1;
