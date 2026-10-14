import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * WebVTT captions for a HeyGen-rendered course video, keyed by the render's video id
 * (`body.heygen.video_id`) rather than the block: a cloned block reuses the same render and so the
 * same captions, and a re-render gets a new id, so stale captions can never play over new audio.
 * The table's RLS mirrors course_blocks -- a caller sees captions only for a render on a block they
 * can already read -- and the cue text is the block's own transcript, so this exposes nothing new.
 *
 * The track is handed to the <video> as a blob: URL, which is same-origin and so needs no CORS or
 * crossorigin attribute on the element. `isLoading` lets the player hold the element until the
 * answer is in, so the track is present at first render and `default` is honored.
 */
export function useCourseVideoCaptions(videoId: string | undefined): { url: string | null; isLoading: boolean } {
  const { user } = useAuth();
  const captions = useQuery({
    queryKey: ["course-video-captions", videoId, user?.id, user?.organizationId, user?.role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_video_captions")
        .select("vtt")
        .eq("heygen_video_id", videoId!)
        .maybeSingle();
      if (error) throw error;
      return data?.vtt ?? null;
    },
    enabled: Boolean(videoId),
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
