import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type FhirSource = Tables<"fhir_integration_sources">;
export type FhirPatientMapping = Tables<"fhir_patient_mappings">;
export type FhirException = Tables<"fhir_integration_exceptions">;

/**
 * The chart renders none of the raw inbound FHIR payload, and get_resident_clinical_fhir does not
 * return it. `raw_resource` is the whole resource as the EHR sent it -- select("*") was shipping it
 * to the browser for every row of every domain.
 */
type WithoutRawPayload<T> = Omit<T, "raw_resource" | "raw_record_sha256">;

export type FhirMedicationRequest = WithoutRawPayload<Tables<"fhir_medication_requests">>;
export type FhirAllergy = WithoutRawPayload<Tables<"fhir_allergy_intolerances">>;
export type FhirCondition = WithoutRawPayload<Tables<"fhir_conditions">>;
export type FhirServiceRequest = WithoutRawPayload<Tables<"fhir_service_requests">>;

export interface ResidentFhirClinical {
  medications: FhirMedicationRequest[];
  allergies: FhirAllergy[];
  conditions: FhirCondition[];
  orders: FhirServiceRequest[];
}

/**
 * A single resident's FHIR-ingested clinical data, through the logged RPC.
 *
 * These were four direct selects. RLS scoped them correctly, but nothing wrote to
 * app_private.clinical_access_log, so the medication list, allergy list and problem list on the
 * clinical chart could be read without leaving a record. get_resident_clinical_fhir writes one
 * access row per domain it returns. See useResidentClinicalCare for why `reason` is in the key.
 */
export function useResidentFhirClinical(residentId?: string, reason?: string) {
  return useQuery({
    queryKey: ["resident-fhir-clinical", residentId, reason ?? null],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ResidentFhirClinical> => {
      const { data, error } = await supabase.rpc("get_resident_clinical_fhir", {
        p_resident_id: residentId!,
        ...(reason ? { p_minimum_necessary_reason: reason } : {}),
      });
      if (error) throw error;
      return data as unknown as ResidentFhirClinical;
    },
    staleTime: 30_000,
  });
}

/** Per-resident ingestion counts and recency. No medication name, dosage, code or raw payload. */
export interface FhirResidentActivity {
  resident_id: string;
  request_count: number;
  active_request_count: number;
  administration_count: number;
  last_activity_at: string | null;
}

export interface FhirIngestionActivity {
  requestTotal: number;
  requestActiveTotal: number;
  administrationTotal: number;
  lastRequestAt: string | null;
  lastAdministrationAt: string | null;
  residents: FhirResidentActivity[];
}

export interface FhirIntegrationWorkspace {
  sources: FhirSource[];
  mappings: FhirPatientMapping[];
  activity: FhirIngestionActivity;
  exceptions: FhirException[];
}

const FHIR_INTEGRATION_KEY = "fhir-integration";

const EMPTY_ACTIVITY: FhirIngestionActivity = {
  requestTotal: 0,
  requestActiveTotal: 0,
  administrationTotal: 0,
  lastRequestAt: null,
  lastAdministrationAt: null,
  residents: [],
};

/**
 * The integration console.
 *
 * It used to pull every medication request and administration in the facility with select("*") --
 * drug names, dosages, RxNorm codes and the whole raw FHIR payload for every resident in the
 * building, rendered on a page whose question is "is the feed working". That is a facility-wide
 * clinical disclosure with no clinical purpose and no access-log row, and there is no honest way to
 * log it: it is not a chart read of any one resident.
 *
 * So the console now asks what it actually needs -- counts, statuses and recency, per resident --
 * and the content stays one click away on the resident's chart, where reading it is logged.
 */
