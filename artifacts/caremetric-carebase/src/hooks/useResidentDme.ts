/**
 * The DME register and its event log (BACKLOG.md G10).
 *
 * Registration was wired; nothing else was. `record_resident_dme_event` -- the only writer of
 * `resident_dme_history` -- had no caller, and no surface listed the items either, so equipment went
 * into the register and was never seen again.
 *
 * Reads are plain selects: both tables carry `grant select` to `authenticated` with RLS scoping rows
 * to the caller's organization and assigned facilities.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import type { DmeEventType } from "@/lib/residentDme";

export type ResidentDmeItem = Tables<"resident_dme_items">;
export type ResidentDmeHistoryRow = Tables<"resident_dme_history">;

const DME_KEY = ["resident-care-delivery", "dme"] as const;
const DME_PAGE = 500;

export function useResidentDmeItems(facilityId: string | undefined) {
  return useQuery({
    queryKey: [...DME_KEY, "items", facilityId ?? null],
    queryFn: async () => {
      // The register is every item still in the building. An unpaged select stops at
      // PostgREST max-rows and the rest of the equipment disappears with no error.
      const rows: ResidentDmeItem[] = [];
      for (let from = 0; ;) {
        const { data, error } = await supabase
          .from("resident_dme_items")
          .select("*")
          .eq("facility_id", facilityId!)
          .not("status", "in", "(returned,disposed)")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + DME_PAGE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < DME_PAGE) break;
        from += data.length;
      }
      return rows;
    },
    enabled: !!facilityId,
  });
}

/**
 * The most recent `inspected` event per item in this facility.
 *
 * One read for the whole list rather than one per row. Pages past max-rows: the overdue
 * label needs every item's latest inspection, and a short page would call the rest never inspected.
 */
export function useResidentDmeLastInspections(facilityId: string | undefined) {
  return useQuery({
    queryKey: [...DME_KEY, "last-inspections", facilityId ?? null],
    queryFn: async () => {
      // Newest-first, then the first row per item is its latest inspection. Stopping at
      // max-rows drops every item whose last inspection is older than that page, and the
      // register then says "Never inspected" for equipment that has a history row.
      const latest = new Map<string, string>();
      for (let from = 0; ;) {
        const { data, error } = await supabase
          .from("resident_dme_history")
          .select("dme_item_id, occurred_at")
          .eq("facility_id", facilityId!)
          .eq("event_type", "inspected")
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + DME_PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          if (!latest.has(row.dme_item_id)) latest.set(row.dme_item_id, row.occurred_at);
        }
        if (!data || data.length < DME_PAGE) break;
        from += data.length;
      }
      return latest;
    },
    enabled: !!facilityId,
  });
}

export function useResidentDmeHistory(itemId: string | undefined) {
  return useQuery({
    queryKey: [...DME_KEY, "history", itemId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_dme_history")
        .select("id, event_type, note, occurred_at, resident_id")
        .eq("dme_item_id", itemId!)
        .order("occurred_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!itemId,
  });
}

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

export function useRecordResidentDmeEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      dmeItemId: string;
      eventType: DmeEventType;
      note?: string | null;
      newResidentId?: string | null;
      newStatus?: string | null;
      newCondition?: string | null;
      location?: string | null;
    }) => {
      const { error } = await (supabase as unknown as RpcClient).rpc("record_resident_dme_event", {
        p_dme_item_id: input.dmeItemId,
        p_event_type: input.eventType,
        p_note: input.note ?? null,
        // Every one of these coalesces server-side, so null means "leave it alone" rather than
        // "clear it" -- an inspection must not blank out the item's resident or location.
        p_new_resident_id: input.newResidentId ?? null,
        p_new_status: input.newStatus ?? null,
        p_new_condition: input.newCondition ?? null,
        p_location: input.location ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DME_KEY }),
        // The "DME inspections due" metric is computed from exactly the rows this just wrote.
        queryClient.invalidateQueries({ queryKey: ["resident-care-delivery"] }),
      ]);
    },
  });
}
