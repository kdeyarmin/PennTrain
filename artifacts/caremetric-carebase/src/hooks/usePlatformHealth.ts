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
  // Expanded aggregates for AdminDashboard KPI tiles (additive; older RPCs omit these).
  activeEmployees?: number;
  employeesMissingEmail?: number;
  employeesMissingFacility?: number;
  expiredCredentials?: number;
  expiringCredentialsWithin30Days?: number;
  openIncidents?: number;
  openViolations?: number;
  openCorrectiveActions?: number;
  overdueCorrectiveActions?: number;
  publishedCourses?: number;
  draftCourses?: number;
  incompleteCourseAssignments?: number;
  overdueCourseAssignments?: number;
  overdueTrainingRecords?: number;
  pendingPolicyAttestations?: number;
  overduePolicyAttestations?: number;
  openAlerts?: number;
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
