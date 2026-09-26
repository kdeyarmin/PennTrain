import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export function useResidentRecordDestructions(residentId?: string, enabled = true) {
  const { user, isLoading } = useAuth();
  return useQuery({
    queryKey: ["resident_record_destructions", user?.id, user?.organizationId, residentId ?? "all"],
    enabled: enabled && !isLoading && !!user?.isActive,
    queryFn: async ({ signal }) => {
      const result = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.rpc("list_resident_record_destructions", residentId ? { p_resident_id: residentId } : {})
          .range(from, from + 499).abortSignal(signal);
        if (error) throw error;
        result.push(...(data ?? []));
        if (!data || data.length < 500) return result;
      }
    },
  });
}
