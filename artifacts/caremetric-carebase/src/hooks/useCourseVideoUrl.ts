import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

function courseVideoStoragePath(value: string): string | null {
  const locatorPrefix = "storage://course-videos/";
  if (value.startsWith(locatorPrefix)) return value.slice(locatorPrefix.length);
  try {
    const url = new URL(value);
    const marker = "/storage/v1/object/public/course-videos/";
    const index = url.pathname.indexOf(marker);
    if (index >= 0) return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    // Non-URL values are rejected below rather than passed to a media element.
  }
  return null;
}

/**
 * Org-authored course videos are gated by the storage policy in
 * 20260714233041_remediate_p2_security_findings.sql (`b.organization_id = current_org_id()`), so
 * this is the same class of problem the resident-photo signers are: a signed URL is
 * bearer-authorized for its own TTL regardless of what RLS would say after an org change. This
 * used to be plain useState/useEffect, which queryClient.clear() could not reach at all on an
 * identity change -- a course player left mounted across an org change kept the old org's video
 * resolvable for up to 15 more minutes. useQuery brings it under the clear, and the key is
 * identity-scoped on top of that for the same narrower race the resident-photo signers close.
 */
export function useCourseVideoUrl(value: string): {
  url: string | null;
  isLoading: boolean;
  error: string | null;
  /**
   * Mint a fresh signed URL. The TTL is 15 minutes and plenty of courses have a longer video than
   * that, so a learner who pauses, or simply watches to the end of a 40-minute lesson, hits a
   * signature that has expired mid-playback -- which the browser reports as a media error and
   * nothing was listening for. The caller re-signs on that error and puts the playhead back.
   */
  refresh: () => void;
} {
  const { user } = useAuth();
  const path = courseVideoStoragePath(value);

  const signed = useQuery({
    queryKey: ["course-video-url", value, user?.id, user?.organizationId, user?.role, user?.facilityId],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("course-videos").createSignedUrl(path!, 15 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: Boolean(path),
    // A signed URL is short-lived state, not cacheable data: two mounts a minute apart should each
    // hold a full window rather than share one already half spent. But it must NOT re-sign on
    // window focus -- that swaps the <video> src mid-lesson every time the learner tabs away and
    // back, which stalls playback for no reason. Re-signing is explicit, on the media error that
    // an expired signature actually produces.
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const refetch = signed.refetch;
  const refresh = useCallback(() => { void refetch(); }, [refetch]);

  // A blank locator is "no video on this block", not a broken one. Saying so lets a caller mount
  // this hook unconditionally instead of branching around a hook call.
  if (!value.trim()) {
    return { url: null, isLoading: false, error: null, refresh };
  }

  if (!path) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") throw new Error("Video URL must use HTTPS");
      return { url: value, isLoading: false, error: null, refresh };
    } catch (error) {
      return { url: null, isLoading: false, error: error instanceof Error ? error.message : "Invalid video URL", refresh };
    }
  }

  return {
    url: signed.data ?? null,
    isLoading: signed.isLoading,
    error: signed.error ? (signed.error instanceof Error ? signed.error.message : String(signed.error)) : null,
    refresh,
  };
}
