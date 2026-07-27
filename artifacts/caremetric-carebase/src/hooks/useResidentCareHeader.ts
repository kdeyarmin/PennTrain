import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ResidentCareHeader } from "@/lib/residentCareHeader";

/** Fields the care-header dialog can write. Anything omitted is left untouched server-side. */
export interface ResidentCareProfileInput {
  level_of_care?: string;
  transfer_assistance?: string;
  ambulation_status?: string;
  fall_risk?: string;
  elopement_risk?: string;
  cognitive_status?: string;
  code_status?: string;
  allergies?: string[];
  mobility_summary?: string | null;
  supervision_requirements?: string | null;
}

function rpcClient() {
  return supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}

/**
 * One RPC backs the whole header so the page does not fan out a query per field, and so the
 * printable face sheet and (later) floor task cards read the same composed record.
 */
export function useResidentCareHeader(residentId?: string) {
  return useQuery({
    queryKey: ["resident-care-header", residentId],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ResidentCareHeader> => {
      const { data, error } = await rpcClient().rpc("get_resident_care_header", { p_resident_id: residentId });
      if (error) throw new Error(error.message);
      return data as ResidentCareHeader;
    },
    staleTime: 30_000,
  });
}

export function useSaveResidentCareProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ residentId, profile }: { residentId: string; profile: ResidentCareProfileInput }) => {
      const { error } = await rpcClient().rpc("save_resident_care_profile", {
        p_resident_id: residentId,
        p_profile: profile,
      });
      if (error) throw new Error(error.message);
      return true;
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["resident-care-header", variables.residentId] });
      // The header write stamps care_profile_reviewed_at on residents and appends an administrative
      // history row, so both of those caches are stale too.
      queryClient.invalidateQueries({ queryKey: ["residents", variables.residentId] });
      queryClient.invalidateQueries({ queryKey: ["resident-administrative-master", variables.residentId] });
    },
  });
}
