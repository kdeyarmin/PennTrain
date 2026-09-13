import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { edgeFunctionError } from "@/lib/edgeFunctionErrors";
import { parseMediaOperation, projectMediaContext, projectMediaReceipt, type MediaOperation, type MediaUpload } from "../../../../supabase/functions/_shared/courseMediaProtocol";

export async function callCourseMedia(operation: MediaOperation, file?: File): Promise<unknown> {
  parseMediaOperation(operation);
  let headers: Record<string, string> | undefined;
  if (file) {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(operation)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    headers = { "content-type": (operation as MediaUpload).mimeType, "x-caremetric-media-request": encoded };
  }
  const result = await supabase.functions.invoke("course-media", { body: file ?? operation, headers });
  if (result.error) throw await edgeFunctionError(result.error) ?? result.error;
  if (!result.data || typeof result.data !== "object" || !("data" in result.data)) throw new Error("The media response could not be verified.");
  return result.data.data;
}
export function useCourseMediaContext(versionId: string, blockId: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["course_media_context", versionId, blockId, user?.id, user?.organizationId, user?.role],
    queryFn: async () => projectMediaContext(await callCourseMedia({ operation: "media.context", versionId, blockId }), { versionId, blockId }),
    enabled: enabled && !!user, staleTime: 0, gcTime: 0,
  });
}
export function useFinishCourseMedia() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (operationId: string) => {
    const receipt = projectMediaReceipt(await callCourseMedia({ operation: "media.finish", operationId }));
    if (receipt.operationId !== operationId) throw new Error("The media receipt does not match this operation.");
    return receipt;
  }, onSuccess: () => {
    for (const key of ["course_media_context", "course_blocks", "courses", "governed_draft_source", "course_version_publish_issues"])
      void client.invalidateQueries({ queryKey: [key] });
  } });
}
export function useCourseMediaUrl(versionId: string | undefined, blockId: string | undefined, assetId: string | null | undefined) {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ["course_media_url", versionId, blockId, assetId, user?.id, user?.organizationId, user?.role, user?.facilityId],
    queryFn: async () => {
      const result = await callCourseMedia({ operation: "media.read", versionId: versionId!, blockId: blockId!, assetId: assetId!, range: null }) as { assetId?: unknown; url?: unknown; expiresAt?: unknown };
      if (result?.assetId !== assetId || typeof result.url !== "string" || typeof result.expiresAt !== "string"
        || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error("The media link could not be verified.");
      const url = new URL(result.url); const base = new URL(import.meta.env.VITE_SUPABASE_URL);
      if (url.origin !== base.origin || url.username || url.password || url.hash || !url.pathname.startsWith("/storage/v1/object/sign/course-media/")
        || !url.pathname.includes(`/${assetId}/`)) throw new Error("The media link has an unexpected destination.");
      return result.url;
    }, enabled: Boolean(user && versionId && blockId && assetId), gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const refetch = query.refetch;
  const refresh = useCallback(() => { void refetch(); }, [refetch]);
  return { url: query.data ?? null, isLoading: Boolean(assetId) && query.isLoading, error: query.error?.message ?? null, refresh };
}
