import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface Resident360Snapshot {
  generatedAt: string;
  residentId: string;
  openRisks: { incidents: number; conditionChanges: number; complaints: number; complianceGaps: number };
  serviceDelivery: { dueNext24Hours: number; exceptionsLast7Days: number };
  finance: { balance: number; lastPostedAt: string | null };
  dietary: { profileUpdatedAt: string | null; openWeightMonitoring: number };
}

export interface ResidentTimelineEvent {
  occurred_at: string;
  event_type: string;
  title: string;
  status: string | null;
  detail: string | null;
  href: string;
  source_id: string;
}

function rpcClient() {
  return supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
}

export function useResident360Snapshot(residentId?: string) {
  return useQuery({
    queryKey: ["resident-360", residentId],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<Resident360Snapshot> => {
      const { data, error } = await rpcClient().rpc("get_resident_360_snapshot", { p_resident_id: residentId });
      if (error) throw new Error(error.message);
      return data as Resident360Snapshot;
    },
    staleTime: 30_000,
  });
}

export function useResidentTimeline(residentId?: string, limit = 100) {
  return useQuery({
    queryKey: ["resident-timeline", residentId, limit],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ResidentTimelineEvent[]> => {
      const { data, error } = await rpcClient().rpc("get_resident_timeline", { p_resident_id: residentId, p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as ResidentTimelineEvent[];
    },
    staleTime: 30_000,
  });
}
