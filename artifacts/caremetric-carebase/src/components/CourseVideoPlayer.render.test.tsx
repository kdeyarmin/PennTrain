import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  video: { url: "https://example.supabase.co/signed/system/block.mp4?token=t" as string | null, isLoading: false },
  captions: { url: null as string | null, isLoading: false },
  captionsCalls: [] as Array<string | undefined>,
}));

vi.mock("@/hooks/useCourseVideoUrl", () => ({
  useCourseVideoUrl: () => ({ ...h.video, error: null, refresh: () => undefined }),
}));
vi.mock("@/hooks/useCourseMedia", () => ({
  useCourseMediaUrl: () => ({ ...h.video, error: null, refresh: () => undefined }),
}));
vi.mock("@/hooks/useCourseVideoCaptions", () => ({
  useCourseVideoCaptions: (videoId: string | undefined) => {
    h.captionsCalls.push(videoId);
    return h.captions;
  },
}));

import { CourseVideoPlayer } from "./CourseVideoPlayer";

function render(captionsVideoId?: string) {
  return renderToStaticMarkup(
    <CourseVideoPlayer
      src="https://example.supabase.co/storage/v1/object/public/course-videos/system/block.mp4"
      state={undefined}
      gated={false}
      onChange={() => undefined}
      captionsVideoId={captionsVideoId}
    />,
  );
}

describe("CourseVideoPlayer captions", () => {
  beforeEach(() => {
    h.video = { url: "https://example.supabase.co/signed/system/block.mp4?token=t", isLoading: false };
    h.captions = { url: null, isLoading: false };
    h.captionsCalls = [];
  });

  it("attaches the render's captions as the default English track", () => {
    h.captions = { url: "blob:https://app.example/captions", isLoading: false };
    const html = render("0b0f824712f3490dbe8c5e639ba53c87");

    expect(h.captionsCalls).toContain("0b0f824712f3490dbe8c5e639ba53c87");
    expect(html).toContain("<video");
    expect(html).toMatch(/<track[^>]*kind="captions"/);
    expect(html).toMatch(/<track[^>]*src="blob:https:\/\/app.example\/captions"/);
    expect(html).toMatch(/<track[^>]*srcLang="en"/i);
    expect(html).toMatch(/<track[^>]*default=""/);
  });

  it("plays without a track when the render has no captions", () => {
    const html = render("4bca5132db184869aa9dd5d960b44672");

    expect(html).toContain("<video");
    expect(html).not.toContain("<track");
  });

  it("holds the video element until the captions lookup settles, so the track is there at load", () => {
    h.captions = { url: null, isLoading: true };
    const html = render("4bca5132db184869aa9dd5d960b44672");

    expect(html).not.toContain("<video");
    expect(html).toContain("animate-pulse");
  });

  it("does not look up captions for a video with no render id", () => {
    const html = render(undefined);

    expect(h.captionsCalls).toEqual([undefined]);
    expect(html).toContain("<video");
    expect(html).not.toContain("<track");
  });
});
