import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useOrgFeatureEnabled } from "@/hooks/useFeatureRelease";
import { useListMyFacilityAssignments } from "@/hooks/useFacilityAssignments";

interface FacilityBenchmarkComparison {
  available: boolean;
  cohort?: { organizationCount: number; facilityCount: number; kThreshold: number; jurisdictionCode: string };
  metrics?: {
    trainingComplianceRate?: { p25: number; p50: number; p75: number };
    medianCredentialRenewalDays?: { p50: number };
    incidentsPer100OccupiedBeds?: { p50: number };
    topCitationTopics?: Array<{ citationRef: string | null; title: string; organizationCount: number; violationCount: number }>;
  };
  facilityMetrics?: {
    trainingComplianceRate: number;
    medianCredentialRenewalDays: number;
    incidentsPer100OccupiedBeds: number;
    topCitationTopics: Array<{ citationRef: string | null; title: string; violationCount: number }>;
  };
}

export function useFacilityBenchmarkComparison<T extends { facilityId: string; isActive: boolean }>(facilities: readonly T[]) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const benchmarkFeature = useOrgFeatureEnabled("analytics.cross_tenant_benchmarks");
  const isManager = user?.role === "facility_manager";
  const assignments = useListMyFacilityAssignments(user?.id, isManager && isAuthenticated && !isLoading && benchmarkFeature.isEnabled);
  // The dashboard summary lists the whole organization's facilities, but this
  // RPC requires a manager's explicit assignment to an active site. Pick an authorized facility
  // instead of assuming the first alphabetically listed site is assigned.
  const facility = isManager
    ? assignments.isPending || assignments.isError ? undefined : facilities.find(candidate =>
      candidate.isActive && assignments.data?.some(assignment => assignment.facility_id === candidate.facilityId))
    : facilities[0];
  const facilityId = facility?.facilityId;
  // Match the RPC's entitlement gate. Tenant roles must wait for a positive
  // result; only platform administrators have the server's explicit bypass.
  const canRead = isAuthenticated && !isLoading && !!facilityId && (
    user?.role === "platform_admin"
    || (benchmarkFeature.isEnabled && ["org_admin", "facility_manager", "auditor"].includes(user?.role ?? ""))
  );
  const query = useQuery({
    queryKey: ["facility-benchmark-comparison", user?.id ?? null, user?.organizationId ?? null, user?.role ?? null, facilityId],
    enabled: canRead,
    retry: false,
    queryFn: async (): Promise<FacilityBenchmarkComparison> => {
      // A manual refetch must respect the gate as well.
      if (!canRead || !facilityId) return { available: false };
      const { data, error } = await supabase.rpc("get_facility_benchmark_comparison", { p_facility_id: facilityId });
      if (error) return { available: false };
      return data as unknown as FacilityBenchmarkComparison;
    },
  });
  // Disabled React Query observers can retain cached results. Hide the card
  // immediately if the caller or feature loses access.
  return { ...query, facility, data: canRead ? query.data : undefined };
}
