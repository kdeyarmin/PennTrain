#!/usr/bin/env node
// @ts-check
/**
 * Render the CareBase presenter segments with HeyGen and report the video ids
 * a course migration needs.
 *
 * A deliberate, CREDIT-SPENDING run-step -- not wired into the app or CI.
 * Unlike generate-landing-video.mjs (which downloads an MP4 for a marketing
 * page), this does NOT download anything: course video blocks are re-hosted by
 * the poll-heygen-video-statuses cron, which writes the file to
 * course-videos/system/<block_id>.mp4 and fills in video_url. All this script
 * owes you is a video id per script file, plus the size check that decides
 * whether that re-host will succeed.
 *
 * Usage:
 *   HEYGEN_API_KEY=xxx node scripts/heygen/render-course-videos.mjs            # every inservice-*-N.txt
 *   HEYGEN_API_KEY=xxx node scripts/heygen/render-course-videos.mjs a.txt b.txt
 *   ... --dry-run    price the run and check script lengths without spending
 *
 * Env:
 *   HEYGEN_API_KEY  (required) never commit it
 *   HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID  (optional) override the defaults below
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HEYGEN_BASE = "https://api.heygen.com";

// The CareBase presenter. Keep these in lockstep with scripts/README.md -- the
// account holds several Kevin-named voices and only this one is the avatar voice.
const AVATAR_ID = process.env.HEYGEN_AVATAR_ID || "3fd2086f9f31438cb28ae57134b6affa";
const VOICE_ID = process.env.HEYGEN_VOICE_ID || "e27fe997edb94c61b755e8f4c563fe5b";

const MAX_SCRIPT_CHARS = 5000; // HeyGen rejects input_text above this
const REHOST_CEILING_MB = 50; // storage upload has failed above roughly this
const MB_PER_SECOND = 0.27; // observed at HeyGen's default resolution
const CHARS_PER_SECOND = 17.5; // observed speaking rate for this voice
const POLL_INTERVAL_MS = 20_000;
const POLL_TIMEOUT_MS = 30 * 60_000;

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "scripts");

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function resolveScripts(args) {
  if (args.length) return args.map((a) => path.resolve(a));
  const entries = await fs.readdir(SCRIPT_DIR);
  return entries
    .filter((f) => /^inservice-.*-\d\.txt$/.test(f))
    .sort()
    .map((f) => path.join(SCRIPT_DIR, f));
}

async function inspect(file) {
  const script = (await fs.readFile(file, "utf8")).trim();
  const seconds = Math.round(script.length / CHARS_PER_SECOND);
  return { file, name: path.basename(file, ".txt"), script, seconds, mb: +(seconds * MB_PER_SECOND).toFixed(1) };
}

async function start(job) {
  const res = await fetch(`${HEYGEN_BASE}/v3/videos`, {
    method: "POST",
    headers: { "x-api-key": process.env.HEYGEN_API_KEY, "Content-Type": "application/json" },
    // No resolution override on purpose: 1080p produced a 134MB file for a
    // 4.7-minute script, far past what the storage re-host accepts.
    body: JSON.stringify({
      type: "avatar",
      avatar_id: AVATAR_ID,
      voice_id: VOICE_ID,
      script: job.script,
      title: `CareBase — ${job.name}`,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.data?.video_id) {
    return { error: body?.error?.message ?? body?.message ?? `HTTP ${res.status}` };
  }
  return { videoId: body.data.video_id };
}

async function check(videoId) {
  const res = await fetch(`${HEYGEN_BASE}/v3/videos/${videoId}`, {
    headers: { "x-api-key": process.env.HEYGEN_API_KEY },
  });
  const data = (await res.json().catch(() => null))?.data;
  if (data?.status === "completed") {
    const head = await fetch(data.video_url, { method: "HEAD" });
    const bytes = Number(head.headers.get("content-length") || 0);
    return { status: "completed", seconds: Math.round(data.duration || 0), mb: +(bytes / 1048576).toFixed(1) };
  }
  if (data?.status === "failed") {
    return { status: "failed", reason: data.failure_code || data.failure_message || "unknown" };
  }
  return { status: data?.status ?? "unknown" };
}

async function main() {
  if (!process.env.HEYGEN_API_KEY) fail("HEYGEN_API_KEY is not set.");
  const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
  const dryRun = process.argv.includes("--dry-run");

  const files = await resolveScripts(args);
  if (!files.length) fail(`No scripts matched. Looked in ${SCRIPT_DIR}`);
  const jobs = await Promise.all(files.map(inspect));

  console.log(`\nAvatar ${AVATAR_ID}\nVoice  ${VOICE_ID}\n`);
  let blocked = false;
  for (const job of jobs) {
    const tooLong = job.script.length > MAX_SCRIPT_CHARS;
    const tooBig = job.mb > REHOST_CEILING_MB - 5;
    if (tooLong || tooBig) blocked = true;
    const flag = tooLong ? "  ✖ over the 5000-char API limit" : tooBig ? "  ✖ projected file will not re-host" : "";
    console.log(`  ${job.name.padEnd(34)} ${String(job.script.length).padStart(4)} chars  ~${job.seconds}s  ~${job.mb}MB${flag}`);
  }
  if (blocked) fail("Fix the flagged scripts before spending credits.");
  // Observed cost is roughly 400 credits per two-and-a-half-minute segment.
  // Checking up front matters: a batch that runs dry mid-flight leaves the
  // remaining segments failed with MOVIO_PAYMENT_INSUFFICIENT_CREDIT, and the
  // credits already spent on the ones that got through are not recoverable.
  const CREDITS_PER_SEGMENT = 400;
  const needed = jobs.length * CREDITS_PER_SEGMENT;
  const quotaRes = await fetch(`${HEYGEN_BASE}/v2/user/remaining_quota`, {
    headers: { "x-api-key": process.env.HEYGEN_API_KEY },
  });
  const quota = (await quotaRes.json().catch(() => null))?.data?.remaining_quota;
  console.log(`\n${jobs.length} segment(s), roughly ${needed} credits. Balance: ${quota ?? "unknown"}.\n`);
  if (typeof quota === "number" && quota < needed) {
    fail(`Not enough credits for the whole batch. Top up, or pass just the files you want rendered now.`);
  }
  if (dryRun) return;

  // Submit the whole batch first, then poll. HeyGen renders these in parallel,
  // so submit-then-wait per segment would turn a ten-minute batch into hours.
  const rendered = {};
  const failures = [];
  const inFlight = new Map();
  for (const job of jobs) {
    const { videoId, error } = await start(job);
    if (error) { console.log(`  ✖ ${job.name}: submit failed: ${error}`); failures.push(job.name); continue; }
    inFlight.set(job.name, videoId);
    console.log(`  ▸ ${job.name} queued as ${videoId}`);
  }
  console.log(`\nWaiting on ${inFlight.size} render(s)...\n`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (inFlight.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    for (const [name, videoId] of [...inFlight]) {
      const result = await check(videoId);
      if (result.status === "completed") {
        inFlight.delete(name);
        rendered[name] = videoId;
        const warn = result.mb > REHOST_CEILING_MB - 5 ? "  ⚠ close to the re-host ceiling" : "";
        console.log(`  ✔ ${name.padEnd(34)} ${videoId}  ${result.seconds}s  ${result.mb}MB${warn}`);
      } else if (result.status === "failed") {
        inFlight.delete(name);
        failures.push(name);
        console.log(`  ✖ ${name.padEnd(34)} ${result.reason}`);
      }
    }
  }
  for (const name of inFlight.keys()) { failures.push(name); console.log(`  ✖ ${name}: timed out`); }

  const out = path.resolve("rendered-segments.json");
  await fs.writeFile(out, JSON.stringify(rendered, null, 2));
  console.log(`\n${Object.keys(rendered).length} rendered, ${failures.length} failed. Ids written to ${out}`);
  if (failures.length) {
    console.log(`Failed: ${failures.join(", ")}`);
    console.log("MOVIO_PAYMENT_INSUFFICIENT_CREDIT means the balance ran out mid-batch; top up and re-run just those files.");
  }
}

main();
