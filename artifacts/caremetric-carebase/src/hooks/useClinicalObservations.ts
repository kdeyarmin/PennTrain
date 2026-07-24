import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ClinicalObservation = Tables<"clinical_observations">;

export type ObservationType =
  | "blood_pressure"
  | "heart_rate"
  | "respiratory_rate"
  | "temperature"
  | "spo2"
  | "weight"
  | "height"
  | "bmi"
  | "blood_glucose"
  | "pain_score"
  | "o2_flow"
  | "custom";

export type ObservationAmendmentType = "correction" | "entered_in_error" | "note";

const CLINICAL_OBSERVATIONS_KEY = "clinical-observations";
const CLINICAL_CHART_SUMMARY_KEY = "clinical-chart-summary";

/** Consolidated face-sheet returned by the get_resident_clinical_chart RPC. */
export interface ClinicalChartSummary {
  resident: {
    id: string;
    firstName: string;
    lastName: string;
    room: string | null;
    clinicalDataConsent: string;
  };
  allergies: { substance: string; criticality: string | null; clinicalStatus: string | null }[];
  problems: { display: string; code: string | null; clinicalStatus: string | null }[];
  medications: { display: string; status: string; rxnorm: string | null }[];
  latestVitals: {
    observation_type: string;
    value_numeric: number | null;
    value_secondary: number | null;
    value_text: string | null;
    unit: string | null;
    abnormal_flag: string;
    observed_at: string;
  }[];
  recentNotes: { noteType: string; status: string; authoredAt: string }[];
  recentAssessments: {
    assessmentType: string;
    score: number | null;
    riskBand: string | null;
    status: string;
    assessedAt: string;
  }[];
}

/**
 * Reads a resident's clinical observations through the SECURITY DEFINER RPC (not a direct
 * table select) so every PHI read is written to the clinical access log and gated by the
 * shared clinical visibility helper rather than base residents RLS.
 */
export function useResidentClinicalObservations(
  residentId: string | undefined,
  observationType?: ObservationType,
) {
  return useQuery({
    queryKey: [CLINICAL_OBSERVATIONS_KEY, residentId, observationType ?? "all"],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ClinicalObservation[]> => {
      const { data, error } = await supabase.rpc("get_resident_clinical_observations", {
        p_resident_id: residentId!,
        ...(observationType ? { p_observation_type: observationType } : {}),
      });
      if (error) throw error;
      return (data ?? []) as ClinicalObservation[];
    },
    staleTime: 30_000,
  });
}

export function useRecordClinicalObservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      observationType: ObservationType;
      observedAt: string;
      valueNumeric?: number | null;
      valueSecondary?: number | null;
      valueText?: string | null;
      unit?: string | null;
      customLabel?: string | null;
      loincCode?: string | null;
      note?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("record_clinical_observation", {
        p_resident_id: input.residentId,
        p_observation_type: input.observationType,
        p_observed_at: input.observedAt,
        p_value_numeric: input.valueNumeric ?? undefined,
        p_value_secondary: input.valueSecondary ?? undefined,
        p_value_text: input.valueText ?? undefined,
        p_unit: input.unit ?? undefined,
        p_custom_label: input.customLabel ?? undefined,
        p_loinc_code: input.loincCode ?? undefined,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: [CLINICAL_OBSERVATIONS_KEY, input.residentId] }),
  });
}

export function useAmendClinicalObservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      observationId: string;
      amendmentType: ObservationAmendmentType;
      reason: string;
      valueNumeric?: number | null;
      valueSecondary?: number | null;
      valueText?: string | null;
      note?: string | null;
    }) => {
      const { error } = await supabase.rpc("amend_clinical_observation", {
        p_observation_id: input.observationId,
        p_amendment_type: input.amendmentType,
        p_reason: input.reason,
        p_value_numeric: input.valueNumeric ?? undefined,
        p_value_secondary: input.valueSecondary ?? undefined,
        p_value_text: input.valueText ?? undefined,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: [CLINICAL_OBSERVATIONS_KEY, input.residentId] }),
  });
}

/**
 * Consolidated clinical chart face-sheet through the SECURITY DEFINER RPC. The RPC composes
 * both lanes (native vitals/notes/assessments + read-only FHIR meds/allergies/problems) and
 * writes the HIPAA chart-view access-log entry itself, so opening the chart is logged once here
 * rather than through a separate access-log call.
 */
export function useResidentClinicalChartSummary(residentId: string | undefined, reason?: string) {
  return useQuery({
    queryKey: [CLINICAL_CHART_SUMMARY_KEY, residentId],
    enabled: Boolean(residentId),
    queryFn: async (): Promise<ClinicalChartSummary> => {
      const { data, error } = await supabase.rpc("get_resident_clinical_chart", {
        p_resident_id: residentId!,
        ...(reason ? { p_minimum_necessary_reason: reason } : {}),
      });
      if (error) throw error;
      return data as unknown as ClinicalChartSummary;
    },
    staleTime: 60_000,
  });
}
