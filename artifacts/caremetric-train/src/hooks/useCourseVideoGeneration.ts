import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
