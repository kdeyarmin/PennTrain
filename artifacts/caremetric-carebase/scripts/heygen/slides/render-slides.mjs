#!/usr/bin/env node
// @ts-check
/**
 * Render course slide PNGs from a deck spec.
 *
 * HeyGen's studio video type takes full-frame `image` scenes, and an image scene
 * can carry its own narration -- so a slide is not filler between avatar clips,
 * it is a narrated step with Kevin's voice over it. That is what lets a course
 * reach twenty-plus minutes of video without twenty minutes of talking head.
 *
 * Uses the Chromium that ships with this environment, so there is no browser
 * dependency to install and no headless-browser library in the tree.
 *
 * Usage:
 *   node scripts/heygen/slides/render-slides.mjs <deck.json> [--out DIR]
 *
 * A deck is an array of slides:
 *   { "id": "falls-01-title", "kind": "title",   "eyebrow": "...", "title": "...", "subtitle": "..." }
 *   { "id": "falls-02-sec",   "kind": "section", "eyebrow": "Part one", "title": "..." }
 *   { "id": "falls-03-pts",   "kind": "points",  "title": "...", "points": ["...", "..."] }
 *   { "id": "falls-04-rule",  "kind": "rule",    "quote": "...", "attribution": "..." }
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// PLAYWRIGHT_BROWSERS_PATH points at a directory of versioned installs, so the
// binary is resolved rather than hardcoded to one build number.
async function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const entries = await fs.readdir(root).catch(() => []);
  const candidates = entries
    .filter((e) => e.startsWith("chromium"))
    .sort()
    .reverse()
    .flatMap((e) => [
      path.join(root, e, "chrome-linux", "chrome"),
      path.join(root, e, "chrome-linux", "headless_shell"),
    ]);
  for (const candidate of candidates) {
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error(`No Chromium binary found under ${root}. Set CHROMIUM_PATH.`);
}
const WIDTH = 1280;
const HEIGHT = 720;

const escape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function footer(slide) {
  const left = slide.footer ?? "CareMetric CareBase";
  const right = slide.footerRight ?? "";
  return `<footer><span class="mark">${escape(left)}</span><span>${escape(right)}</span></footer>`;
}

function body(slide) {
  const eyebrow = slide.eyebrow ? `<p class="eyebrow">${escape(slide.eyebrow)}</p>` : "";
  switch (slide.kind) {
    case "title":
    case "section":
      return [
        eyebrow,
        `<h1>${escape(slide.title)}</h1>`,
        slide.subtitle ? `<p class="subtitle">${escape(slide.subtitle)}</p>` : "",
        footer(slide),
      ].join("\n");
    case "points":
      return [
        eyebrow,
        `<h1>${escape(slide.title)}</h1>`,
        `<ul>${(slide.points ?? []).map((p) => `<li>${escape(p)}</li>`).join("")}</ul>`,
        footer(slide),
      ].join("\n");
    case "rule":
      return [
        eyebrow,
        `<blockquote>${escape(slide.quote)}</blockquote>`,
        slide.attribution ? `<p class="attribution">${escape(slide.attribution)}</p>` : "",
        footer(slide),
      ].join("\n");
    default:
      throw new Error(`Unknown slide kind "${slide.kind}" on ${slide.id}`);
  }
}

// Smallest gap we will accept between the last line of content and the footer.
// Below this the frame reads as crowded even before anything actually collides.
const FOOTER_CLEARANCE = 16;

/**
 * Re-load the page with --dump-dom and read back the measurement the template
 * parked in <title>. Returns null when the slide fits, or the overshoot in px.
 */
async function measure(chromium, htmlPath) {
  const { stdout } = await run(chromium, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--force-device-scale-factor=1",
    `--window-size=${WIDTH},${HEIGHT}`,
    "--virtual-time-budget=2000",
    "--dump-dom",
    `file://${htmlPath}`,
  ]);
  const match = stdout.match(/<title>fit:(\d+):(\d+)<\/title>/);
  // No match means the measuring script did not run. Say so rather than
  // reporting a clean fit we never actually checked.
  if (!match) throw new Error(`Could not measure ${htmlPath}: no fit marker in the DOM`);
  const [, contentBottom, footerTop] = match.map(Number);
  const over = Math.round(contentBottom - (footerTop - FOOTER_CLEARANCE));
  return over > 0 ? { over, contentBottom, footerTop } : null;
}

async function main() {
  const [deckPath, ...rest] = process.argv.slice(2);
  if (!deckPath) {
    console.error("Usage: render-slides.mjs <deck.json> [--out DIR]");
    process.exit(1);
  }
  const outIndex = rest.indexOf("--out");
  const outDir = path.resolve(outIndex === -1 ? "slides-out" : rest[outIndex + 1]);
  await fs.mkdir(outDir, { recursive: true });

  const chromium = await resolveChromium();
  const template = await fs.readFile(path.join(HERE, "slide-template.html"), "utf8");
  const deck = JSON.parse(await fs.readFile(path.resolve(deckPath), "utf8"));
  const seen = new Set();
  const overflowing = [];

  for (const slide of deck) {
    if (seen.has(slide.id)) throw new Error(`Duplicate slide id "${slide.id}"`);
    seen.add(slide.id);

    // replaceAll: the template documents its own tokens in a leading comment, so a
    // first-match-only replace substitutes the comment and leaves the real slots.
    const html = template.replaceAll("__KIND__", slide.kind).replaceAll("__SLOTS__", body(slide));
    const htmlPath = path.join(outDir, `${slide.id}.html`);
    const pngPath = path.join(outDir, `${slide.id}.png`);
    await fs.writeFile(htmlPath, html);

    await run(chromium, [
      "--headless",
      "--disable-gpu",
      // This runs as root in the container image, where Chromium's sandbox
      // refuses to start. The page is a local file we generated ourselves.
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ]);
    const fit = await measure(chromium, htmlPath);
    await fs.unlink(htmlPath);
    if (fit) overflowing.push({ id: slide.id, ...fit });

    const { size } = await fs.stat(pngPath);
    console.log(
      `  ${slide.id.padEnd(30)} ${slide.kind.padEnd(8)} ${(size / 1024).toFixed(0).padStart(4)}KB` +
        (fit ? `   overflows by ${fit.over}px` : ""),
    );
  }
  console.log(`\n${deck.length} slide(s) written to ${outDir}`);

  // A clipped slide is a defect that ships silently: the PNG renders, HeyGen
  // accepts it, and the missing line is only found by watching the video. Fail
  // the render instead, so it gets fixed in the copy before anything is paid for.
  if (overflowing.length > 0) {
    console.error(
      `\n${overflowing.length} slide(s) do not fit the 1280x720 frame and would be clipped:\n` +
        overflowing.map((s) => `  ${s.id} — content runs ${s.over}px into the footer`).join("\n") +
        "\n\nShorten the copy, or drop a point, and render again.",
    );
    process.exit(1);
  }
}

main();
