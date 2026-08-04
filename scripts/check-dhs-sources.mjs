import { readFile } from "node:fs/promises";

const libraryPath = "artifacts/caremetric-carebase/src/lib/dhsFormsLibrary.ts";
const source = await readFile(libraryPath, "utf8");
const urls = [...new Set([...source.matchAll(/url:\s*"(https:\/\/www\.pa\.gov\/[^\"]+)"/g)].map((match) => match[1]))];
const verified = source.match(/DHS_FORMS_LAST_VERIFIED\s*=\s*"(\d{4}-\d{2}-\d{2})"/)?.[1];
const maxAgeDays = Number(process.env.DHS_SOURCE_MAX_AGE_DAYS || 45);

if (!verified) throw new Error("DHS_FORMS_LAST_VERIFIED is missing or malformed.");
if (urls.length < 30) throw new Error(`Expected at least 30 official PA source links; found ${urls.length}.`);

const ageDays = Math.floor((Date.now() - new Date(`${verified}T00:00:00Z`).getTime()) / 86_400_000);
const failures = [];
if (ageDays > maxAgeDays) failures.push(`Human source review is stale: ${ageDays} days since ${verified} (limit ${maxAgeDays}).`);

// Regulatory citation library (55 Pa. Code chapter TOC pages on pacodeandbulletin.gov). Resolve
// every `sourceUrl` a citation entry actually uses -- rather than hardcoding the two known
// PA_CODE_2600/PA_CODE_2800 constant names -- so a future citation entry pointing at a new
// constant (or a new inline URL literal) is picked up without editing this script.
const citationsPath = "artifacts/caremetric-carebase/src/lib/paRegulatoryCitations.ts";
const citationsSource = await readFile(citationsPath, "utf8");
const citationConstants = new Map(
  [...citationsSource.matchAll(/const\s+(\w+)\s*=\s*"(https:\/\/[^"]+)"/g)].map((match) => [match[1], match[2]]),
);
const citationUrls = [
  ...new Set(
    [...citationsSource.matchAll(/sourceUrl:\s*(?:"([^"]+)"|(\w+))/g)]
      .map((match) => match[1] ?? citationConstants.get(match[2]))
      .filter((url) => url && /^https:\/\/www\.pacodeandbulletin\.gov\//.test(url)),
  ),
];
const citationVerified = citationsSource.match(/PA_CITATIONS_LAST_VERIFIED\s*=\s*"(\d{4}-\d{2}-\d{2})"/)?.[1];
const citationMaxAgeDays = Number(citationsSource.match(/CITATION_REVIEW_MAX_AGE_DAYS\s*=\s*(\d+)/)?.[1]);

if (!citationVerified) throw new Error("PA_CITATIONS_LAST_VERIFIED is missing or malformed.");
if (!Number.isFinite(citationMaxAgeDays)) throw new Error("CITATION_REVIEW_MAX_AGE_DAYS is missing or malformed.");
if (citationUrls.length < 1) throw new Error(`Expected at least 1 official PA regulation source link; found ${citationUrls.length}.`);

const citationAgeDays = Math.floor((Date.now() - new Date(`${citationVerified}T00:00:00Z`).getTime()) / 86_400_000);
if (citationAgeDays > citationMaxAgeDays) failures.push(`Citation source review is stale: ${citationAgeDays} days since ${citationVerified} (limit ${citationMaxAgeDays}).`);

async function inspect(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal, headers: { "user-agent": "CareMetric-source-monitor/1.0" } });
      if (response.status === 405 || response.status === 403) response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "CareMetric-source-monitor/1.0", range: "bytes=0-1023" } });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (/\.pdf(?:$|\?)/i.test(url) && contentType && !/application\/pdf|application\/octet-stream/i.test(contentType)) throw new Error(`expected PDF but received ${contentType}`);
      return { url, finalUrl: response.url, status: response.status, contentType };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

const queue = [...urls, ...citationUrls];
const results = [];
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    const url = queue.shift();
    try { results.push(await inspect(url)); }
    catch (error) { failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}));

for (const result of results.sort((a, b) => a.url.localeCompare(b.url))) {
  process.stdout.write(`OK ${result.status} ${result.url}${result.finalUrl !== result.url ? ` -> ${result.finalUrl}` : ""}\n`);
}
const citationUrlSet = new Set(citationUrls);
const formResults = results.filter((result) => !citationUrlSet.has(result.url));
const citationResults = results.filter((result) => citationUrlSet.has(result.url));
process.stdout.write(`Checked ${formResults.length}/${urls.length} PA DHS source links; human verification age ${ageDays} day(s).\n`);
process.stdout.write(`Checked ${citationResults.length}/${citationUrls.length} PA regulatory citation source links; human verification age ${citationAgeDays} day(s).\n`);
if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
}
