import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface OperationsCommandCenterSignals {
  workforceGaps: number;
  residentReadinessGaps: number;
  medicationFollowUps: number;
  incidentComplaintOpen: number;
  overdueCorrectiveActions: number;
  overduePolicyAttestations: number;
  activeEmergencyEvents: number;
  emergencyUnaccounted: number;
  openWorkOrders: number;
  highRiskWorkOrders: number;
  activeResidents: number;
}

export interface OperationsWorkQueueSummary {
  openCount: number;
  urgentCount: number;
  overdueCount: number;
  unassignedCount: number;
  pendingApprovalCount: number;
}

export interface OperationsSourceBreakdown {
  sourceType: string;
  openCount: number;
  urgentCount: number;
  overdueCount: number;
  unassignedCount: number;
}

export interface OperationsAttentionItem {
  id: string;
  title: string;
  sourceType: string;
  state: string;
  priority: string;
  dueAt: string;
  ownerProfileId: string | null;
}

export interface OperationsCommandCenterSnapshot {
  facility: {
    id: string;
    organizationId: string;
    name: string;
    facilityType: string;
  };
  signals: OperationsCommandCenterSignals;
  workQueue: OperationsWorkQueueSummary;
  sourceBreakdown: OperationsSourceBreakdown[];
  attentionItems: OperationsAttentionItem[];
  generatedAt: string;
}

export function useOperationsCommandCenter(facilityId: string | undefined) {
  return useQuery({
    queryKey: ["operations-command-center", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_operations_command_center", {
        p_facility_id: facilityId!,
      });
      if (error) throw error;
      if (!data) throw new Error("The selected facility is unavailable or outside your assigned scope.");
      return data as unknown as OperationsCommandCenterSnapshot;
    },
    enabled: Boolean(facilityId),
    refetchInterval: 60_000,
  });
}
