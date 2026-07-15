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

const queue = [...urls];
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
process.stdout.write(`Checked ${results.length}/${urls.length} PA DHS source links; human verification age ${ageDays} day(s).\n`);
if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
}
