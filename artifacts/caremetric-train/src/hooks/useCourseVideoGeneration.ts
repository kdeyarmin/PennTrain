<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useCourseVideoGeneration.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
=======
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { CourseBlock } from "@/hooks/useCourses";
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useCourseVideoGeneration.ts

export interface HeygenAvatar {
  id: string;
  name: string;
  preview_image_url: string | null;
  gender: string | null;
}

export interface HeygenVoice {
  voice_id: string;
  name: string;
  language: string | null;
  gender: string | null;
  preview_audio_url: string | null;
}

/**
 * Lists HeyGen avatar looks + voices for the course-builder picker. Read-only,
 * proxied through an Edge Function so the HEYGEN_API_KEY never reaches the client.
 */
export function useListHeygenOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["heygen-options"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ avatars: HeygenAvatar[]; voices: HeygenVoice[] }>(
        "list-heygen-options",
        { method: "GET" },
      );
      if (error) throw error;
      return data!;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export interface GenerateCourseVideoPayload {
  courseBlockId: string;
  avatarId: string;
  voiceId: string;
  script: string;
  title?: string;
}

export function useGenerateCourseVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ courseBlockId, avatarId, voiceId, script, title }: GenerateCourseVideoPayload) => {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; video_id?: string; status?: string; error?: string }>(
        "generate-course-video",
        { body: { course_block_id: courseBlockId, avatar_id: avatarId, voice_id: voiceId, script, title } },
      );
      if (error) throw error;
      if (!data || data.success === false) throw new Error(data?.error ?? "Failed to start video generation");
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course_blocks"] }),
  });
}

export interface CheckCourseVideoStatusResult {
  status: "pending" | "processing" | "completed" | "failed";
  video_url?: string;
  error?: string;
}

export function useCheckCourseVideoStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (courseBlockId: string): Promise<CheckCourseVideoStatusResult> => {
      const { data, error } = await supabase.functions.invoke<
        { success?: boolean; status?: string; video_url?: string; error?: string }
      >("check-course-video-status", { body: { course_block_id: courseBlockId } });
      if (error) throw error;
      if (!data || data.success === false) throw new Error(data?.error ?? "Failed to check video status");
      return { status: data.status as CheckCourseVideoStatusResult["status"], video_url: data.video_url, error: data.error };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course_blocks"] }),
  });
}
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/useCourseVideoGeneration.ts
=======

// HeyGen job states that mean "done, stop polling this block" -- everything else (e.g.
// "processing", "pending", "waiting") is treated as still in-flight.
const TERMINAL_HEYGEN_STATUSES = new Set(["completed", "failed"]);

/**
 * Client-side snappiness on top of the server-side poll-heygen-video-statuses cron backstop
 * (which runs every 5 minutes): while any block in `blocks` has a non-terminal
 * `body.heygen.status`, re-checks every in-flight block every ~15s via the existing
 * useCheckCourseVideoStatus() mutation, so an admin watching the page sees a status flip to
 * "completed"/"failed" live without clicking the manual refresh button -- whichever of the
 * cron job or this poll gets there first. The interval is only created while at least one
 * such block is present and is cleared the moment none remain (or on unmount).
 */
export function useAutoCheckVideoStatuses(blocks: CourseBlock[] | undefined) {
  const { mutate: checkVideoStatus } = useCheckCourseVideoStatus();

  // Refs so the interval tick always reads the latest blocks/mutate function without having
  // to tear down and recreate the interval every time they change identity.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const checkVideoStatusRef = useRef(checkVideoStatus);
  checkVideoStatusRef.current = checkVideoStatus;

  const hasPendingVideo = (blocks ?? []).some((b) => {
    const status = (b.body as { heygen?: { status?: string } } | null)?.heygen?.status;
    return !!status && !TERMINAL_HEYGEN_STATUSES.has(status);
  });

  useEffect(() => {
    if (!hasPendingVideo) return;
    const intervalId = setInterval(() => {
      for (const block of blocksRef.current ?? []) {
        const status = (block.body as { heygen?: { status?: string } } | null)?.heygen?.status;
        if (status && !TERMINAL_HEYGEN_STATUSES.has(status)) {
          checkVideoStatusRef.current(block.id);
        }
      }
    }, 15_000);
    return () => clearInterval(intervalId);
  }, [hasPendingVideo]);
}
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/useCourseVideoGeneration.ts
