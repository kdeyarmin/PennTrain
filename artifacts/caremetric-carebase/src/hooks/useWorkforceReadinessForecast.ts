import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface WorkforceReadinessForecastReason {
  type: "credential" | "training" | "duty_clearance" | string;
  sourceId: string;
  label: string;
  riskDate: string | null;
  reason: string;
  currentBlocker: boolean;
  href: string;
}

export interface WorkforceReadinessForecastRisk {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  department: string | null;
  firstRiskDate: string;
  currentBlocker: boolean;
  reasons: WorkforceReadinessForecastReason[];
}

export interface WorkforceReadinessForecastHorizon {
  days: 30 | 60 | 90 | number;
  through: string;
  employeesAtRisk: number;
  credentialEvents: number;
  trainingEvents: number;
}

export interface WorkforceReadinessForecast {
  facilityId: string;
  asOf: string;
  activeEmployees: number;
  currentBlockers: number;
  horizons: WorkforceReadinessForecastHorizon[];
  risks: WorkforceReadinessForecastRisk[];
  method: string;
  generatedAt: string;
}

export function useWorkforceReadinessForecast(facilityId?: string) {
  return useQuery({
    queryKey: ["workforce-readiness-forecast", facilityId],
    enabled: Boolean(facilityId),
    queryFn: async (): Promise<WorkforceReadinessForecast> => {
      const { data, error } = await supabase.rpc("get_workforce_readiness_forecast" as never, {
        p_facility_id: facilityId,
      } as never);
      if (error) throw error;
      return data as WorkforceReadinessForecast;
    },
    staleTime: 60_000,
  });
}
