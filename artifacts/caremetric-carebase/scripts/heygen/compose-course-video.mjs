#!/usr/bin/env node
// @ts-check
/**
 * Compose multi-scene course videos with HeyGen's studio type.
 *
 * A talking head for twenty-five minutes is not a course, and one avatar clip
 * cannot be twenty-five minutes anyway -- the storage re-host that publishes a
 * course video block has failed above roughly 50MB, which caps a single file
 * near three minutes. So a course is a series of blocks, and each block is a
 * studio video: a title or section frame, Kevin, and slides he narrates over.
 *
 * An `image` scene carries its own script, so a slide is a narrated step rather
 * than filler between clips. That is what buys the runtime.
 *
 * Input is a deck spec (see decks/*.json):
 *   {
 *     "course": "PA-DHS-STANDALONE-FALLS-PREVENTION",
 *     "blocks": [
 *       { "id": "falls-b1", "title": "...", "scenes": [
 *           { "type": "slide", "slide": "falls-title", "duration": 4 },
 *           { "type": "avatar", "script": "..." },
 *           { "type": "slide", "slide": "falls-risk-points", "script": "..." }
 *       ]}
 *     ]
 *   }
 *
 * Usage:
 *   node scripts/heygen/compose-course-video.mjs decks/falls-prevention.json --slides DIR [--dry-run]
 */

import fs from "node:fs/promises";
import path from "node:path";

const HEYGEN_BASE = "https://api.heygen.com";
const HEYGEN_UPLOAD = "https://upload.heygen.com/v1/asset";
const AVATAR_ID = process.env.HEYGEN_AVATAR_ID || "3fd2086f9f31438cb28ae57134b6affa";
const VOICE_ID = process.env.HEYGEN_VOICE_ID || "e27fe997edb94c61b755e8f4c563fe5b";

const REHOST_CEILING_MB = 50;
// Avatar footage and slide footage compress nothing alike. Measured: an avatar
// segment runs ~0.27MB/s, while a block of narrated stills came back at
// 4.3MB for 126 seconds -- roughly 0.035MB/s, because the frame barely moves.
// Projecting slides at the avatar rate over-estimated one block by 8x and
// forced a split that was not needed.
const MB_PER_SECOND_AVATAR = 0.27;
const MB_PER_SECOND_SLIDE = 0.04;
const CHARS_PER_SECOND = 17.5;
const POLL_INTERVAL_MS = 20_000;
const POLL_TIMEOUT_MS = 45 * 60_000;
// Credits do not price a slide minute like an avatar minute. These are solved
// from two complete decks rather than guessed -- two measurements for two
// unknowns:
//
//   infection control   8.4 avatar + 14.5 slide  =  2,353 credits
//   safe management     9.0 avatar + 14.2 slide  =  2,459 credits
//
// which gives 199.9 and 46.5, and reproduces both totals to the credit. The
// earlier single blended rate of 178/min came off an avatar-only render and
// over-projected infection control by 72%.
//
// Re-derive these if HeyGen changes pricing: the balance before and after any
// deck plus its avatar/slide split is one equation, and two decks pin it down.
const CREDITS_PER_MINUTE_AVATAR = 200;
const CREDITS_PER_MINUTE_SLIDE = 47;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const SCRIPT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "scripts");

/**
 * A scene's narration, from `script` or from a file in scripts/. Reusing the
 * existing segment files keeps one source of truth for narration that is
 * already written, reviewed, and rendered.
 */
async function sceneScript(scene) {
  if (scene.scriptFile) return (await fs.readFile(path.join(SCRIPT_DIR, scene.scriptFile), "utf8")).trim();
  return scene.script?.trim() ?? null;
}

/** Projected seconds for one scene: narration time, or the still's own duration. */
function sceneSeconds(scene, script) {
  if (script) return script.length / CHARS_PER_SECOND;
  return scene.duration ?? 4;
}

async function sceneToHeygen(scene, slideDir, cache) {
  const script = await sceneScript(scene);
  if (scene.type === "avatar") {
    return {
      type: "avatar_video",
      input: {
        type: "avatar",
        avatar_id: AVATAR_ID,
        voice_id: VOICE_ID,
        script,
      },
    };
  }
  if (scene.type === "slide") {
    // Studio scenes reject inline base64 -- the image has to be an uploaded
    // asset. Uploads are cached per slide id, so a frame reused across blocks
    // is sent once.
    if (!cache.has(scene.slide)) {
      const file = path.join(slideDir, `${scene.slide}.png`);
      const data = await fs.readFile(file).catch(() => fail(`Missing slide PNG: ${file}`));
      const res = await fetch(HEYGEN_UPLOAD, {
        method: "POST",
        headers: { "x-api-key": process.env.HEYGEN_API_KEY, "Content-Type": "image/png" },
        body: data,
      });
      const body = await res.json().catch(() => null);
      const assetId = body?.data?.id;
      if (!res.ok || !assetId) fail(`Upload failed for ${scene.slide}: ${body?.message ?? res.status}`);
      cache.set(scene.slide, assetId);
      console.log(`    uploaded ${scene.slide} -> ${assetId}`);
    }
    const source = { type: "asset_id", asset_id: cache.get(scene.slide) };
    return script
      ? { type: "image", source, script, voice_id: VOICE_ID }
      : { type: "image", source, duration: scene.duration ?? 4 };
  }
  return fail(`Unknown scene type "${scene.type}"`);
}

