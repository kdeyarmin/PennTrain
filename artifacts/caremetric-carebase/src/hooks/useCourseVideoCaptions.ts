import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * WebVTT captions for a course video, keyed by the video's object path in the course-videos bucket
 * (`system/<block>.mp4`, or `<folder>/<block>.<render>.mp4` for renders since per-job storage).
 * A cloned version copies `video_url` but not `body.heygen`, so the path is the identity that
 * survives a clone; and a render is stored once under its own path and never overwritten, so a
 * re-render gets a new path and stale captions can never play over new audio. The table's read
 * policy is the bucket's own, so a caller sees captions exactly when they can play the file.
 *
 * The track is handed to the <video> as a blob: URL, which is same-origin and so needs no CORS or
 * crossorigin attribute on the element. `isLoading` lets the player hold the element until the
 * answer is in, so the track is present at first render and `default` is honored.
 */
export function useCourseVideoCaptions(videoPath: string | null): { url: string | null; isLoading: boolean } {
  const { user } = useAuth();
  const captions = useQuery({
    queryKey: ["course-video-captions", videoPath, user?.id, user?.organizationId, user?.role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_video_captions")
        .select("vtt")
        .eq("video_path", videoPath!)
        .maybeSingle();
      if (error) throw error;
      return data?.vtt ?? null;
    },
    enabled: Boolean(videoPath),
    staleTime: Infinity,
    // Captions are an enhancement: a failed lookup plays the video without them rather than
    // holding the lesson behind retries.
    retry: false,
    refetchOnWindowFocus: false,
  });

  const vtt = captions.data ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!vtt) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [vtt]);

  // The blob URL lands one render after the text; count that render as still loading so the
  // player does not mount the element a beat before its track exists.
  return { url, isLoading: captions.isLoading || (vtt !== null && url === null) };
}
