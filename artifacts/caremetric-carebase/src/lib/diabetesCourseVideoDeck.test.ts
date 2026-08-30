import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIABETES_COURSE_CATALOG_CODE } from "./diabetesCourse";

/**
 * The deck and the course version have to say the same thing.
 *
 * scripts/heygen/decks/pa-pch-diabetes-annual.json is what HeyGen renders; the `script` on each
 * course block in 20260830160000 is the transcript a learner reads and the text the in-product
 * "Generate videos" button would submit if a block is ever re-rendered on its own. They are
 * generated from one source, and this is what keeps them that way after a hand edit to either.
 *
 * It also pins the two things the render pipeline can only discover by spending money: the
 * presenter identity, and every block staying under the ~50MB storage re-host ceiling.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const APP_ROOT = join(REPO_ROOT, "artifacts/caremetric-carebase");

const DECK = JSON.parse(
  readFileSync(join(APP_ROOT, "scripts/heygen/decks/pa-pch-diabetes-annual.json"), "utf8"),
) as {
  course: string;
  slides: string;
  blocks: { id: string; title: string; scenes: DeckScene[] }[];
};

type DeckScene = { type: "slide" | "avatar"; slide?: string; script?: string; duration?: number };

const SLIDES = JSON.parse(
  readFileSync(join(APP_ROOT, "scripts/heygen/decks/pa-pch-diabetes-annual-slides.json"), "utf8"),
) as { id: string; kind: string; points?: string[] }[];

const MIGRATION = readFileSync(
  join(REPO_ROOT, "supabase/migrations/20260830160000_pa_pch_diabetes_annual_video_version.sql"),
  "utf8",
);

/** Constants copied from compose-course-video.mjs, which solved them from two rendered decks. */
const CHARS_PER_SECOND = 17.5;
const MB_PER_SECOND_AVATAR = 0.27;
const MB_PER_SECOND_SLIDE = 0.04;
const REHOST_CEILING_MB = 50;
const MAX_SCRIPT_CHARS = 5000;

/** The one CareBase presenter, per scripts/heygen/scripts/README.md. */
const AVATAR_ID = "3fd2086f9f31438cb28ae57134b6affa";
const VOICE_ID = "e27fe997edb94c61b755e8f4c563fe5b";

interface VideoBlock {
  title: string;
  script: string;
  minutes: number;
  deckBlockId: string;
}

const videoBlocks: VideoBlock[] = [];
{
  const pattern = /'video', (\d+), \$txt\$(.*?)\$txt\$,\s*\$jsonbody\$(.*?)\$jsonbody\$/gs;
  for (const match of MIGRATION.matchAll(pattern)) {
    const body = JSON.parse(match[3]) as Record<string, unknown>;
    videoBlocks.push({
      title: match[2],
      script: String(body.script ?? ""),
      minutes: Number(body.estimated_minutes),
      deckBlockId: String(body.deck_block_id ?? ""),
    });
  }
}

describe("PA PCH diabetes video deck", () => {
  it("is the deck for this course, and parses", () => {
    expect(DECK.course).toBe(DIABETES_COURSE_CATALOG_CODE);
    expect(DECK.slides).toBe("pa-pch-diabetes-annual-slides.json");
    expect(DECK.blocks).toHaveLength(12);
    expect(videoBlocks).toHaveLength(12);
  });

  it("uses the one CareBase presenter identity", () => {
    // The deck relies on compose-course-video.mjs's defaults rather than restating the ids, so the
    // assertion is on the script that supplies them. Several Kevin-named voices exist in the
    // account and only this one is the avatar voice.
    const composer = readFileSync(join(APP_ROOT, "scripts/heygen/compose-course-video.mjs"), "utf8");
    expect(composer).toContain(AVATAR_ID);
    expect(composer).toContain(VOICE_ID);
    expect(DECK.blocks.some((block) => block.scenes.some((scene) => scene.type === "avatar"))).toBe(true);
  });

  it("carries the same narration in the deck and on the course block", () => {
    for (const block of DECK.blocks) {
      const narration = block.scenes
        .map((scene) => scene.script?.trim())
        .filter((script): script is string => !!script)
        .join("\n\n");
      const courseBlock = videoBlocks.find((candidate) => candidate.deckBlockId === block.id);
      expect(courseBlock, `no course block references deck block ${block.id}`).toBeDefined();
      expect(courseBlock!.script).toBe(narration);
    }
  });

  it("opens every block on a slide that exists in the slide deck", () => {
    const slideIds = new Set(SLIDES.map((slide) => slide.id));
    for (const block of DECK.blocks) {
      expect(block.scenes[0].type).toBe("slide");
      for (const scene of block.scenes) {
        if (scene.type === "slide") expect(slideIds.has(scene.slide!)).toBe(true);
      }
    }
  });

  it("keeps every block under the storage re-host ceiling and every script under HeyGen's limit", () => {
    for (const block of DECK.blocks) {
      let megabytes = 0;
      for (const scene of block.scenes) {
        const script = scene.script ?? "";
        expect(script.length, `${block.id} scene script`).toBeLessThanOrEqual(MAX_SCRIPT_CHARS);
        const seconds = script ? script.length / CHARS_PER_SECOND : scene.duration ?? 4;
        megabytes += seconds * (scene.type === "avatar" ? MB_PER_SECOND_AVATAR : MB_PER_SECOND_SLIDE);
      }
      // A block that will not re-host publishes a course video block pointing at nothing.
      expect(megabytes, `${block.id} projected MB`).toBeLessThan(REHOST_CEILING_MB);
    }
  });

  it("declares designed minutes close to the narration it actually renders", () => {
    for (const block of DECK.blocks) {
      const seconds = block.scenes.reduce((total, scene) => {
        const script = scene.script ?? "";
        return total + (script ? script.length / CHARS_PER_SECOND : scene.duration ?? 4);
      }, 0);
      const courseBlock = videoBlocks.find((candidate) => candidate.deckBlockId === block.id)!;
      // Minutes are allocated across the deck by largest remainder rather than rounded block by
      // block, so a single block may sit up to a minute either side of its own runtime.
      expect(Math.abs(courseBlock.minutes - seconds / 60), block.id).toBeLessThan(1);
    }
    expect(videoBlocks.reduce((total, block) => total + block.minutes, 0)).toBe(30);
  });

  it("keeps slides inside the frame the renderer enforces", () => {
    for (const slide of SLIDES) {
      if (!slide.points) continue;
      expect(slide.points.length, slide.id).toBeLessThanOrEqual(5);
      for (const point of slide.points) {
        // The frame is a fixed 1280x720 with overflow hidden: one line too many is clipped
        // silently and still produces a plausible-looking PNG.
        expect(point.length, `${slide.id}: ${point}`).toBeLessThanOrEqual(42);
      }
    }
    expect(new Set(SLIDES.map((slide) => slide.id)).size).toBe(SLIDES.length);
  });

  it("seeds the version as a draft with no render recorded yet", () => {
    // Written before the render, which is the sequencing the HeyGen README insists on: a video
    // block carrying a storage URL before the object exists publishes a broken player.
    expect(MIGRATION).toContain("'draft', null, false, 'comprehensive'");
    expect(MIGRATION).not.toContain('"heygen"');
    expect(MIGRATION).not.toContain("course-videos/system/");
    // current_version_id is deliberately untouched, so v2026.1 keeps serving learners.
    expect(MIGRATION).not.toContain("update public.courses set current_version_id");
  });
});
