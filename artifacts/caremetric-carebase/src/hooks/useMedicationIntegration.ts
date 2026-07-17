import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type MedicationSource = Tables<"medication_integration_sources">;
export type MedicationException = Tables<"medication_integration_exceptions">;
export type ExternalMedicationOrder = Tables<"external_medication_orders">;
export type ExternalMedicationAdministration = Tables<"external_medication_administration_events">;

export interface MedicationIntegrationWorkspace {
  sources: MedicationSource[];
  exceptions: MedicationException[];
  orders: ExternalMedicationOrder[];
  administrations: ExternalMedicationAdministration[];
}

export function useMedicationIntegration(facilityId?: string) {
  return useQuery({
    queryKey: ["medication-integration", facilityId],
    enabled: Boolean(facilityId),
    queryFn: async (): Promise<MedicationIntegrationWorkspace> => {
      const [sources, exceptions, orders, administrations] = await Promise.all([
        supabase.from("medication_integration_sources").select("*").eq("facility_id", facilityId!).order("created_at"),
        supabase.from("medication_integration_exceptions").select("*").eq("facility_id", facilityId!).order("last_seen_at", { ascending: false }).limit(100),
        supabase.from("external_medication_orders").select("*").eq("facility_id", facilityId!).order("source_updated_at", { ascending: false }).limit(100),
        supabase.from("external_medication_administration_events").select("*").eq("facility_id", facilityId!).order("occurred_at", { ascending: false }).limit(100),
      ]);
      const failed = [sources, exceptions, orders, administrations].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        sources: sources.data ?? [],
        exceptions: exceptions.data ?? [],
        orders: orders.data ?? [],
        administrations: administrations.data ?? [],
      };
    },
    staleTime: 30_000,
  });
}

export function useSaveMedicationIntegrationSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceId?: string;
      facilityId: string;
      name: string;
      vendorName: string;
      externalFacilityId: string;
      credentialId?: string;
      freshnessThresholdMinutes: number;
      status: "setup_required" | "active" | "paused" | "disabled";
    }) => {
      const { data, error } = await supabase.rpc("save_medication_integration_source", {
        ...(input.sourceId ? { p_source_id: input.sourceId } : {}),
        p_facility_id: input.facilityId,
        p_name: input.name,
        p_vendor_name: input.vendorName,
        p_external_facility_id: input.externalFacilityId,
        ...(input.credentialId ? { p_credential_id: input.credentialId } : {}),
        p_freshness_threshold_minutes: input.freshnessThresholdMinutes,
        p_status: input.status,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["medication-integration", input.facilityId] }),
  });
}

export function useResolveMedicationIntegrationException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { exceptionId: string; facilityId: string; status: "acknowledged" | "resolved" | "dismissed"; note: string }) => {
      const { error } = await supabase.rpc("resolve_medication_integration_exception", {
        p_exception_id: input.exceptionId,
        p_resolution_status: input.status,
        p_resolution_note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => queryClient.invalidateQueries({ queryKey: ["medication-integration", input.facilityId] }),
  });
}

export function useAssignMedicationIntegrationException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { exceptionId: string; facilityId: string; ownerProfileId: string; dueAt: string; serviceLevelMinutes: number }) => {
      const { data, error } = await supabase.rpc("assign_medication_integration_exception" as never, {
        p_exception_id: input.exceptionId, p_owner_profile_id: input.ownerProfileId,
        p_due_at: input.dueAt, p_service_level_minutes: input.serviceLevelMinutes, p_create_work_item: true,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["medication-integration", input.facilityId] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["product-value-workspace"] });
    },
  });
}
