import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type BinderExportJob = Tables<"binder_export_jobs">;

// Binder exports are asynchronous: request_binder_export() enqueues a durable job
// (authorization, org resolution, and facility scoping all enforced in SQL), a
// background worker renders and stores the PDF within a few minutes, and the edge
// function signs the finished object for download. Repeated identical requests return
// the in-flight job rather than stacking renders.

export interface RequestBinderExportPayload {
  /** Only honored for platform_admin -- every other role always gets their own organization. */
  organizationId?: string;
  /** org_admin/auditor narrowing; facility_manager scope is auto-derived server-side. */
  facilityIds?: string[];
}

export function useRequestBinderExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: RequestBinderExportPayload = {}): Promise<BinderExportJob> => {
      const { data, error } = await supabase.rpc("request_binder_export", {
        p_organization_id: payload.organizationId ?? undefined,
        p_facility_ids: payload.facilityIds && payload.facilityIds.length > 0 ? payload.facilityIds : undefined,
      });
      if (error) throw error;
      return data as unknown as BinderExportJob;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["binder_export_jobs"] }),
  });
}

function isActiveStatus(status: string | undefined) {
  return status === "pending" || status === "processing";
}

export function useGetBinderExport(jobId: string | undefined) {
  return useQuery({
    queryKey: ["binder_export_jobs", "detail", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("binder_export_jobs")
        .select("*")
        .eq("id", jobId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
    // Poll while the worker is rendering so the button flips to Download on its own.
    refetchInterval: (query) => (isActiveStatus(query.state.data?.status) ? 4_000 : false),
  });
}

export function useListBinderExports(filters: { organizationId?: string } = {}) {
  return useQuery({
    queryKey: ["binder_export_jobs", filters],
    queryFn: async () => {
      let query = supabase
        .from("binder_export_jobs")
        .select("*")
        .order("requested_at", { ascending: false })
        .limit(10);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    refetchInterval: (query) =>
      query.state.data?.some((job) => isActiveStatus(job.status)) ? 5_000 : false,
  });
}

export interface BinderDownloadResult {
  status: string;
  url?: string;
  path?: string;
  expiresIn?: number;
  error?: string;
}

export function useBinderDownloadUrl() {
  return useMutation({
    mutationFn: async (jobId: string): Promise<BinderDownloadResult> => {
      const { data, error } = await supabase.functions.invoke<BinderDownloadResult & { success?: boolean }>(
        "generate-compliance-binder",
        { body: { job_id: jobId } },
      );
      if (error) throw error;
      if (!data) throw new Error("Failed to fetch binder download link");
      if (data.success === false) throw new Error(data.error ?? "Binder generation failed");
      return data;
    },
  });
}
