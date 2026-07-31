import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SurveyRehearsal {
  id: string;
  organization_id: string;
  facility_id: string;
  name: string;
  status: string;
  sample_method: string;
  sample_size: number;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  notes: string | null;
  report: Record<string, unknown>;
  created_by: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurveyRehearsalItem {
  id: string;
  organization_id: string;
  facility_id: string;
  rehearsal_id: string;
  domain: string;
  source_id: string | null;
  source_label: string;
  risk_tier: string;
  result: string;
  finding: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useListSurveyRehearsals(facilityId?: string) {
  return useQuery({
    queryKey: ["survey-rehearsals", facilityId ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("survey_rehearsals" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (facilityId) query = query.eq("facility_id" as never, facilityId as never);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as SurveyRehearsal[];
    },
  });
}

export function useSurveyRehearsalItems(rehearsalId: string | null) {
  return useQuery({
    queryKey: ["survey-rehearsal-items", rehearsalId],
    enabled: Boolean(rehearsalId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("survey_rehearsal_items" as never)
        .select("*")
        .eq("rehearsal_id" as never, rehearsalId as never)
        .order("created_at" as never);
      if (error) throw error;
      return (data ?? []) as unknown as SurveyRehearsalItem[];
    },
  });
}

function invalidate(client: ReturnType<typeof useQueryClient>, rehearsalId?: string) {
  void client.invalidateQueries({ queryKey: ["survey-rehearsals"] });
  if (rehearsalId) void client.invalidateQueries({ queryKey: ["survey-rehearsal-items", rehearsalId] });
}

export function useCreateSurveyRehearsal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      name: string;
      sampleSize: number;
      sampleMethod: string;
      scheduledFor?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_survey_rehearsal" as never, {
        p_facility_id: input.facilityId,
        p_name: input.name,
        p_sample_size: input.sampleSize,
        p_sample_method: input.sampleMethod,
        p_scheduled_for: input.scheduledFor ?? null,
        p_notes: input.notes ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(client),
  });
}

export function useSampleSurveyRehearsal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (rehearsalId: string) => {
      const { data, error } = await supabase.rpc("sample_survey_rehearsal" as never, {
        p_rehearsal_id: rehearsalId,
      } as never);
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (_data, rehearsalId) => invalidate(client, rehearsalId),
  });
}

export function useRecordSurveyRehearsalItemResult() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { itemId: string; result: string; finding?: string; rehearsalId: string }) => {
      const { error } = await supabase.rpc("record_survey_rehearsal_item_result" as never, {
        p_item_id: input.itemId,
        p_result: input.result,
        p_finding: input.finding ?? null,
      } as never);
      if (error) throw error;
      return true;
    },
    onSuccess: (_data, variables) => invalidate(client, variables.rehearsalId),
  });
}

export function useCompleteSurveyRehearsal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rehearsalId: string; notes?: string }) => {
      const { data, error } = await supabase.rpc("complete_survey_rehearsal" as never, {
        p_rehearsal_id: input.rehearsalId,
        p_notes: input.notes ?? null,
      } as never);
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (_data, variables) => invalidate(client, variables.rehearsalId),
  });
}

export function useCancelSurveyRehearsal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rehearsalId: string; reason: string }) => {
      const { error } = await supabase.rpc("cancel_survey_rehearsal" as never, {
        p_rehearsal_id: input.rehearsalId,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return true;
    },
    onSuccess: (_data, variables) => invalidate(client, variables.rehearsalId),
  });
}