export function useFhirIntegration(facilityId?: string) {
  return useQuery({
    queryKey: [FHIR_INTEGRATION_KEY, facilityId],
    enabled: Boolean(facilityId),
    queryFn: async (): Promise<FhirIntegrationWorkspace> => {
      const [sources, mappings, activity, exceptions] = await Promise.all([
        supabase.from("fhir_integration_sources").select("*").eq("facility_id", facilityId!).order("created_at"),
        supabase.from("fhir_patient_mappings").select("*").eq("facility_id", facilityId!).order("mapped_at", { ascending: false }).limit(200),
        supabase.rpc("get_facility_fhir_ingestion_activity", { p_facility_id: facilityId! }),
        supabase.from("fhir_integration_exceptions").select("*").eq("facility_id", facilityId!).order("last_seen_at", { ascending: false }).limit(100),
      ]);
      const failed = [sources, mappings, activity, exceptions].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        sources: sources.data ?? [],
        mappings: mappings.data ?? [],
        activity: (activity.data as unknown as FhirIngestionActivity | null) ?? EMPTY_ACTIVITY,
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

/**
 * Can this resident's observations actually reach an EHR right now?
 *
 * `queue_clinical_observation_writeback` (20260725170000) refuses with 42501 unless the resident
 * has an ACTIVE `fhir_patient_mappings` row whose source is `status = 'active'` AND
 * `writeback_enabled`. Nothing in the product sets `writeback_enabled`: the column was added with
 * `default false`, `save_fhir_integration_source` never writes it, and there is no update policy
 * on `fhir_integration_sources` for a client to write it directly. So the honest answer today is
 * almost always "no", and the chart asks this before offering "Send to EHR" instead of promising
 * delivery and letting the server explain afterwards.
 *
 * Only the roles the same migration granted `clinical.integration.writeback` to (platform_admin,
 * org_admin, facility_manager) can queue at all, and those are also the roles
 * `fhir_patient_mappings_read` lets read the mapping -- so the caller gates on role first and this
 * query never runs for someone who could not use the answer.
 */
export interface ResidentWritebackTarget {
  sourceId: string;
  /**
   * The destination to name in the UI, or null when this query cannot know it.
   *
   * `queue_clinical_observation_writeback` picks the mapping with the newest `mapped_at` and writes
   * to ITS source. This hook now reads the mappings in that order, so the two agree whenever the
   * order is decisive -- but `mapped_at` is not unique and the RPC's `limit 1` has no tie-break, so
   * where the newest timestamp is shared the server's choice is genuinely unpredictable from here.
   * Naming a source in that case is a guess printed as a fact on a clinical control, so it is left
   * null and the caller says "the connected EHR" instead (BACKLOG J94).
   */
  sourceName: string | null;
}

export function useResidentFhirWritebackTarget(residentId?: string, enabled = true) {
  return useQuery({
    queryKey: ["resident-fhir-writeback-target", residentId ?? null],
    enabled: Boolean(residentId) && enabled,
    queryFn: async (): Promise<ResidentWritebackTarget | null> => {
      // Ordered the way the RPC orders, newest mapping first, rather than taking whichever row
      // came back. `queue_clinical_observation_writeback` selects
      // `order by m.mapped_at desc limit 1` over the resident's active mappings; this hook used an
      // unordered `.limit(1)` over the SOURCES, so with more than one write-back-enabled mapping
      // the tooltip and the success toast could name a different EHR than the one the observation
      // was queued to (BACKLOG J94).
      const { data: mappings, error: mappingError } = await supabase
        .from("fhir_patient_mappings")
        .select("source_id,mapped_at")
        .eq("resident_id", residentId!)
        .eq("status", "active")
        .order("mapped_at", { ascending: false });
      if (mappingError) throw mappingError;
      const ordered = (mappings ?? []) as Array<{ source_id: string; mapped_at: string | null }>;
      if (ordered.length === 0) return null;
      // Two round trips rather than an embed: the mapping -> source foreign key is the COMPOSITE
      // (source_id, organization_id, facility_id) one, which PostgREST cannot resolve from
      // `source_id` alone.
      const { data: sources, error: sourceError } = await supabase
        .from("fhir_integration_sources")
        .select("id,name,status,writeback_enabled")
        .in("id", [...new Set(ordered.map((row) => row.source_id))])
        .eq("status", "active")
        .eq("writeback_enabled", true);
      if (sourceError) throw sourceError;
      const eligible = new Map(
        ((sources ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
      );
      // The first mapping in the RPC's own order whose source can actually receive a write.
      const candidates = ordered.filter((row) => eligible.has(row.source_id));
      const top = candidates[0];
      if (!top) return null;
      // Ambiguous exactly when the RPC's ordering is: another eligible mapping shares the newest
      // `mapped_at`, and nothing breaks that tie on either side.
      const tied = candidates.some(
        (row) => row.source_id !== top.source_id && row.mapped_at === top.mapped_at,
      );
      return {
        sourceId: top.source_id,
        sourceName: tied ? null : (eligible.get(top.source_id) ?? null),
      };
    },
    staleTime: 60_000,
  });
}
