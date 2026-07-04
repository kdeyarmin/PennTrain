import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type AuditLog = Tables<"audit_logs">;

export interface ListAuditLogsFilters {
  entityType?: string;
  limit?: number;
}

export function useListAuditLogs(filters: ListAuditLogsFilters = {}) {
  return useQuery({
    queryKey: ["audit_logs", filters],
    queryFn: async () => {
      let query = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(filters.limit ?? 200);
      if (filters.entityType) query = query.eq("entity_type", filters.entityType);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}