async function main() {
  const [deckPath, ...rest] = process.argv.slice(2);
  if (!deckPath) fail("Usage: compose-course-video.mjs <deck.json> --slides DIR [--dry-run]");
  const dryRun = rest.includes("--dry-run");
  const slidesIndex = rest.indexOf("--slides");
  const slideDir = path.resolve(slidesIndex === -1 ? "slides-out" : rest[slidesIndex + 1]);
  if (!process.env.HEYGEN_API_KEY && !dryRun) fail("HEYGEN_API_KEY is not set.");

  const deck = JSON.parse(await fs.readFile(path.resolve(deckPath), "utf8"));
  // --only renders a subset. Proving one block before committing the batch is
  // the cheap way to find out a payload shape is wrong.
  const onlyIndex = rest.indexOf("--only");
  const only = onlyIndex === -1 ? null : new Set(rest[onlyIndex + 1].split(","));
  const blocks = (deck.blocks ?? []).filter((b) => !only || only.has(b.id));
  if (!blocks.length) fail(only ? `No block matched --only ${[...only].join(",")}` : "Deck has no blocks.");

  console.log(`\n${deck.course}\nAvatar ${AVATAR_ID}\nVoice  ${VOICE_ID}\n`);

  let totalSeconds = 0;
  let avatarSeconds = 0;
  let blocked = false;
  for (const block of blocks) {
    let seconds = 0;
    let mb = 0;
    for (const scene of block.scenes) {
      const secs = sceneSeconds(scene, await sceneScript(scene));
      seconds += secs;
      if (scene.type === "avatar") avatarSeconds += secs;
      mb += secs * (scene.type === "avatar" ? MB_PER_SECOND_AVATAR : MB_PER_SECOND_SLIDE);
    }
    totalSeconds += seconds;
    // HeyGen caps a studio video at 50 scenes; the storage re-host caps the file.
    const overCeiling = mb > REHOST_CEILING_MB - 5;
    const overScenes = block.scenes.length > 50;
    if (overCeiling || overScenes) blocked = true;
    const flag = overCeiling ? "  ✖ projected file will not re-host" : overScenes ? "  ✖ over 50 scenes" : "";
    console.log(
      `  ${block.id.padEnd(26)} ${String(block.scenes.length).padStart(2)} scenes  ` +
        `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}s  ~${mb.toFixed(0)}MB${flag}`,
    );
  }

  const minutes = totalSeconds / 60;
  const avatarMinutes = avatarSeconds / 60;
  const slideMinutes = minutes - avatarMinutes;
  const credits = Math.round(
    avatarMinutes * CREDITS_PER_MINUTE_AVATAR + slideMinutes * CREDITS_PER_MINUTE_SLIDE,
  );
  console.log(
    `\n${blocks.length} block(s), ${Math.floor(minutes)}m${String(Math.round(totalSeconds % 60)).padStart(2, "0")}s of video ` +
      `(${avatarMinutes.toFixed(1)}m avatar, ${slideMinutes.toFixed(1)}m slides), roughly ${credits} credits.\n`,
  );
  if (blocked) fail("Split the flagged blocks before spending credits.");
  if (dryRun) return;

  const cache = new Map();
  const out = path.resolve(`${deck.course}${only ? "-partial" : ""}-blocks.json`);
  const submitted = {};
  for (const block of blocks) {
    const scenes = [];
    for (const scene of block.scenes) scenes.push(await sceneToHeygen(scene, slideDir, cache));
    const res = await fetch(`${HEYGEN_BASE}/v3/videos`, {
      method: "POST",
      headers: { "x-api-key": process.env.HEYGEN_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "studio",
        aspect_ratio: "16:9",
        // Never 1080p: it produced a 134MB file for a 4.7-minute script.
        resolution: "720p",
        title: `CareBase — ${block.id}`,
        scenes,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.data?.video_id) {
      console.log(`  ✖ ${block.id}: ${body?.error?.message ?? body?.message ?? res.status}`);
      continue;
    }
    submitted[block.id] = body.data.video_id;
    await fs.writeFile(out, JSON.stringify(submitted, null, 2));
    console.log(`  ▸ ${block.id} queued as ${body.data.video_id}`);
  }
  console.log(`\nSubmitted ${Object.keys(submitted).length} block(s). Ids in ${out}`);
  console.log("Poll them with render-course-videos.mjs conventions, then wire the ids into a migration.");
}

main();
