import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  video: { url: "https://example.supabase.co/signed/system/block.mp4?token=t" as string | null, isLoading: false },
  captions: { url: null as string | null, isLoading: false },
  captionsCalls: [] as Array<string | null>,
}));

// The real courseVideoStoragePath is under test; only its module's client import is stubbed.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useCourseVideoUrl", async (original) => ({
  ...await original<typeof import("@/hooks/useCourseVideoUrl")>(),
  useCourseVideoUrl: () => ({ ...h.video, error: null, refresh: () => undefined }),
}));
vi.mock("@/hooks/useCourseMedia", () => ({
  useCourseMediaUrl: () => ({ ...h.video, error: null, refresh: () => undefined }),
}));
vi.mock("@/hooks/useCourseVideoCaptions", () => ({
  useCourseVideoCaptions: (videoPath: string | null) => {
    h.captionsCalls.push(videoPath);
    return h.captions;
  },
}));

import { CourseVideoPlayer } from "./CourseVideoPlayer";

const ORIGINAL_BLOCK = "a424415b-d179-56ea-879d-e52e55a43971";
const PUBLIC_URL = `https://xsqobvvreaovwibxwyvv.supabase.co/storage/v1/object/public/course-videos/system/${ORIGINAL_BLOCK}.mp4`;

function render(src: string, media?: { versionId: string; blockId: string; assetId: string }) {
  return renderToStaticMarkup(
    <CourseVideoPlayer src={src} media={media} state={undefined} gated={false} onChange={() => undefined} />,
  );
}

describe("CourseVideoPlayer captions", () => {
  beforeEach(() => {
    h.video = { url: "https://example.supabase.co/signed/system/block.mp4?token=t", isLoading: false };
    h.captions = { url: null, isLoading: false };
    h.captionsCalls = [];
  });

  it("looks captions up by the video's bucket path and attaches them as the default English track", () => {
    h.captions = { url: "blob:https://app.example/captions", isLoading: false };
    const html = render(PUBLIC_URL);

    expect(h.captionsCalls).toEqual([`system/${ORIGINAL_BLOCK}.mp4`]);
    expect(html).toContain("<video");
    expect(html).toMatch(/<track[^>]*kind="captions"/);
    expect(html).toMatch(/<track[^>]*src="blob:https:\/\/app.example\/captions"/);
    expect(html).toMatch(/<track[^>]*srcLang="en"/i);
    expect(html).toMatch(/<track[^>]*default=""/);
  });

  it("finds the same captions for a cloned block, which keeps video_url but loses body.heygen", () => {
    // clone_course_version_core gives the copy a new block id and strips body.heygen, but its
    // video_url still names the original block's file -- and that path is the captions key.
    render(PUBLIC_URL);
    expect(h.captionsCalls).toEqual([`system/${ORIGINAL_BLOCK}.mp4`]);
  });

  it("resolves a per-job render locator to its own path", () => {
    render(`storage://course-videos/system/${ORIGINAL_BLOCK}.0b0f824712f3490dbe8c5e639ba53c87.mp4`);
    expect(h.captionsCalls).toEqual([`system/${ORIGINAL_BLOCK}.0b0f824712f3490dbe8c5e639ba53c87.mp4`]);
  });

  it("plays without a track when the file has no captions", () => {
    const html = render(PUBLIC_URL);

    expect(html).toContain("<video");
    expect(html).not.toContain("<track");
  });

  it("holds the video element until the captions lookup settles, so the track is there at load", () => {
    h.captions = { url: null, isLoading: true };
    const html = render(PUBLIC_URL);

    expect(html).not.toContain("<video");
    expect(html).toContain("animate-pulse");
  });

  it("does not look up captions for an external URL or an owned media asset", () => {
    render("https://videos.example.com/lesson.mp4");
    render("", { versionId: "v", blockId: "b", assetId: "a" });

    expect(h.captionsCalls).toEqual([null, null]);
  });
});
