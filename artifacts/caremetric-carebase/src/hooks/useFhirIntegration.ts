import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type FhirSource = Tables<"fhir_integration_sources">;
export type FhirPatientMapping = Tables<"fhir_patient_mappings">;
export type FhirMedicationRequest = Tables<"fhir_medication_requests">;
export type FhirMedicationAdministration = Tables<"fhir_medication_administrations">;
export type FhirException = Tables<"fhir_integration_exceptions">;

export interface FhirIntegrationWorkspace {
  sources: FhirSource[];
  mappings: FhirPatientMapping[];
  requests: FhirMedicationRequest[];
  administrations: FhirMedicationAdministration[];
  exceptions: FhirException[];
}

const FHIR_INTEGRATION_KEY = "fhir-integration";

export function useFhirIntegration(facilityId?: string) {
  return useQuery({
    queryKey: [FHIR_INTEGRATION_KEY, facilityId],
    enabled: Boolean(facilityId),
    queryFn: async (): Promise<FhirIntegrationWorkspace> => {
      const [sources, mappings, requests, administrations, exceptions] = await Promise.all([
        supabase.from("fhir_integration_sources").select("*").eq("facility_id", facilityId!).order("created_at"),
        supabase.from("fhir_patient_mappings").select("*").eq("facility_id", facilityId!).order("mapped_at", { ascending: false }).limit(200),
        supabase.from("fhir_medication_requests").select("*").eq("facility_id", facilityId!).order("source_updated_at", { ascending: false }).limit(100),
        supabase.from("fhir_medication_administrations").select("*").eq("facility_id", facilityId!).order("effective_at", { ascending: false }).limit(100),
        supabase.from("fhir_integration_exceptions").select("*").eq("facility_id", facilityId!).order("last_seen_at", { ascending: false }).limit(100),
      ]);
      const failed = [sources, mappings, requests, administrations, exceptions].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        sources: sources.data ?? [],
        mappings: mappings.data ?? [],
        requests: requests.data ?? [],
        administrations: administrations.data ?? [],
        exceptions: exceptions.data ?? [],
      };
    },
    staleTime: 30_000,
  });
}

export function useSaveFhirIntegrationSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceId?: string;
      facilityId: string;
      name: string;
      vendorName: string;
      externalFacilityId: string;
      fhirBaseUrl?: string;
      credentialId?: string;
      freshnessThresholdMinutes: number;
      status: "setup_required" | "active" | "paused" | "disabled";
    }) => {
      const { data, error } = await supabase.rpc("save_fhir_integration_source", {
        ...(input.sourceId ? { p_source_id: input.sourceId } : {}),
        p_facility_id: input.facilityId,
        p_name: input.name,
        p_vendor_name: input.vendorName,
        p_external_facility_id: input.externalFacilityId,
        ...(input.fhirBaseUrl ? { p_fhir_base_url: input.fhirBaseUrl } : {}),
        ...(input.credentialId ? { p_credential_id: input.credentialId } : {}),
        p_freshness_threshold_minutes: input.freshnessThresholdMinutes,
        p_status: input.status,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: [FHIR_INTEGRATION_KEY, input.facilityId] }),
  });
}

export function useMapFhirPatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      sourceId: string;
      residentId: string;
      fhirPatientId: string;
    }) => {
      const { data, error } = await supabase.rpc("map_fhir_patient", {
        p_source_id: input.sourceId,
        p_resident_id: input.residentId,
        p_fhir_patient_id: input.fhirPatientId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: [FHIR_INTEGRATION_KEY, input.facilityId] }),
  });
}

export function useResolveFhirIntegrationException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      exceptionId: string;
      status: "acknowledged" | "resolved" | "dismissed";
      note: string;
    }) => {
      const { error } = await supabase.rpc("resolve_fhir_integration_exception", {
        p_exception_id: input.exceptionId,
        p_resolution_status: input.status,
        p_resolution_note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: [FHIR_INTEGRATION_KEY, input.facilityId] }),
  });
}
