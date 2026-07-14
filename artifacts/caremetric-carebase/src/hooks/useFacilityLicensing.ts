import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type LicensingRecord = Record<string, any> & { id: string };
export interface FacilityLicensingWorkspace {
  licenses: LicensingRecord[];
  conditions: LicensingRecord[];
  waivers: LicensingRecord[];
  filings: LicensingRecord[];
  history: LicensingRecord[];
}

function client() { return supabase as any; }

export function useFacilityLicensing(facilityId?: string) {
  return useQuery({
    queryKey: ["facility-licensing", facilityId],
    enabled: Boolean(facilityId),
    queryFn: async (): Promise<FacilityLicensingWorkspace> => {
      const [licenses, conditions, waivers, filings, history] = await Promise.all([
        client().from("facility_licenses").select("*").eq("facility_id", facilityId).order("effective_from", { ascending: false }),
        client().from("facility_license_conditions").select("*").eq("facility_id", facilityId).order("imposed_on", { ascending: false }),
        client().from("facility_regulatory_waivers").select("*").eq("facility_id", facilityId).order("created_at", { ascending: false }),
        client().from("facility_regulatory_filings").select("*").eq("facility_id", facilityId).order("due_on"),
        client().from("facility_license_history").select("*").eq("facility_id", facilityId).order("occurred_at", { ascending: false }).limit(100),
      ]);
      const failed = [licenses, conditions, waivers, filings, history].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return { licenses: licenses.data ?? [], conditions: conditions.data ?? [], waivers: waivers.data ?? [], filings: filings.data ?? [], history: history.data ?? [] };
    },
    staleTime: 30_000,
  });
}

export function useSaveFacilityLicensingRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; kind: "license" | "condition" | "waiver" | "filing"; payload: Record<string, unknown>; reason: string }) => {
      const rpc = input.kind === "license" ? "save_facility_license"
        : input.kind === "condition" ? "save_facility_license_condition"
        : input.kind === "waiver" ? "save_facility_regulatory_waiver"
        : "save_facility_regulatory_filing";
      const payloadKey = input.kind === "license" ? "p_license" : input.kind === "condition" ? "p_condition" : input.kind === "waiver" ? "p_waiver" : "p_filing";
      const { data, error } = await client().rpc(rpc, { p_facility_id: input.facilityId, [payloadKey]: input.payload, p_reason: input.reason });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["facility-licensing", input.facilityId] });
      queryClient.invalidateQueries({ queryKey: ["facilities", input.facilityId] });
      queryClient.invalidateQueries({ queryKey: ["daily-operations-command-center"] });
    },
  });
}
