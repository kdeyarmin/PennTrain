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
  });

  if (!path) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") throw new Error("Video URL must use HTTPS");
      return { url: value, isLoading: false, error: null };
    } catch (error) {
      return { url: null, isLoading: false, error: error instanceof Error ? error.message : "Invalid video URL" };
    }
  }

  return {
    url: signed.data ?? null,
    isLoading: signed.isLoading,
    error: signed.error ? (signed.error instanceof Error ? signed.error.message : String(signed.error)) : null,
  };
}
