import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ResidentComplianceItem = Tables<"resident_compliance_items">;

export function useListResidentComplianceItems(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident_compliance_items", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_compliance_items").select("*").eq("resident_id", residentId!).order("due_date");
      if (error) throw error;
      return data;
    },
    enabled: !!residentId,
  });
}

export interface ListAllResidentComplianceItemsFilters {
  facilityId?: string;
  status?: string[];
  itemType?: string;
}

// One flat, RLS-scoped query across every resident -- not a bare Postgres view (this codebase
// has a documented precedent against those for RLS-scoped read models; see
// 20260704073300_group_c_quiz_answer_choices_view.sql's supersession) and not a security-definer
// function either, so RLS keeps applying normally per caller. Mirrors useListAlerts()'s shape.
// Powers both the Residents.tsx list-page Compliance column and the ResidentComplianceReport.tsx
// facility-wide dashboard.
export function useListAllResidentComplianceItems(filters: ListAllResidentComplianceItemsFilters = {}) {
  return useQuery({
    queryKey: ["resident_compliance_items_all", filters],
    queryFn: async () => {
      // completed_date/triggered_by_item_id/renewal_interval_days feed the State Forms Center's
      // urgency queue, renewal window, and cross-trigger reason derivation.
      let query = supabase.from("resident_compliance_items").select("id,resident_id,facility_id,item_type,due_date,status,completed_date,triggered_by_item_id,renewal_interval_days").order("due_date");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status?.length) query = query.in("status", filters.status);
      if (filters.itemType) query = query.eq("item_type", filters.itemType);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

// Completion (including the next-cycle renewal insert and the annual/significant-change ->
// support-plan-revision cross-trigger) lives server-side in complete_resident_compliance_item() so
// it's correct regardless of which UI surface calls it -- see
// supabase/migrations/20260706090100_resident_compliance_cross_triggers_and_change_of_condition.sql.
// p_document_id is required server-side (a resident_documents row linked to this item with
// is_state_form = true) -- documents like the RASP/ASP and DME must be on the state-approved form,
// no exception, so there is no "complete without evidence" call shape anymore.
export function useCompleteResidentComplianceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    // item is structurally Pick<...>, not the full row, so the State Forms Center (whose org-wide
    // query selects a column subset) can call this with the same rows it renders.
    mutationFn: async ({ item, documentId }: { item: Pick<ResidentComplianceItem, "id">; documentId: string }) => {
      const { data, error } = await supabase.rpc("complete_resident_compliance_item", {
        p_item_id: item.id,
        p_document_id: documentId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["resident_compliance_items", data.resident_id] });
      queryClient.invalidateQueries({ queryKey: ["resident_compliance_items_all"] });
    },
  });
}

// Logs a change-of-condition event: PA DHS requires a reassessment "if the resident's condition
// significantly changes" but states no numeric turnaround anywhere in the regulation or RCG, so
// this is flagged as due immediately (see log_resident_change_of_condition()'s comment). notes is
// an optional short compliance-tracking annotation, not a clinical record.
export function useLogResidentChangeOfCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ residentId, notes }: { residentId: string; notes?: string }) => {
      const { data, error } = await supabase.rpc("log_resident_change_of_condition", {
        p_resident_id: residentId,
        p_notes: notes,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["resident_compliance_items", data.resident_id] });
      queryClient.invalidateQueries({ queryKey: ["resident_compliance_items_all"] });
    },
  });
}
