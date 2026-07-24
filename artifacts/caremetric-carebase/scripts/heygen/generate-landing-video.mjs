#!/usr/bin/env node
// @ts-check
/**
 * Generate a CareMetric CareBase marketing video with HeyGen (avatar + voice).
 *
 * A deliberate, one-off, CREDIT-SPENDING run-step -- NOT wired into the app or CI.
 * It reuses the exact HeyGen v3 request/poll/download contract the production
 * course-video pipeline proves out (supabase/functions/generate-course-video and
 * _shared/heygenPolling.ts) but stays decoupled from course_blocks/RLS -- it just
 * writes a plain MP4 + poster into public/marketing/ for a marketing page to embed.
 *
 * Usage:
 *   HEYGEN_API_KEY=xxx node scripts/heygen/generate-landing-video.mjs --list
 *       List avatars + voices (no credits spent).
 *
 *   HEYGEN_API_KEY=xxx HEYGEN_AVATAR_ID=<id> HEYGEN_VOICE_ID=<id> \
 *   SCRIPT_FILE=scripts/heygen/scripts/founder.txt OUTPUT_BASENAME=founder \
 *   HEYGEN_VOICE_PITCH=-6 HEYGEN_VOICE_SPEED=0.92 HEYGEN_NO_BACKGROUND=1 \
 *       node scripts/heygen/generate-landing-video.mjs
 *
 * Env:
 *   HEYGEN_API_KEY          (required) HeyGen key. Never commit it.
 *   HEYGEN_AVATAR_ID        (required) avatar / photo-avatar look id.
 *   HEYGEN_VOICE_ID         (required) voice id.
 *   SCRIPT_FILE             (optional) path to a UTF-8 file with the narration;
 *                           defaults to the built-in landing-overview narration.
 *   OUTPUT_BASENAME         (optional) output file base; default "landing-overview"
 *                           -> public/marketing/<base>.mp4 + <base>-poster.jpg.
 *   VIDEO_TITLE             (optional) HeyGen video title.
 *   HEYGEN_VOICE_PITCH      (optional) semitones -50..50 (negative = deeper).
 *   HEYGEN_VOICE_SPEED      (optional) 0.5..1.5 (below 1 = slower / more pause).
 *   HEYGEN_VOICE_VOLUME     (optional) 0..1.
 *   HEYGEN_NO_BACKGROUND=1  keep a photo-avatar look's own scene (no compositing).
 *   HEYGEN_BACKGROUND_IMAGE_URL / HEYGEN_BACKGROUND_COLOR  otherwise composite.
 *   LANDING_VIDEO_OUT_DIR   (optional) output dir; defaults to public/marketing.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const HEYGEN_BASE = "https://api.heygen.com";
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 30 * 60_000; // 30 minutes

// Default narration -- the landing overview. Kept in sync with
// docs/marketing/landing-video-script.md and grounded in the shipped marketing
// copy (src/pages/Landing.tsx). Other videos pass their own SCRIPT_FILE.
const DEFAULT_NARRATION = [
  "Running a Pennsylvania personal care home or assisted living facility means one thing is always true: the state will show up. And when the surveyor walks in, the work isn't the problem — finding the proof is.",
  "Meet CareMetric CareBase — one system that proves your facility is doing its job.",
  "CareBase tracks every training hour, credential, clearance, resident assessment, incident, and inspection your license requires. It assigns the work to the right person, before it's late. And it turns that proof into a binder you can hand straight to the surveyor.",
  "Pass your next survey — every Chapter 2600 and 2800 requirement has its own due date, and the documentation is saved as the work gets done.",
  "Spend less on required training — course builder, AI-assisted lessons, and live class check-in are included, with no per-person fees.",
  "And get your evenings back, because compliance no longer lives in one person's head, or comes home in a bag of binders.",
  "Priced per facility, every module included, with a 30-day free trial — fully self-service, no phone call required.",
  "CareMetric CareBase. Run the facility. See the risk. Prove the work. Start your free trial today at cmcarebase.com.",
].join(" ");

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function heygenHeaders(apiKey, extra = {}) {
  return { "x-api-key": apiKey, ...extra };
}

async function heygenJson(res) {
  return res.json().catch(() => null);
}

async function listOptions(apiKey) {
  const [avatarsRes, voicesRes] = await Promise.all([
    fetch(`${HEYGEN_BASE}/v3/avatars/looks?limit=50`, { headers: heygenHeaders(apiKey) }),
    fetch(`${HEYGEN_BASE}/v3/voices?limit=50`, { headers: heygenHeaders(apiKey) }),
  ]);
  const [avatarsBody, voicesBody] = await Promise.all([heygenJson(avatarsRes), heygenJson(voicesRes)]);
  if (!avatarsRes.ok) fail(`Failed to list avatars: ${avatarsBody?.message ?? avatarsRes.status}`);
  if (!voicesRes.ok) fail(`Failed to list voices: ${voicesBody?.message ?? voicesRes.status}`);

  console.log(`\nAvatars (${(avatarsBody?.data ?? []).length}):`);
  for (const a of avatarsBody?.data ?? []) console.log(`  ${a.id}\t${a.name ?? ""}${a.gender ? ` (${a.gender})` : ""}`);
  console.log(`\nVoices (${(voicesBody?.data ?? []).length}):`);
  for (const v of voicesBody?.data ?? []) console.log(`  ${v.voice_id}\t${v.name ?? ""}${v.language ? ` [${v.language}]` : ""}${v.gender ? ` (${v.gender})` : ""}`);
  console.log("\nNext: re-run with HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID set.\n");
}

// HeyGen composites onto a new background when one is supplied. For photo-avatar
// looks that already carry a professional scene, set HEYGEN_NO_BACKGROUND=1.
function resolveBackground() {
  if (process.env.HEYGEN_NO_BACKGROUND === "1") return null;
  const imageUrl = process.env.HEYGEN_BACKGROUND_IMAGE_URL?.trim();
  if (imageUrl) return { type: "image", url: imageUrl };
  const color = process.env.HEYGEN_BACKGROUND_COLOR?.trim() || "#143a5c";
  return { type: "color", value: color };
}

// voice_settings: speed 0.5..1.5, pitch -50..50 semitones, volume 0..1.
function resolveVoiceSettings() {
  const s = {};
  if (process.env.HEYGEN_VOICE_SPEED) s.speed = Number(process.env.HEYGEN_VOICE_SPEED);
  if (process.env.HEYGEN_VOICE_PITCH) s.pitch = Number(process.env.HEYGEN_VOICE_PITCH);
  if (process.env.HEYGEN_VOICE_VOLUME) s.volume = Number(process.env.HEYGEN_VOICE_VOLUME);
  return Object.keys(s).length ? s : null;
}

async function startGeneration(apiKey, { avatarId, voiceId, script, title }) {
  console.log("⚠  This request spends HeyGen credits.");
  const background = resolveBackground();
  const voiceSettings = resolveVoiceSettings();
  console.log(`▸ Background: ${background ? (background.type === "image" ? background.url : background.value) : "(keep avatar look's own scene)"}`);
  if (voiceSettings) console.log(`▸ Voice settings: ${JSON.stringify(voiceSettings)}`);
  const payload = {
    type: "avatar",
    avatar_id: avatarId,
    voice_id: voiceId,
    script,
    title,
    aspect_ratio: "16:9",
    resolution: "720p",
  };
  if (background) payload.background = background;
  if (voiceSettings) payload.voice_settings = voiceSettings;
  const res = await fetch(`${HEYGEN_BASE}/v3/videos`, {
    method: "POST",
    headers: heygenHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const body = await heygenJson(res);
  const videoId = body?.data?.video_id;
  if (!res.ok || !videoId) {
    fail(`HeyGen generation request failed: ${body?.message ?? body?.error?.message ?? res.status}`);
  }
  console.log(`▸ Generation started. video_id=${videoId}`);
  return videoId;
}

async function pollUntilDone(apiKey, videoId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${HEYGEN_BASE}/v3/videos/${videoId}`, { headers: heygenHeaders(apiKey) });
    const body = await heygenJson(res);
    if (!res.ok || !body?.data) fail(`Failed to check status: ${body?.message ?? res.status}`);
    const status = body.data.status;
    console.log(`  status: ${status}`);
    if (status === "completed") return body.data;
    if (status === "failed") fail(`HeyGen reported failure: ${body.data.failure_message ?? "video generation failed"}`);
    if (Date.now() > deadline) fail(`Timed out after ${POLL_TIMEOUT_MS / 60_000} minutes waiting for video ${videoId}.`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) fail(`Failed to download ${url} (status ${res.status}).`);
  // Stream the body straight to disk so a large MP4 never sits fully in memory.
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  const { size } = await fs.stat(destPath);
  return size;
}

async function main() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) fail("HEYGEN_API_KEY is not set. Export it before running (never commit it).");

  if (process.argv.includes("--list")) {
    await listOptions(apiKey);
    return;
  }

  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;
  if (!avatarId || !voiceId) {
    await listOptions(apiKey);
    fail("Set HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID (see the list above), then re-run.");
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = process.env.SCRIPT_FILE
    ? (await fs.readFile(path.resolve(process.env.SCRIPT_FILE), "utf8")).trim()
    : DEFAULT_NARRATION;
  const basename = process.env.OUTPUT_BASENAME?.trim() || "landing-overview";
  const title = process.env.VIDEO_TITLE?.trim() || `CareMetric CareBase — ${basename}`;

  const outDir = process.env.LANDING_VIDEO_OUT_DIR
    ? path.resolve(process.env.LANDING_VIDEO_OUT_DIR)
    : path.resolve(here, "../../public/marketing");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`▸ Video: ${basename}  (${script.length} chars of script)`);
  const videoId = await startGeneration(apiKey, { avatarId, voiceId, script, title });
  console.log("▸ Polling for completion (this usually takes a few minutes)...");
  const data = await pollUntilDone(apiKey, videoId);

  const mp4Path = path.join(outDir, `${basename}.mp4`);
  const bytes = await download(data.video_url, mp4Path);
  console.log(`✔ Saved ${(bytes / 1_048_576).toFixed(1)} MB → ${mp4Path}`);

  // HeyGen thumbnails are WEBP; save with the matching extension (the catalog +
  // static server key MIME type off the extension, so a .jpg name would mis-serve).
  const thumbUrl = data.thumbnail_url ?? data.cover_image_url;
  if (thumbUrl) {
    const posterPath = path.join(outDir, `${basename}-poster.webp`);
    await download(thumbUrl, posterPath);
    console.log(`✔ Saved poster → ${posterPath}`);
  }
  console.log("\nDone.\n");
}

main().catch((err) => fail(err?.stack ?? String(err)));
