import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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

export function useCourseVideoUrl(value: string): {
  url: string | null;
  isLoading: boolean;
  error: string | null;
} {
  const [state, setState] = useState({ url: null as string | null, isLoading: true, error: null as string | null });

  useEffect(() => {
    let active = true;
    const path = courseVideoStoragePath(value);
    if (!path) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") throw new Error("Video URL must use HTTPS");
        setState({ url: value, isLoading: false, error: null });
      } catch (error) {
        setState({ url: null, isLoading: false, error: error instanceof Error ? error.message : "Invalid video URL" });
      }
      return () => { active = false; };
    }

    setState({ url: null, isLoading: true, error: null });
    void supabase.storage.from("course-videos").createSignedUrl(path, 15 * 60)
      .then(({ data, error }) => {
        if (!active) return;
        setState({ url: data?.signedUrl ?? null, isLoading: false, error: error?.message ?? null });
      });
    return () => { active = false; };
  }, [value]);
  return state;
}
