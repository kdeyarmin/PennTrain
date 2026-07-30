import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface OrgDashboardSummary {
  compliance: {
    compliantCount: number;
    dueSoonCount: number;
    dueSoon30Count: number;
    dueSoon90Count: number;
    expiredCount: number;
    missingCount: number;
    missingDocumentCount: number;
    totalTrackedCount: number;
    compliancePercentage: number;
  };
  staff: {
    totalEmployees: number;
    totalMedAdminStaff: number;
    trainersDueForRecert: number;
  };
  alerts: {
    openCount: number;
    criticalCount: number;
    recent: { id: string; title: string; message: string | null; severity: string }[];
  };
  uploads: {
    recentCount: number;
    recent: { id: string; fileName: string; documentType: string; createdAt: string }[];
  };
  facilities: {
    id: string;
    name: string;
    facilityType: string;
    licenseNumber: string | null;
    isActive: boolean;
    complianceScore: number;
  }[];
  generatedAt: string;
}

/**
 * One server-side round trip replacing the dashboard's previous six unbounded table
 * downloads. SECURITY INVOKER on the RPC means every number is scoped to exactly the
 * rows the caller's RLS allows -- the same data the old client-side aggregation saw.
 */
export function useOrgDashboardSummary() {
  return useQuery({
    queryKey: ["org_dashboard_summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_org_dashboard_summary");
      if (error) throw error;
      return data as unknown as OrgDashboardSummary;
    },
    staleTime: 60_000,
  });
}

export interface TrainerDashboardSummary {
  classes: {
    totalCount: number;
    draftCount: number;
    todays: { id: string; className: string }[];
    recent: {
      id: string;
      className: string;
      classDate: string;
      status: string;
      attendeeCount: number;
    }[];
  };
  staff: {
    totalFacilities: number;
    totalMedAdminStaff: number;
    practicumsCompliant: number;
    practicumsPending: number;
  };
  facilitiesNeedingAttention: {
    facilityId: string;
    facilityName: string;
    facilityType: string;
    totalMedAdminStaff: number;
    compliantCount: number;
    dueSoonCount: number;
    expiredCount: number;
    missingCount: number;
    nextExpiryDate: string | null;
    overallStatus: "compliant" | "due_soon" | "expired" | "critical" | "unknown";
    isVisible: boolean;
  }[];
  generatedAt: string;
}

/**
 * One SECURITY INVOKER round trip replacing TrainerDashboard's previous unbounded
 * employees / facilities / classes / practicums downloads + client aggregation.
 * Numbers and bounded lists match the retired client logic by construction (same RLS).
 *
 * The rpc name is cast until database.types.ts is regenerated to include
 * get_trainer_dashboard_summary: { Args: never; Returns: Json }.
 */
export function useTrainerDashboardSummary() {
  return useQuery({
    queryKey: ["trainer_dashboard_summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_trainer_dashboard_summary" as "get_org_dashboard_summary",
      );
      if (error) throw error;
      return data as unknown as TrainerDashboardSummary;
    },
    staleTime: 60_000,
  });
}
