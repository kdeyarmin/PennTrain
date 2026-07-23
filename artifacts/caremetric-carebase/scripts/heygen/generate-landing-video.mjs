#!/usr/bin/env node
// @ts-check
/**
 * Generate the CareMetric CareBase landing-page overview video with HeyGen.
 *
 * This is a deliberate, one-off, CREDIT-SPENDING run-step -- it is NOT wired into
 * the app or CI. It reuses the exact HeyGen v3 request/poll/download contract that
 * the production course-video pipeline already proves out
 * (supabase/functions/generate-course-video/index.ts and
 * supabase/functions/_shared/heygenPolling.ts) but stays fully decoupled from the
 * course_blocks table, RLS, and the private course-videos bucket -- it just writes
 * a plain MP4 into public/marketing/ for the landing hero to embed.
 *
 * Usage:
 *   HEYGEN_API_KEY=xxx node scripts/heygen/generate-landing-video.mjs --list
 *       List available avatars + voices (no video generated, no credits spent).
 *
 *   HEYGEN_API_KEY=xxx HEYGEN_AVATAR_ID=<id> HEYGEN_VOICE_ID=<id> \
 *       node scripts/heygen/generate-landing-video.mjs
 *       Generate the video, poll to completion, and download it (spends credits).
 *
 * Env:
 *   HEYGEN_API_KEY   (required) HeyGen API key. Same key held server-side as the
 *                    Supabase Edge Function secret; never commit it.
 *   HEYGEN_AVATAR_ID (required to generate) avatar "look" id from --list.
 *   HEYGEN_VOICE_ID  (required to generate) voice id from --list.
 *   LANDING_VIDEO_OUT_DIR (optional) output directory; defaults to the app's
 *                    public/marketing/.
 *
 * After it finishes, host the MP4 (public bucket / CDN, or serve the committed
 * public/marketing/landing-overview.mp4) and set VITE_LANDING_VIDEO_URL so the
 * landing hero shows the "Watch the overview" modal.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const HEYGEN_BASE = "https://api.heygen.com";
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 30 * 60_000; // 30 minutes

// Narration -- keep in sync with docs/marketing/landing-video-script.md (the human
// reference). Grounded verbatim in the shipped marketing copy (src/pages/Landing.tsx).
const NARRATION = [
  "Running a Pennsylvania personal care home or assisted living facility means one thing is always true: the state will show up. And when the surveyor walks in, the work isn't the problem — finding the proof is.",
  "Meet CareMetric CareBase — one system that proves your facility is doing its job.",
  "CareBase tracks every training hour, credential, clearance, resident assessment, incident, and inspection your license requires. It assigns the work to the right person, before it's late. And it turns that proof into a binder you can hand straight to the surveyor.",
  "Pass your next survey — every Chapter 2600 and 2800 requirement has its own due date, and the documentation is saved as the work gets done.",
  "Spend less on required training — course builder, AI-assisted lessons, and live class check-in are included, with no per-person fees.",
  "And get your evenings back, because compliance no longer lives in one person's head, or comes home in a bag of binders.",
  "Priced per facility, every module included, with a 30-day free trial — fully self-service, no phone call required.",
  "CareMetric CareBase. Run the facility. See the risk. Prove the work. Start your free trial today at cmcarebase.com.",
].join(" ");

const VIDEO_TITLE = "CareMetric CareBase — Landing Overview";

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function heygenHeaders(apiKey, extra = {}) {
  return { "x-api-key": apiKey, ...extra };
}

async function heygenJson(res) {
  const body = await res.json().catch(() => null);
  return body;
}

async function listOptions(apiKey) {
  const [avatarsRes, voicesRes] = await Promise.all([
    fetch(`${HEYGEN_BASE}/v3/avatars/looks?limit=50`, { headers: heygenHeaders(apiKey) }),
    fetch(`${HEYGEN_BASE}/v3/voices?limit=50`, { headers: heygenHeaders(apiKey) }),
  ]);
  const [avatarsBody, voicesBody] = await Promise.all([heygenJson(avatarsRes), heygenJson(voicesRes)]);
  if (!avatarsRes.ok) fail(`Failed to list avatars: ${avatarsBody?.message ?? avatarsRes.status}`);
  if (!voicesRes.ok) fail(`Failed to list voices: ${voicesBody?.message ?? voicesRes.status}`);

  const avatars = avatarsBody?.data ?? [];
  const voices = voicesBody?.data ?? [];

  console.log(`\nAvatars (${avatars.length}) — pick a professional business look:`);
  for (const a of avatars) {
    console.log(`  ${a.id}\t${a.name ?? ""}${a.gender ? ` (${a.gender})` : ""}`);
  }
  console.log(`\nVoices (${voices.length}) — pick a natural, confident English voice:`);
  for (const v of voices) {
    console.log(`  ${v.voice_id}\t${v.name ?? ""}${v.language ? ` [${v.language}]` : ""}${v.gender ? ` (${v.gender})` : ""}`);
  }
  console.log(
    "\nNext: re-run with HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID set to the ids you chose.\n",
  );
}

// Background compositing: HeyGen's /v3/videos replaces the avatar's recorded
// background when a `background` is supplied (works for photo/instant/video
// avatars alike). Without this, a custom avatar filmed at home keeps that room.
// Default to a clean, on-brand studio color; override with an office image via
// HEYGEN_BACKGROUND_IMAGE_URL (a public HTTPS URL) or a different HEYGEN_BACKGROUND_COLOR.
function resolveBackground() {
  // For photo-avatar "looks" that already have a professional scene baked in,
  // set HEYGEN_NO_BACKGROUND=1 to keep that scene instead of compositing.
  if (process.env.HEYGEN_NO_BACKGROUND === "1") return null;
  const imageUrl = process.env.HEYGEN_BACKGROUND_IMAGE_URL?.trim();
  if (imageUrl) return { type: "image", url: imageUrl };
  const color = process.env.HEYGEN_BACKGROUND_COLOR?.trim() || "#143a5c";
  return { type: "color", value: color };
}

async function startGeneration(apiKey, avatarId, voiceId) {
  console.log("⚠  This request spends HeyGen credits.");
  const background = resolveBackground();
  console.log(`▸ Background: ${background ? (background.type === "image" ? background.url : background.value) : "(keep avatar look's own scene)"}`);
  const payload = {
    type: "avatar",
    avatar_id: avatarId,
    voice_id: voiceId,
    script: NARRATION,
    title: VIDEO_TITLE,
    aspect_ratio: "16:9",
    resolution: "720p",
  };
  if (background) payload.background = background;
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
    if (!res.ok || !body?.data) {
      fail(`Failed to check status: ${body?.message ?? res.status}`);
    }
    const status = body.data.status;
    console.log(`  status: ${status}`);
    if (status === "completed") return body.data;
    if (status === "failed") {
      fail(`HeyGen reported failure: ${body.data.failure_message ?? "video generation failed"}`);
    }
    if (Date.now() > deadline) {
      fail(`Timed out after ${POLL_TIMEOUT_MS / 60_000} minutes waiting for video ${videoId}.`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) fail(`Failed to download ${url} (status ${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, bytes);
  return bytes.length;
}

async function main() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) fail("HEYGEN_API_KEY is not set. Export it before running (never commit it).");

  const listOnly = process.argv.includes("--list");
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;

  if (listOnly) {
    await listOptions(apiKey);
    return;
  }
  if (!avatarId || !voiceId) {
    await listOptions(apiKey);
    fail("Set HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID (see the list above), then re-run.");
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = process.env.LANDING_VIDEO_OUT_DIR
    ? path.resolve(process.env.LANDING_VIDEO_OUT_DIR)
    : path.resolve(here, "../../public/marketing");
  await fs.mkdir(outDir, { recursive: true });

  const videoId = await startGeneration(apiKey, avatarId, voiceId);
  console.log("▸ Polling for completion (this usually takes a few minutes)...");
  const data = await pollUntilDone(apiKey, videoId);

  const mp4Path = path.join(outDir, "landing-overview.mp4");
  const bytes = await download(data.video_url, mp4Path);
  console.log(`✔ Saved ${(bytes / 1_048_576).toFixed(1)} MB → ${mp4Path}`);

  const thumbUrl = data.thumbnail_url ?? data.cover_image_url;
  if (thumbUrl) {
    const posterPath = path.join(outDir, "landing-overview-poster.jpg");
    await download(thumbUrl, posterPath);
    console.log(`✔ Saved poster → ${posterPath}`);
  }

  console.log(
    "\nDone. Next steps:\n" +
      "  1. Host the MP4 (public bucket / CDN) or serve it from public/.\n" +
      "  2. Set VITE_LANDING_VIDEO_URL to its URL (and optionally\n" +
      "     VITE_LANDING_VIDEO_POSTER_URL) so the landing hero shows the\n" +
      "     'Watch the overview' modal.\n",
  );
}

main().catch((err) => fail(err?.stack ?? String(err)));
