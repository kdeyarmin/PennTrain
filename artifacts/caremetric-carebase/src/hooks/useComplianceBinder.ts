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

const BINDER_PAGE = 200;

/**
 * Succeeded exports whose facility list is exactly this facility.
 *
 * The organization-wide newest-10 list cannot answer this. Ten newer jobs for
 * other facilities, or a multi-facility packet, used to make Survey Day and
 * the pin list say this facility had no binder.
 */
export function useSingleFacilitySucceededBinders(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["binder_export_jobs", "single-facility", facilityId],
    enabled: !!facilityId,
    queryFn: async () => {
      const rows: BinderExportJob[] = [];
      for (let from = 0; ;) {
        const { data, error } = await supabase
          .from("binder_export_jobs")
          .select("*")
          .eq("status", "succeeded")
          .eq("facility_ids", `{${facilityId}}`)
          .order("completed_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + BINDER_PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < BINDER_PAGE) break;
        from += data.length;
      }
      return rows;
    },
  });
}

/** True when any succeeded export covers this facility, including a shared packet. */
export function useFacilityHasCoveringBinder(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["binder_export_jobs", "covering", facilityId ?? "any"],
    queryFn: async () => {
      let query = supabase.from("binder_export_jobs").select("id").eq("status", "succeeded").limit(1);
      if (facilityId) {
        query = query.or(`facility_ids.eq.{},facility_ids.cs.{${facilityId}}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
}

export interface BinderAppendixSection {
  key: string;
  title: string;
  included: number;
  total: number;
  csvUrl?: string;
}

export interface BinderDownloadResult {
  status: string;
  url?: string;
  path?: string;
  expiresIn?: number;
  error?: string;
  appendix?: {
    manifestUrl?: string;
    sections: BinderAppendixSection[];
  } | null;
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
