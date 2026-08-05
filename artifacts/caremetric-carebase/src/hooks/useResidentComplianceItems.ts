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
/** Exactly the columns the paged select below asks for. */
type ResidentComplianceItemSummary = Pick<
  ResidentComplianceItem,
  | "id" | "resident_id" | "facility_id" | "item_type" | "due_date" | "status"
  | "completed_date" | "triggered_by_item_id" | "renewal_interval_days"
>;

export function useListAllResidentComplianceItems(filters: ListAllResidentComplianceItemsFilters = {}) {
  return useQuery({
    queryKey: ["resident_compliance_items_all", filters],
    queryFn: async () => {
      // completed_date/triggered_by_item_id/renewal_interval_days feed the State Forms Center's
      // urgency queue, renewal window, and cross-trigger reason derivation.
      //
      // Paged, for the reason useComplianceInstances is: an unpaginated select is silently cut off
      // at PostgREST's max-rows (1000 by default), and this one backs a compliance REPORT and the
      // State Forms Center queue. Every resident carries roughly half a dozen items, so a
      // 170-resident organization is already past the cap -- and because the rows are ordered by
      // due_date ascending, what got dropped was the far end of the calendar with nothing on
      // screen to say the list was incomplete. Same shape as the roster read in
      // bulk-import-training-records (G24.2); the truncation is never an error, only a short list.
      const pageSize = 1000;
      const all: ResidentComplianceItemSummary[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = supabase
          .from("resident_compliance_items")
          .select("id,resident_id,facility_id,item_type,due_date,status,completed_date,triggered_by_item_id,renewal_interval_days")
          .order("due_date")
          .order("id")
          .range(from, from + pageSize - 1);
        if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
        if (filters.status?.length) query = query.in("status", filters.status);
        if (filters.itemType) query = query.eq("item_type", filters.itemType);
        const { data, error } = await query;
        if (error) throw error;
        const batch = (data ?? []) as ResidentComplianceItemSummary[];
        all.push(...batch);
        if (batch.length < pageSize || all.length >= 50000) break;
      }
      return all;
    },
  });
}

// Completion (including the next-cycle renewal insert and the annual/significant-change ->
// support-plan-revision cross-trigger) lives server-side in complete_resident_compliance_item() so
// it's correct regardless of which UI surface calls it -- see
// supabase/migrations/20260706090100_resident_compliance_cross_triggers_and_change_of_condition.sql.
// p_document_id is required server-side (a resident_documents row linked to this item with
// is_state_form = true) -- documents like the RASP/ASP and DME must be on the state-approved form,
// no exception, so there is no "complete without documentation" call shape anymore.
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

// A `useLogResidentChangeOfCondition` used to sit here, calling `log_resident_change_of_condition`
// to raise a `significant_change_reassessment` item due immediately. It was removed rather than
// given a screen: `create_resident_change_event` -- which LogChangeOfConditionDialog already calls
// from ResidentDetail and the State Forms Center -- writes that same item, with the same warning
// and grace days, plus the citation topic, the change event itself, its follow-up and its history,
// and optionally an incident. Wiring the thin one would have produced a reassessment item with no
// change-of-condition record behind it, invisible in ChangeOfConditionQueue, which reads the events.
//
// The function itself stays: `convert_shift_report_entry` calls it server-side to turn a triaged
// handoff entry into the same item, which is a building block rather than a user action.

