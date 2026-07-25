import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { TrendCorrectiveActionLike, TrendIncidentLike } from "@/lib/incidentTrends";

export interface IncidentTrendRecords {
  incidents: TrendIncidentLike[];
  corrective_actions: TrendCorrectiveActionLike[];
  from: string;
  to: string;
}

/**
 * Returns the incident rows for a window rather than pre-aggregated counts, because every chart
 * element has to open the records behind it. See incidentTrends.ts for why the grouping lives in
 * TypeScript.
 */
export function useIncidentTrendRecords({
  facilityId, from, to, enabled = true,
}: {
  facilityId: string | undefined;
  from: string;
  to: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["incident-trend-records", facilityId ?? null, from, to],
    enabled: enabled && Boolean(facilityId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_incident_trend_records" as never, {
        p_facility_id: facilityId,
        p_from: from,
        p_to: to,
      } as never);
      if (error) throw error;
      return data as unknown as IncidentTrendRecords;
    },
  });
}
