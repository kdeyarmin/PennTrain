import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Violation = Tables<"dhs_violations">;
export type ViolationInsert = TablesInsert<"dhs_violations">;
export type ViolationUpdate = TablesUpdate<"dhs_violations">;

export interface ListViolationsFilters {
  facilityId?: string;
  status?: string;
}

export function useListViolations(filters: ListViolationsFilters = {}) {
  return useQuery({
    queryKey: ["dhs_violations", filters],
    queryFn: async () => {
      let query = supabase.from("dhs_violations").select("*").order("inspection_date", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

// Lets InspectionItemDetail.tsx show "View Violation" instead of "Create Violation" for a finding
// that's already been turned into one, so the same fail/deficiency_noted event can't spawn duplicates.
export function useListViolationsBySourceInspectionEvents(eventIds: string[]) {
  return useQuery({
    queryKey: ["dhs_violations", "by_source_event", eventIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dhs_violations").select("*").in("source_inspection_event_id", eventIds);
      if (error) throw error;
      return data;
    },
    enabled: eventIds.length > 0,
  });
}

export function useGetViolation(id: string | undefined) {
  return useQuery({
    queryKey: ["dhs_violations", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("dhs_violations").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateViolation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ViolationInsert) => {
      const { data, error } = await supabase.from("dhs_violations").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dhs_violations"] }),
  });
}

export function useUpdateViolation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ViolationUpdate & { id: string }) => {
      const { data, error } = await supabase.from("dhs_violations").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dhs_violations"] });
      queryClient.invalidateQueries({ queryKey: ["dhs_violations", data.id] });
    },
  });
}

export interface GeneratePocDocumentResult {
  url: string;
  path: string;
  expiresIn: number;
}

interface GeneratePocDocumentResponse extends GeneratePocDocumentResult {
  success?: boolean;
  error?: string;
}

// Always regenerates (upsert, no client-visible caching) -- a POC in draft changes as corrective
// tasks are added, matching generate-incident-report-pdf's "living document" convention.
export function useGeneratePocDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (violationId: string): Promise<GeneratePocDocumentResult> => {
      const { data, error } = await supabase.functions.invoke<GeneratePocDocumentResponse>(
        "generate-poc-document",
        { body: { violationId } },
      );
      if (error) throw error;
      if (!data || data.success === false || !data.url) {
        throw new Error(data?.error ?? "Failed to generate Plan of Correction document");
      }
      return { url: data.url, path: data.path, expiresIn: data.expiresIn };
    },
    onSuccess: (_data, violationId) => queryClient.invalidateQueries({ queryKey: ["violation_documents", violationId] }),
  });
}
