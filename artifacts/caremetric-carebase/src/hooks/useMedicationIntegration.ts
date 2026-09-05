import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type MedicationSource = Tables<"medication_integration_sources">;
export type MedicationException = Tables<"medication_integration_exceptions">;
/** The eMAR rows minus their source digest, which nothing renders. */
type WithoutSourceDigest<T> = Omit<T, "raw_record_sha256">;

export type ExternalMedicationOrder = WithoutSourceDigest<Tables<"external_medication_orders">>;
export type ExternalMedicationAdministration =
  WithoutSourceDigest<Tables<"external_medication_administration_events">>;

/** Per-resident ingestion counts and recency. No medication name, directions or schedule. */
export interface MedicationResidentActivity {
  resident_id: string;
  order_count: number;
  active_order_count: number;
  administration_count: number;
  non_routine_count: number;
  last_activity_at: string | null;
}

export interface MedicationIngestionActivity {
  orderTotal: number;
  orderActiveTotal: number;
  administrationTotal: number;
  nonRoutineTotal: number;
  lastOrderAt: string | null;
  lastAdministrationAt: string | null;
  residents: MedicationResidentActivity[];
}

export interface MedicationIntegrationWorkspace {
  sources: MedicationSource[];
  exceptions: MedicationException[];
  activity: MedicationIngestionActivity;
}

const EMPTY_ACTIVITY: MedicationIngestionActivity = {
  orderTotal: 0,
  orderActiveTotal: 0,
  administrationTotal: 0,
  nonRoutineTotal: 0,
  lastOrderAt: null,
  lastAdministrationAt: null,
  residents: [],
};

/**
 * The eMAR integration console.
 *
 * It used to pull every external order and administration event in the facility with select("*"),
 * and the page rendered medication names, directions and schedules across every resident in the
 * building -- the same facility-wide clinical disclosure, with no access-log row, that
 * useFhirIntegration was fixed for three routes away. This returns what the console is for: counts,
 * statuses and recency, per resident.
 *
 * The content is not gone, it moved to where it can be logged. See useResidentExternalMedications.
 */
export function useMedicationIntegration(facilityId?: string) {
  return useQuery({
    queryKey: ["medication-integration", facilityId],
    enabled: Boolean(facilityId),
    queryFn: async (): Promise<MedicationIntegrationWorkspace> => {
      const [sources, exceptions, activity] = await Promise.all([
        supabase.from("medication_integration_sources").select("*").eq("facility_id", facilityId!).order("created_at"),
        supabase.from("medication_integration_exceptions").select("*").eq("facility_id", facilityId!).order("last_seen_at", { ascending: false }).limit(100),
        supabase.rpc("get_facility_medication_ingestion_activity", { p_facility_id: facilityId! }),
      ]);
      const failed = [sources, exceptions, activity].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        sources: sources.data ?? [],
        exceptions: exceptions.data ?? [],
        activity: (activity.data as unknown as MedicationIngestionActivity | null) ?? EMPTY_ACTIVITY,
      };
    },
    staleTime: 30_000,
  });
}

export interface ResidentExternalMedications {
  orders: ExternalMedicationOrder[];
  administrations: ExternalMedicationAdministration[];
}

/**
 * One resident's external eMAR record, through the logged RPC.
 *
 * The console narrows to a single resident whenever the resident context is set, and that is a
 * chart read: drug names, directions and what was given or refused. It belongs in
 * app_private.clinical_access_log, and the facility-wide table read it used to come from wrote
 * nothing there. `reason` is in the key for the same cache reason as every other logged reader --
 * see useResidentClinicalCare.
 */
export function useResidentExternalMedications(residentId?: string, reason?: string) {
  return useQuery({
    queryKey: ["resident-external-medications", residentId, reason ?? null],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ResidentExternalMedications> => {
      const { data, error } = await supabase.rpc("get_resident_external_medications", {
        p_resident_id: residentId!,
        ...(reason ? { p_minimum_necessary_reason: reason } : {}),
      });
      if (error) throw error;
      return data as unknown as ResidentExternalMedications;
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

/**
 * Linking an external eMAR resident id to a CareBase resident.
 *
 * THE GAP THIS CLOSES. `map_medication_resident` is the only path that creates a
 * `medication_resident_mappings` row, and it had no caller. An `unmatched_resident` exception --
 * the eMAR sending administration data for somebody CareBase cannot identify -- could be
 * acknowledged or dismissed through the UI and never actually fixed. Meanwhile the medication
 * evidence for that resident never reaches their chart or their timeline, because everything
 * downstream joins through the mapping this function writes.
 *
 * The RPC resolves the exception itself on success, so no second call is needed and the two cannot
 * disagree about whether the mapping happened.
 */
export function useMapMedicationResident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceId: string;
      residentId: string;
      externalResidentId: string;
      facilityId: string;
    }) => {
      const { data, error } = await supabase.rpc("map_medication_resident" as never, {
        p_source_id: input.sourceId,
        p_resident_id: input.residentId,
        p_external_resident_id: input.externalResidentId,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["medication-integration", input.facilityId] });
      // The mapping is what lets administration events reach the chart, so the resident's own
      // surfaces are stale the moment it lands.
      queryClient.invalidateQueries({ queryKey: ["resident-timeline", input.residentId] });
    },
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
