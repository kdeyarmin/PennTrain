import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PlatformHealth {
  orgsByStatus: Record<string, number>;
  notificationDeliveriesPending: number;
  notificationDeliveriesFailed: number;
  aiGenerationsPending: number;
  aiGenerationsFailed: number;
  heygenJobsInProgress: number;
  systemJobsStale: number;
  systemJobsFailed: number;
  auditCoverageMissing: number;
  totalFacilities: number;
  totalEmployees: number;
  totalCourses: number;
}

export function useGetPlatformHealth() {
  return useQuery({
    queryKey: ["platform-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_platform_health");
      if (error) throw error;
      return data as unknown as PlatformHealth;
    },
    refetchInterval: 60000,
  });
}
